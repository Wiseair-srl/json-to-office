/**
 * `jto_discover` — the authoring surface, small enough to read in one call.
 *
 * The first thing an agent that knows nothing about this project reaches for,
 * so it answers "what can I write?" and stops there: formats, component names,
 * renderer profiles, themes, starter documents. Deliberately no schemas — the
 * DOCX document schema alone is over 3 MB, and dumping it is the failure this
 * tool and `jto_describe_component` exist between them to prevent.
 *
 * Nothing here is restated. Which components exist, and which renderer accepts
 * which, is read out of the generated JSON Schema — the same artifact that
 * validates a document and drives the editor — while the human-facing metadata
 * comes from the registries that feed that generation and the renderer ids
 * from the cores. Three sources that have to agree; `discovery-drift.test.ts`
 * fails the build when they stop.
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';

import type { McpServer } from '@modelcontextprotocol/server';

import { convertToJsonSchema, unionBranches } from '@json-to-office/shared';
import {
  STANDARD_COMPONENTS_REGISTRY,
  ThemeConfigSchema as DocxThemeConfigSchema,
  generateUnifiedDocumentSchema as generateDocxDocumentSchema,
} from '@json-to-office/shared-docx';
import {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  ThemeConfigSchema as PptxThemeConfigSchema,
  generateUnifiedDocumentSchema as generatePptxDocumentSchema,
} from '@json-to-office/shared-pptx';

import type { FormatName } from '../lib/adapters.js';
import type { ToolDeps } from '../lib/deps.js';
import { designNote } from '../lib/design-notes.js';
import {
  ERROR_CODES,
  diagnostic,
  guarded,
  success,
  toolResult,
  type Diagnostic,
} from '../lib/errors.js';
import { FORMAT_NAMES, S, formatSchema, outputSchema } from '../lib/schema.js';

/** A node of a JSON Schema document, walked structurally rather than typed. */
export type SchemaNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Generated schemas
// ---------------------------------------------------------------------------

/**
 * The document schema for a format, generated in process.
 *
 * Same generator, same options and same `$id` as `scripts/generate-schemas.ts`,
 * so this is byte-for-byte what `pnpm schemas` writes to the gitignored
 * `schemas/` directory. Generating rather than reading is what lets the server
 * run from a bare `pnpm install` with no schema build step, and is also the
 * only way plugin-registered components could ever appear here (#204).
 */
function generateDocumentSchema(format: FormatName): SchemaNode {
  return format === 'docx'
    ? (convertToJsonSchema(
        generateDocxDocumentSchema({
          includeStandardComponents: true,
          includeTheme: false,
          customComponents: [],
          title: 'JSON Document Definition',
          description: 'Document definition with standard components',
        }),
        { $id: 'document.schema.json' }
      ) as SchemaNode)
    : (convertToJsonSchema(
        generatePptxDocumentSchema({ customComponents: [] }),
        {
          $id: 'presentation.schema.json',
        }
      ) as SchemaNode);
}

function generateThemeSchema(format: FormatName): SchemaNode {
  return convertToJsonSchema(
    format === 'docx' ? DocxThemeConfigSchema : PptxThemeConfigSchema,
    {
      $id: 'theme.schema.json',
      title: 'Theme Configuration',
      description: 'Theme configuration for styling',
    }
  ) as SchemaNode;
}

/** One renderer's view of the component union, keyed by component name. */
export interface RendererProfile {
  id: string;
  components: ReadonlyMap<string, SchemaNode>;
}

export interface FormatSchemas {
  format: FormatName;
  /** The generated document schema, as published at `jto://schema/{f}/document`. */
  document: SchemaNode;
  /** The generated theme schema. */
  theme: SchemaNode;
  /** The document schema's `definitions`, for resolving `$ref`s out of a branch. */
  definitions: Readonly<Record<string, SchemaNode>>;
  /** Renderer profiles, in the order the schema declares them. */
  profiles: readonly RendererProfile[];
  /** The root component's name, e.g. `docx` — the only one carrying `renderer`. */
  rootComponent: string;
}

/**
 * Generating the DOCX schema costs ~120ms and allocates a 3 MB object graph.
 * Nothing about it varies within a connection (there is no plugin registry
 * behind this server yet), so it is built once and shared by the tools and the
 * resources alike — which is also what keeps them from answering differently.
 */
const schemaCache = new Map<FormatName, FormatSchemas>();

export function formatSchemas(format: FormatName): FormatSchemas {
  const cached = schemaCache.get(format);
  if (cached) return cached;

  const document = generateDocumentSchema(format);
  const definitions = (document.definitions ?? {}) as Record<
    string,
    SchemaNode
  >;
  const { profiles, rootComponent } = extractRendererProfiles(document);
  const built: FormatSchemas = {
    format,
    document,
    theme: generateThemeSchema(format),
    definitions,
    profiles,
    rootComponent,
  };
  schemaCache.set(format, built);
  return built;
}

/** Drop the memoized schemas. Tests use this to prove generation is repeatable. */
export function resetSchemaCache(): void {
  schemaCache.clear();
}

// ---------------------------------------------------------------------------
// Reading the generated schema
// ---------------------------------------------------------------------------

/** The `name` const a component branch is discriminated on. */
function componentNameOf(node: unknown): string | undefined {
  const name = (
    (node as SchemaNode | undefined)?.properties as SchemaNode | undefined
  )?.name as SchemaNode | undefined;
  return typeof name?.const === 'string' ? name.const : undefined;
}

/** The `renderer` const, which only the root component carries. */
function rendererOf(node: unknown): string | undefined {
  const renderer = (
    (node as SchemaNode | undefined)?.properties as SchemaNode | undefined
  )?.renderer as SchemaNode | undefined;
  return typeof renderer?.const === 'string' ? renderer.const : undefined;
}

/**
 * True when a node is a component union.
 *
 * `unionBranches` reads both shapes the exporter can leave behind — the flat
 * `anyOf` and the `if/then` dispatch `restructureNameDiscriminatedUnions`
 * rewrites it into — so this holds whichever pass last touched the schema.
 */
export function isComponentUnion(node: unknown): boolean {
  const branches = unionBranches(node);
  return (
    branches.length >= 2 &&
    branches.every((branch) => typeof componentNameOf(branch) === 'string')
  );
}

/** Follow `#/definitions/...` to the node it names. */
export function deref(
  node: unknown,
  definitions: Readonly<Record<string, SchemaNode>>
): SchemaNode | undefined {
  let current = node as SchemaNode | undefined;
  for (let hops = 0; current && typeof current.$ref === 'string'; hops += 1) {
    // A cycle here would be a broken schema, not a deep one: definitions in
    // this project are one hop from their reference.
    if (hops > 8) return undefined;
    const match = /^#\/definitions\/(.+)$/.exec(current.$ref);
    current = match?.[1] !== undefined ? definitions[match[1]] : undefined;
  }
  return current;
}

/**
 * Find every renderer's component union.
 *
 * Searched for structurally rather than looked up by name because the
 * definition keys are not stable: DOCX names them per renderer
 * (`ComponentDefinition_docxjs`), while PPTX gets TypeBox's global ordinals
 * (`T1`, `T3`, …) — which shift with how many recursive schemas the process
 * built before this one. What *is* stable is that exactly one union per
 * renderer contains the root component, and the root component is the only one
 * carrying a `renderer` const.
 */
function extractRendererProfiles(document: SchemaNode): {
  profiles: RendererProfile[];
  rootComponent: string;
} {
  const definitions = (document.definitions ?? {}) as Record<
    string,
    SchemaNode
  >;
  const found = new Map<string, SchemaNode[]>();
  let rootComponent = '';

  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isComponentUnion(node)) {
      const branches = unionBranches(node) as SchemaNode[];
      const root = branches.find((branch) => rendererOf(branch) !== undefined);
      const id = root ? rendererOf(root) : undefined;
      if (root && id !== undefined) {
        rootComponent = componentNameOf(root) ?? rootComponent;
        const previous = found.get(id);
        if (!previous || branches.length > previous.length) {
          found.set(id, branches);
        }
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(document);
  // The root union lives under `definitions` for DOCX and is only reachable
  // from the root through a `$ref`, so the definitions are walked too.
  walk(definitions);

  const profiles = [...found.entries()].map(([id, branches]) => ({
    id,
    components: new Map(
      branches.map((branch) => [componentNameOf(branch) as string, branch])
    ),
  }));
  return { profiles, rootComponent };
}

/**
 * The component names a container accepts as direct children, per the schema.
 *
 * The registry declares the same thing in `allowedChildren`, but that is the
 * input to generation, not its result — a narrowing applied downstream would
 * make the two differ, which is one of the divergences the drift test watches.
 */
export function childNamesOf(
  branch: SchemaNode,
  definitions: Readonly<Record<string, SchemaNode>>
): string[] | undefined {
  const children = (branch.properties as SchemaNode | undefined)?.children as
    | SchemaNode
    | undefined;
  if (!children) return undefined;
  const items = deref(children.items, definitions);
  if (!items) return undefined;
  const branches = unionBranches(items);
  if (branches.length > 0) {
    return branches
      .map((entry) => componentNameOf(entry))
      .filter((name): name is string => name !== undefined);
  }
  const single = componentNameOf(items);
  return single !== undefined ? [single] : [];
}

// ---------------------------------------------------------------------------
// Registry metadata
// ---------------------------------------------------------------------------

/**
 * The registry entry behind a component, for the parts a JSON Schema cannot
 * carry: its category, and (once #236 lands) its stability and deprecation.
 */
interface RegistryEntry {
  name: string;
  category: string;
  description: string;
  hasChildren: boolean;
  allowedChildren?: readonly string[];
  stability?: string;
  deprecated?: unknown;
}

export function registryEntries(format: FormatName): RegistryEntry[] {
  const source =
    format === 'docx'
      ? STANDARD_COMPONENTS_REGISTRY
      : PPTX_STANDARD_COMPONENTS_REGISTRY;
  return source.map((component) => {
    const extra = component as { stability?: string; deprecated?: unknown };
    return {
      name: component.name,
      category: component.category,
      description: component.description,
      hasChildren: component.hasChildren,
      ...(component.allowedChildren !== undefined && {
        allowedChildren: component.allowedChildren,
      }),
      // Absent today; read rather than defaulted so that the day #236 adds it
      // to the registry it appears here with no change on this side.
      ...(extra.stability !== undefined && { stability: extra.stability }),
      ...(extra.deprecated !== undefined && { deprecated: extra.deprecated }),
    };
  });
}

// ---------------------------------------------------------------------------
// Built-in themes
// ---------------------------------------------------------------------------

const CORE_THEMES: Record<FormatName, { specifier: string; exported: string }> =
  {
    docx: { specifier: '@json-to-office/core-docx', exported: 'themes' },
    pptx: { specifier: '@json-to-office/core-pptx', exported: 'pptxThemes' },
  };

/**
 * A resolver rooted at `jto-ops`, which owns the cores — they are its
 * dependency, not ours, so under pnpm's strict layout a bare specifier here
 * resolves to nothing. Same approach `jto_info` takes to read their versions.
 */
let coreResolver: NodeJS.Require | undefined;
try {
  const here = createRequire(import.meta.url);
  coreResolver = createRequire(
    here.resolve('@json-to-office/jto-ops/package.json')
  );
} catch {
  /* jto-ops unresolvable: themes fall back to whatever the adapter reports */
}

/**
 * Built-in theme names for a format.
 *
 * `FormatAdapter.getBuiltinThemes()` is the intended source and is asked
 * first. It reaches for its core with a synchronous `require`, though, which
 * tsup's ESM shim leaves as a stub that throws — so in this (ESM) process it
 * answers `{}` and the fallback below does the work. Delete the fallback once
 * jto-ops loads its themes asynchronously; the adapter branch will then win on
 * its own.
 */
async function builtinThemeNames(
  format: FormatName,
  deps: ToolDeps
): Promise<string[]> {
  const fromAdapter = Object.keys(deps.getAdapter(format).getBuiltinThemes());
  if (fromAdapter.length > 0) return fromAdapter.sort();
  if (!coreResolver) return [];
  const { specifier, exported } = CORE_THEMES[format];
  try {
    const core = (await import(
      pathToFileURL(coreResolver.resolve(specifier)).href
    )) as Record<string, Record<string, unknown> | undefined>;
    return Object.keys(core[exported] ?? {}).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Starter documents
// ---------------------------------------------------------------------------

export interface Starter {
  id: string;
  format: FormatName;
  title: string;
  description: string;
  document: unknown;
}

/**
 * The smallest documents that actually build.
 *
 * Kept here rather than pointed at on disk because an agent's first move after
 * discovery is to copy one and edit it, and a path it cannot read is worse
 * than no starter at all. `discovery-drift.test.ts` runs every one of them
 * through the real validator, so a component change that invalidates a starter
 * fails the build instead of shipping a broken example.
 *
 * The slides carry no `props: {}` any more. They only ever did because the
 * published schema required the key on a component that needs nothing in it —
 * a workaround for a defect since fixed in `shared-pptx`, and one an agent
 * copying a starter would have carried into every slide it wrote.
 */
export const STARTERS: readonly Starter[] = [
  {
    id: 'docx-minimal',
    format: 'docx',
    title: 'Minimal document',
    description:
      'The smallest valid .docx: root, one section, a heading and a paragraph.',
    document: {
      name: 'docx',
      props: { metadata: { title: 'Untitled document' } },
      children: [
        {
          name: 'section',
          children: [
            { name: 'heading', props: { text: 'Title', level: 1 } },
            { name: 'paragraph', props: { text: 'First paragraph.' } },
          ],
        },
      ],
    },
  },
  {
    id: 'docx-report',
    format: 'docx',
    title: 'Report with a statistic and a table',
    description:
      'A themed section showing the shapes that trip agents up: statistic props, and the column-major table model.',
    document: {
      name: 'docx',
      props: {
        metadata: { title: 'Quarterly report', author: 'Your name' },
        theme: 'minimal',
      },
      children: [
        {
          name: 'section',
          props: { meta: { title: 'Summary' } },
          children: [
            { name: 'heading', props: { text: 'Summary', level: 1 } },
            {
              name: 'paragraph',
              props: { text: 'One paragraph of context before the numbers.' },
            },
            {
              name: 'statistic',
              props: {
                number: '42',
                unit: '%',
                description: 'Year-on-year growth',
              },
            },
            {
              name: 'table',
              props: {
                columns: [
                  {
                    header: { content: 'Metric' },
                    cells: [{ content: 'Revenue' }, { content: 'Churn' }],
                  },
                  {
                    header: { content: 'Value' },
                    cells: [{ content: '1.2M' }, { content: '3%' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: 'pptx-minimal',
    format: 'pptx',
    title: 'Minimal presentation',
    description:
      'The smallest well-formed .pptx: root with a declared 16:9 canvas, one slide, one title text. The canvas stays: without it the renderer silently falls back to 4:3.',
    document: {
      name: 'pptx',
      props: { title: 'Untitled deck', slideWidth: 13.333, slideHeight: 7.5 },
      children: [
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'Title slide', style: 'title' } },
          ],
        },
      ],
    },
  },
  {
    id: 'pptx-deck',
    format: 'pptx',
    title: 'Two-slide deck',
    description:
      'A 16:9 deck with a title slide and a content slide, using the named text styles.',
    document: {
      name: 'pptx',
      props: {
        title: 'Quarterly deck',
        theme: 'default',
        slideWidth: 13.333,
        slideHeight: 7.5,
      },
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: { text: 'Quarterly review', style: 'title' },
            },
            {
              name: 'text',
              props: {
                text: 'Where we are and what changes next',
                style: 'subtitle',
              },
            },
          ],
        },
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'Agenda', style: 'heading1' } },
            {
              name: 'text',
              props: { text: 'Results\nRisks\nNext quarter', style: 'body' },
            },
          ],
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export interface CatalogComponent {
  name: string;
  category: string;
  description: string;
  /** What good use of this component looks like — one sentence, from the notes table. */
  designNote?: string;
  hasChildren: boolean;
  /** True for the one component a document's tree is rooted at. */
  root: boolean;
  /** Renderer ids whose profile accepts this component. */
  renderers: string[];
  /** Direct children the schema accepts, absent for leaves. */
  allowedChildren?: string[];
  /** Containers that accept this component, derived from every profile. */
  allowedParents: string[];
  /** #236, once the registries carry it. */
  stability?: string;
  deprecated?: unknown;
}

export interface CatalogRenderer {
  id: string;
  /** The renderer used when a document omits `renderer`. */
  default: boolean;
  /**
   * Whether this renderer's backend loads on this host.
   *
   * Registration is not availability. A profile with `available: false`
   * accepts the components listed below and then fails every render.
   */
  available: boolean;
  /** The command that would make an unavailable renderer available. */
  installHint?: string;
  /** Components this profile accepts. */
  components: string[];
  /** Components other profiles of this format accept and this one does not. */
  unsupported: string[];
}

export interface CatalogFormat {
  name: FormatName;
  extension: string;
  label: string;
  rootComponent: string;
  defaultRenderer: string;
  renderers: CatalogRenderer[];
  components: CatalogComponent[];
  themes: string[];
  starters: Starter[];
}

export interface Catalog {
  formats: CatalogFormat[];
  diagnostics: Diagnostic[];
}

/**
 * Build the catalogue for one format.
 *
 * The component list is the union of the schema profiles, not the registry:
 * the schema is what a document is actually validated against, so a registry
 * entry that never made it into a profile would be a promise this server
 * cannot keep. It is reported as a diagnostic instead — and as a failing drift
 * test.
 */
async function catalogFormat(
  format: FormatName,
  deps: ToolDeps,
  diagnostics: Diagnostic[]
): Promise<CatalogFormat> {
  const schemas = formatSchemas(format);
  const adapter = deps.getAdapter(format);

  let rendererIds: string[] = [];
  const availability = new Map<string, boolean>();
  const installHints = new Map<string, string>();
  // Whether the probe ran at all, which is a different question from what it
  // found. Without it, a probe that threw and a profile the cores never
  // registered are indistinguishable below, and both would be called usable.
  let probed = false;
  try {
    // Statuses, not ids: this catalogue is what an agent picks a renderer from,
    // so a renderer that cannot load here has to say so at the point of choice
    // rather than at the first render.
    for (const status of await adapter.rendererStatuses()) {
      rendererIds.push(status.id);
      availability.set(status.id, status.available);
      if (status.installHint) installHints.set(status.id, status.installHint);
    }
    probed = true;
  } catch (error) {
    diagnostics.push(
      diagnostic(
        ERROR_CODES.DEPENDENCY_MISSING,
        `Could not read renderer ids for ${format}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { severity: 'warning', context: { format } }
      )
    );
  }
  // The cores register the renderers; the schemas profile them. Order comes
  // from the cores (defaults first) and profiles the cores do not know about
  // are appended rather than dropped, so a mismatch is visible instead of
  // quietly resolved in one side's favour.
  const profileIds = schemas.profiles.map((profile) => profile.id);
  const orderedIds = [
    ...rendererIds,
    ...profileIds.filter((id) => !rendererIds.includes(id)),
  ];
  for (const id of orderedIds) {
    if (!profileIds.includes(id)) {
      diagnostics.push(
        diagnostic(
          ERROR_CODES.INTERNAL,
          `Renderer "${id}" is registered for ${format} but the generated schema has no profile for it.`,
          { severity: 'warning', context: { format, renderer: id } }
        )
      );
    } else if (!rendererIds.includes(id)) {
      diagnostics.push(
        diagnostic(
          ERROR_CODES.INTERNAL,
          `The generated ${format} schema profiles renderer "${id}", which the core does not register.`,
          { severity: 'warning', context: { format, renderer: id } }
        )
      );
    }
  }

  const byRenderer = new Map(
    schemas.profiles.map((profile) => [profile.id, profile])
  );
  const allNames = [
    ...new Set(schemas.profiles.flatMap((p) => [...p.components.keys()])),
  ];

  const metadata = new Map(
    registryEntries(format).map((entry) => [entry.name, entry])
  );
  for (const entry of metadata.values()) {
    if (!allNames.includes(entry.name)) {
      diagnostics.push(
        diagnostic(
          ERROR_CODES.INTERNAL,
          `Component "${entry.name}" is in the ${format} registry but in no renderer profile of the generated schema.`,
          { severity: 'warning', context: { format, component: entry.name } }
        )
      );
    }
  }

  // Parents are derived from what the schema actually accepts, so a container
  // that was narrowed downstream reports honestly.
  const parents = new Map<string, Set<string>>();
  for (const profile of schemas.profiles) {
    for (const [name, branch] of profile.components) {
      for (const child of childNamesOf(branch, schemas.definitions) ?? []) {
        let holders = parents.get(child);
        if (!holders) parents.set(child, (holders = new Set()));
        holders.add(name);
      }
    }
  }

  const components: CatalogComponent[] = allNames.map((name) => {
    const entry = metadata.get(name);
    const renderers = orderedIds.filter((id) =>
      byRenderer.get(id)?.components.has(name)
    );
    const branch = schemas.profiles
      .map((profile) => profile.components.get(name))
      .find((found): found is SchemaNode => found !== undefined)!;
    const children = childNamesOf(branch, schemas.definitions);
    if (!entry) {
      diagnostics.push(
        diagnostic(
          ERROR_CODES.INTERNAL,
          `Component "${name}" is in the generated ${format} schema but not in the registry, so it has no description.`,
          { severity: 'warning', context: { format, component: name } }
        )
      );
    }
    const note = designNote(format, name);
    if (note === undefined) {
      diagnostics.push(
        diagnostic(
          ERROR_CODES.INTERNAL,
          `Component "${name}" has no design note, so jto_discover can say what it accepts but not what good use of it looks like.`,
          { severity: 'warning', context: { format, component: name } }
        )
      );
    }
    return {
      name,
      category: entry?.category ?? 'content',
      description: entry?.description ?? '',
      ...(note !== undefined && { designNote: note }),
      hasChildren: children !== undefined,
      root: name === schemas.rootComponent,
      renderers,
      ...(children !== undefined && { allowedChildren: children }),
      allowedParents: [...(parents.get(name) ?? [])].sort(),
      ...(entry?.stability !== undefined && { stability: entry.stability }),
      ...(entry?.deprecated !== undefined && { deprecated: entry.deprecated }),
    };
  });

  const themes = await builtinThemeNames(format, deps);
  if (themes.length === 0) {
    diagnostics.push(
      diagnostic(
        ERROR_CODES.DEPENDENCY_MISSING,
        `No built-in themes could be read for ${format}.`,
        {
          severity: 'info',
          suggestion:
            'Documents still render with their own inline theme, or with a theme file passed as themePath.',
          context: { format },
        }
      )
    );
  }

  return {
    name: format,
    extension: adapter.extension,
    label: adapter.label,
    rootComponent: schemas.rootComponent,
    defaultRenderer: orderedIds[0] ?? '',
    renderers: orderedIds.map((id, index) => ({
      id,
      default: index === 0,
      // Three cases, and they are not the same. A probed renderer answers for
      // itself. A profile the cores never registered has no status but is
      // already reported as drift above, so calling it unavailable would be a
      // second, worse description of that. And a probe that threw knows
      // nothing about any of them — reporting those as usable would contradict
      // the diagnostic pushed beside them.
      available: availability.get(id) ?? probed,
      ...(installHints.has(id) && { installHint: installHints.get(id)! }),
      components: [...(byRenderer.get(id)?.components.keys() ?? [])].sort(),
      unsupported: allNames
        .filter((name) => !byRenderer.get(id)?.components.has(name))
        .sort(),
    })),
    components,
    themes,
    starters: STARTERS.filter((starter) => starter.format === format),
  };
}

/** The whole catalogue, for the tool and the `jto://catalog` resource alike. */
export async function buildCatalog(
  deps: ToolDeps,
  formats: readonly FormatName[] = FORMAT_NAMES
): Promise<Catalog> {
  const diagnostics: Diagnostic[] = [];
  const built: CatalogFormat[] = [];
  for (const format of formats) {
    built.push(await catalogFormat(format, deps, diagnostics));
  }
  return { formats: built, diagnostics };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const starterSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    format: { type: 'string' as const },
    title: { type: 'string' as const },
    description: { type: 'string' as const },
    document: { type: 'object' as const, additionalProperties: true },
  },
  required: ['id', 'format', 'title', 'description'],
  additionalProperties: true,
};

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_discover',
    {
      title: 'Discover the authoring surface',
      description:
        'Formats, component names per format, renderer profiles and their ids, built-in themes, and starter documents you can copy and edit. Deliberately compact: no schemas. Call jto_describe_component for one component’s exact schema.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<{ format?: FormatName; includeStarters?: boolean }>({
        type: 'object',
        properties: {
          format: formatSchema,
          includeStarters: {
            type: 'boolean',
            description:
              'Include the starter documents inline. Default true; they are a few hundred bytes each.',
          },
        },
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema(
          {
            formats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  extension: { type: 'string' },
                  label: { type: 'string' },
                  rootComponent: {
                    type: 'string',
                    description: 'The component every document is rooted at.',
                  },
                  defaultRenderer: { type: 'string' },
                  renderers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        default: { type: 'boolean' },
                        available: {
                          type: 'boolean',
                          description:
                            "Whether this renderer's backend loads on this host. A renderer that is registered but unavailable accepts the components below and then fails every render.",
                        },
                        installHint: {
                          type: 'string',
                          description:
                            'The command that would make an unavailable renderer available.',
                        },
                        components: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        unsupported: {
                          type: 'array',
                          items: { type: 'string' },
                          description:
                            'Components another renderer of this format accepts and this one does not.',
                        },
                      },
                      required: [
                        'id',
                        'default',
                        'available',
                        'components',
                        'unsupported',
                      ],
                      additionalProperties: false,
                    },
                  },
                  components: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        category: { type: 'string' },
                        description: { type: 'string' },
                        designNote: {
                          type: 'string',
                          description:
                            'What good use of this component looks like, in one sentence.',
                        },
                        hasChildren: { type: 'boolean' },
                        root: { type: 'boolean' },
                        renderers: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        allowedChildren: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        allowedParents: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        stability: { type: 'string' },
                      },
                      required: [
                        'name',
                        'category',
                        'description',
                        'hasChildren',
                        'root',
                        'renderers',
                        'allowedParents',
                      ],
                      additionalProperties: true,
                    },
                  },
                  themes: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Built-in theme names, usable as the document’s props.theme or the tools’ theme option.',
                  },
                  starters: { type: 'array', items: starterSchema },
                },
                required: [
                  'name',
                  'extension',
                  'label',
                  'rootComponent',
                  'defaultRenderer',
                  'renderers',
                  'components',
                  'themes',
                  'starters',
                ],
                additionalProperties: false,
              },
            },
          }
          // `formats` is not required: a failure inside the handler comes back
          // as `{ ok: false, diagnostics }` and must stay a result, not become
          // a protocol error.
        )
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const formats =
            args.format !== undefined ? [args.format] : FORMAT_NAMES;
          const catalog = await buildCatalog(deps, formats);
          const includeStarters = args.includeStarters !== false;
          return success(
            {
              formats: catalog.formats.map((format) => ({
                ...format,
                starters: includeStarters
                  ? format.starters
                  : format.starters.map(({ document: _document, ...rest }) => ({
                      ...rest,
                    })),
              })),
            },
            catalog.diagnostics
          );
        })
      )
  );
}

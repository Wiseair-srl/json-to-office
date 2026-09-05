/**
 * Component Registry - SINGLE SOURCE OF TRUTH
 *
 * This is the ONLY place where standard components are defined.
 * All schema generators MUST use this registry.
 *
 * Adding a new component: Add it to STANDARD_COMPONENTS_REGISTRY below.
 * It will automatically be included in:
 * - StandardComponentDefinitionSchema (components.ts)
 * - ComponentDefinitionSchema (components.ts)
 * - generateUnifiedDocumentSchema (generator.ts)
 * - Monaco editor autocomplete
 * - Build-time JSON schemas
 */

import { Type, TSchema } from '@sinclair/typebox';
// Import directly from individual component files to avoid circular dependency
// (components.ts imports from this file, so we can't import from components.ts)
import { ReportPropsSchema } from './components/report';
import {
  SectionPropsSchema,
  createSectionPropsSchema,
} from './components/section';
import { ColumnsPropsSchema } from './components/columns';
import { HeadingPropsSchema } from './components/heading';
import { ParagraphPropsSchema } from './components/paragraph';
import { TextBoxPropsSchema } from './components/text-box';
import { ImagePropsSchema } from './components/image';
import { StatisticPropsSchema } from './components/statistic';
import { KeyTakeawaysPropsSchema } from './components/key-takeaways';
import { TablePropsSchema, createTablePropsSchema } from './components/table';
import { ListPropsSchema } from './components/list';
import { TocPropsSchema } from './components/toc';
import { DividerPropsSchema } from './components/divider';
import { HighchartsPropsSchema } from './components/highcharts';
import { ChartPropsSchema } from './components/chart';
import { VisualPropsSchema } from './components/visual';
import {
  DOCX_RENDERER_IDS,
  docxPropsSchemaForRenderer,
  type DocxRendererId,
} from './renderer';

/**
 * A position under a component's `props` where full component definitions are
 * embedded outside the shared `children` array.
 *
 * Declaring these here is what keeps the deep-validation walk aligned with the
 * live document schema: the same entry's `createPropsSchema` wires a recursive
 * component ref into these positions, and the walk visits exactly what is
 * declared. `embedded-component-regions.test.ts` probes each factory with a
 * marker schema and fails when a declaration and the factory disagree, so a
 * new embedded position cannot silently become a walk blind spot (#292).
 */
export interface EmbeddedComponentRegion {
  /** Path segments under `props`; `'*'` means every element of an array. */
  path: readonly string[];
  /**
   * `'component'` — the position holds one component definition;
   * `'component-array'` — it holds an array of them. Values of another legal
   * shape at the position (a string cell content, `'linkToPrevious'`) are
   * simply not walked.
   */
  arity: 'component' | 'component-array';
  /**
   * Whether the walk reports malformed entries (a non-object, a missing
   * `name`) at this position. True where the static props schema types the
   * position loosely (`Type.Any()` — the walk is its only structural checker);
   * false where the props schema already validates structure, so the walk only
   * adds per-component prop errors and must not double-report.
   */
  reportStructure: boolean;
}

/**
 * Component definition with metadata
 */
export interface StandardComponentDefinition {
  /** Component name identifier (e.g., 'heading', 'text', 'toc') */
  name: string;
  /** TypeBox schema for the component's props */
  propsSchema: TSchema;
  /** Whether this component can contain children */
  hasChildren: boolean;
  /**
   * Names of standard components allowed as direct children.
   * Only meaningful when hasChildren is true.
   * Plugin components are always allowed in addition to these.
   * Omit to allow the full recursive union (backward-compat).
   */
  allowedChildren?: readonly string[];
  /**
   * Factory that builds props with a live recursive ref (e.g., for section
   * header/footer, table cell content). When present and a recursive ref is
   * available, used instead of the static `propsSchema`.
   */
  createPropsSchema?: (recursiveRef: TSchema) => TSchema;
  /**
   * Where `createPropsSchema` embeds component definitions inside `props`.
   * Drives the deep-validation walk; must match the factory (enforced by
   * `embedded-component-regions.test.ts`). Omit when the component embeds
   * none.
   */
  embeddedComponents?: readonly EmbeddedComponentRegion[];
  /**
   * The renderers that can draw this component. Omitted means all of them.
   *
   * Only for a component whose backend gap is real, not a slice boundary: a
   * component listed here disappears from the other renderers' schema branch
   * entirely, so a schema-driven editor stops offering it rather than
   * offering it and failing at render time.
   */
  renderers?: readonly DocxRendererId[];
  /** Component category for organization */
  category: 'container' | 'content' | 'layout';
  /** Human-readable description */
  description: string;
  /** Special flags for this component */
  special?: {
    /** Has $schema field (only 'docx') */
    hasSchemaField?: boolean;
  };
}

/**
 * SINGLE SOURCE OF TRUTH for all standard components
 *
 * This is the ONLY place where standard components are defined.
 * All schema generators MUST use this registry.
 *
 * IMPORTANT: When adding a new component:
 * 1. Add the component definition to this array
 * 2. Import its props schema at the top of this file
 * 3. That's it! The component will automatically appear everywhere.
 */
export const STANDARD_COMPONENTS_REGISTRY: readonly StandardComponentDefinition[] =
  [
    // ========================================================================
    // Container Components (can contain children)
    // ========================================================================
    {
      name: 'docx',
      propsSchema: ReportPropsSchema,
      hasChildren: true,
      allowedChildren: ['section'],
      category: 'container',
      description:
        'Main document container - defines the overall document structure. Required as the root component.',
      special: {
        hasSchemaField: true, // Only docx root has $schema field
      },
    },
    {
      name: 'section',
      propsSchema: SectionPropsSchema,
      createPropsSchema: createSectionPropsSchema,
      embeddedComponents: [
        // The static schema types both regions as an array of Type.Any() (or
        // the 'linkToPrevious' literal), so the walk is their only structural
        // checker — report malformed entries too.
        { path: ['header'], arity: 'component-array', reportStructure: true },
        { path: ['footer'], arity: 'component-array', reportStructure: true },
      ],
      hasChildren: true,
      allowedChildren: [
        'heading',
        'paragraph',
        'image',
        'statistic',
        'table',
        'list',
        'toc',
        'divider',
        'highcharts',
        'chart',
        'visual',
        'columns',
        'text-box',
        'key-takeaways',
      ],
      category: 'container',
      description:
        'Section container - groups related content with optional title. Use for organizing document structure.',
    },
    {
      name: 'columns',
      propsSchema: ColumnsPropsSchema,
      hasChildren: true,
      allowedChildren: [
        'heading',
        'paragraph',
        'image',
        'statistic',
        'table',
        'list',
        'toc',
        'divider',
        'highcharts',
        'chart',
        'visual',
        'text-box',
        'key-takeaways',
      ],
      category: 'layout',
      description:
        'Multi-column layout - arranges content in 2-4 columns. Great for side-by-side content.',
    },
    {
      name: 'text-box',
      propsSchema: TextBoxPropsSchema,
      hasChildren: true,
      allowedChildren: ['heading', 'paragraph', 'image', 'divider'],
      category: 'layout',
      description:
        'Floating text container - allows positioning text anywhere on the page with absolute or relative positioning.',
    },

    // ========================================================================
    // Content Components (leaf nodes, no children)
    // ========================================================================
    {
      name: 'heading',
      propsSchema: HeadingPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Heading text - supports levels 1-6 for document hierarchy. Level 1 is largest. Never skip a level going down (1 → 3): the gap breaks the document outline.',
    },
    {
      name: 'paragraph',
      propsSchema: ParagraphPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Paragraph text - supports formatting like bold, italic, and color. Main content element.',
    },
    {
      name: 'image',
      propsSchema: ImagePropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Image element - displays images with optional caption. Supports various formats.',
    },
    {
      name: 'statistic',
      propsSchema: StatisticPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Statistic display - shows a number with description. Perfect for KPIs and metrics.',
    },
    {
      name: 'key-takeaways',
      propsSchema: KeyTakeawaysPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        "Key-takeaways block - 3–5 one-sentence takeaways under a label, drawn as the theme's takeaways recipe (rule, label role, list). Opens a report or a major section with its conclusions; the theme styles it, so never hand-build one from paragraphs.",
    },
    {
      name: 'table',
      propsSchema: TablePropsSchema,
      createPropsSchema: createTablePropsSchema,
      embeddedComponents: [
        // Cell content is `string | component`. The table's own props schema
        // already validates the cell structure, so the walk only adds the
        // per-component prop errors the loose static content ref misses —
        // reporting structure here would double-report.
        {
          path: ['columns', '*', 'header', 'content'],
          arity: 'component',
          reportStructure: false,
        },
        {
          path: ['columns', '*', 'cells', '*', 'content'],
          arity: 'component',
          reportStructure: false,
        },
      ],
      hasChildren: false,
      category: 'content',
      description:
        'Data table, declared COLUMN-MAJOR: `props.columns[]`, each with its own `header` and its own `cells[]` running down the column. Note the PPTX `table` is the other way round — rows of cells — so a table cannot be moved between the formats unchanged. Fixed column widths are points and must fit the page; leave some columns unsized so they share the leftover space.',
    },
    {
      name: 'list',
      propsSchema: ListPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'List element - bulleted or numbered list items. Supports nested lists.',
    },
    {
      name: 'toc',
      propsSchema: TocPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Table of contents - automatically generates TOC from document headings. Supports depth ranges and custom styles.',
    },
    {
      name: 'divider',
      propsSchema: DividerPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        "Horizontal divider - a thin line across the measure, for separating sections. Drawn as a Word paragraph border, so it stays a real Word object. Use this rather than collapsing a paragraph's line spacing to fake one.",
    },
    {
      name: 'highcharts',
      propsSchema: HighchartsPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Chart component powered by Highcharts - render line, bar, pie, heatmap, and more with rich options.',
    },
    {
      name: 'chart',
      propsSchema: ChartPropsSchema,
      hasChildren: false,
      // docx.js has no chart primitive at all, so this is a backend gap rather
      // than a slice boundary — the same reasoning that keeps `drawing-groups`
      // off the docxjs capability set.
      renderers: ['office-open'],
      category: 'content',
      description:
        'Native Word chart - editable, scalable, no export server needed. Requires renderer "office-open".',
    },
    {
      name: 'visual',
      propsSchema: VisualPropsSchema,
      hasChildren: false,
      category: 'content',
      description:
        'Free-canvas graphic for infographics, diagrams and layered compositions the document flow cannot express. Rasterized from a pptx slide by default; renderMode "native" draws it as an editable Word drawing group (renderer "office-open").',
    },
  ] as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a component definition by name
 */
export function getStandardComponent(
  name: string
): StandardComponentDefinition | undefined {
  return STANDARD_COMPONENTS_REGISTRY.find((c) => c.name === name);
}

/**
 * Get all standard component names
 */
export function getAllStandardComponentNames(): readonly string[] {
  return STANDARD_COMPONENTS_REGISTRY.map((c) => c.name);
}

/**
 * Get components by category
 */
export function getComponentsByCategory(
  category: StandardComponentDefinition['category']
): readonly StandardComponentDefinition[] {
  return STANDARD_COMPONENTS_REGISTRY.filter((c) => c.category === category);
}

/**
 * Get container components (components that can have children)
 */
export function getContainerComponents(): readonly StandardComponentDefinition[] {
  return STANDARD_COMPONENTS_REGISTRY.filter((c) => c.hasChildren);
}

/**
 * Get content components (components that cannot have children)
 */
export function getContentComponents(): readonly StandardComponentDefinition[] {
  return STANDARD_COMPONENTS_REGISTRY.filter((c) => !c.hasChildren);
}

/**
 * Check if a component name is a standard component
 */
export function isStandardComponent(name: string): boolean {
  return STANDARD_COMPONENTS_REGISTRY.some((c) => c.name === name);
}

// ============================================================================
// Schema Generation Helpers
// ============================================================================

/**
 * True when a props schema rejects `{}`, i.e. the `props` key cannot be omitted.
 *
 * Only object schemas are inspected. Anything else (a union, a bare ref) is
 * treated as demanding props, preserving the previous stricter behavior for
 * shapes this cannot reason about.
 */
function demandsProps(propsSchema: TSchema): boolean {
  const schema = propsSchema as { type?: string; required?: readonly string[] };
  return schema.type !== 'object' || (schema.required?.length ?? 0) > 0;
}

/**
 * Generate TypeBox schema object for a component.
 *
 * @param component - Component definition from the registry
 * @param childrenType - Schema for children items. For containers this should be
 *   a narrowed union of allowed children; for leaves omit it.
 * @returns TypeBox schema object for the component
 */
export function createComponentSchemaObject(
  component: StandardComponentDefinition,
  childrenType?: TSchema,
  selfRef?: TSchema,
  profile?: { renderer: DocxRendererId; requireDiscriminator: boolean }
): TSchema {
  const schema: Record<string, TSchema> = {
    name: Type.Literal(component.name),
    id: Type.Optional(Type.String()),
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          'When false, this component is filtered out and not rendered. Defaults to true. Useful for conditional component inclusion.',
      })
    ),
  };

  // Special handling for report component (has $schema field)
  if (component.special?.hasSchemaField) {
    schema.$schema = Type.Optional(Type.String({ format: 'uri' }));
    schema.renderer = profile
      ? profile.requireDiscriminator
        ? Type.Literal(profile.renderer, {
            description: 'Renderer backend for this document',
          })
        : Type.Optional(
            Type.Literal(profile.renderer, {
              description: 'Renderer backend. Omitted defaults to "docxjs".',
            })
          )
      : Type.Optional(
          Type.Union(
            DOCX_RENDERER_IDS.map((renderer) => Type.Literal(renderer)),
            {
              description: 'Renderer backend. Omitted defaults to "docxjs".',
            }
          )
        );
  }

  // selfRef (full union) is intentionally passed to createPropsSchema so that
  // header/footer sub-schemas and table cell content can reference any component.
  const basePropsSchema =
    component.createPropsSchema && selfRef
      ? component.createPropsSchema(selfRef)
      : component.propsSchema;
  const propsSchema = profile
    ? docxPropsSchemaForRenderer(
        component.name,
        basePropsSchema,
        profile.renderer
      )
    : basePropsSchema;

  // `props` is required only when the props schema itself demands a field.
  // The runtime validator treats an omitted `props` as `{}` and lets the props
  // schema decide (see deep-validator.ts), so `section`, `toc`, `image` and
  // `text-box` are legal without the key. Exporting `props` as unconditionally
  // required reddened documents that build: the playground flagged all 23
  // propless sections in the shipped tech-report template while every runtime
  // gate stayed green. The root `docx` node already carried this fix locally in
  // generator.ts; this generalizes it to every component.
  schema.props = demandsProps(propsSchema)
    ? propsSchema
    : Type.Optional(propsSchema);

  // Add children support if applicable. The root component requires its
  // `children` array — deep-validator.ts enforces the same rule, but only on
  // the fallback path it takes when the TypeBox check already failed. That
  // made the rule fire only as a side effect of `props` being required, so
  // relaxing `props` above would silently retire it. Nested containers may
  // legitimately be empty.
  if (component.hasChildren && childrenType) {
    schema.children = component.special?.hasSchemaField
      ? Type.Array(childrenType)
      : Type.Optional(Type.Array(childrenType));
  }

  return Type.Object(schema, {
    additionalProperties: false,
    description: component.description,
  });
}

/**
 * Generate an array of TypeBox schemas for all standard components.
 * Uses a flat recursive ref for all containers (legacy behavior).
 *
 * @param recursiveRef - Optional recursive reference for children
 * @returns Array of TypeBox schemas for all components in the registry
 */
export function createAllComponentSchemas(
  recursiveRef?: TSchema
): readonly TSchema[] {
  return STANDARD_COMPONENTS_REGISTRY.map((component) =>
    createComponentSchemaObject(component, recursiveRef)
  );
}

/**
 * Build all standard component schemas with per-container narrowed children.
 *
 * Resolves containers in dependency order so each container's children union
 * only references its allowedChildren. Plugin schemas are always included in
 * every container's children.
 *
 * @param selfRef - The Type.Recursive self-reference (used as fallback and for plugin children)
 * @param pluginSchemas - Plugin component schemas (always allowed in all containers)
 * @returns schemas array and a byName map for direct lookups
 */
export function createAllComponentSchemasNarrowed(
  selfRef: TSchema,
  pluginSchemas: TSchema[] = [],
  profile?: { renderer: DocxRendererId; requireDiscriminator: boolean }
): { schemas: TSchema[]; byName: Map<string, TSchema> } {
  // A component whose `renderers` excludes this profile is not built at all,
  // so it is absent from the union *and* from every container's narrowed
  // children — `allowedChildren` maps through these maps and drops what it
  // cannot find, which keeps the two lists from disagreeing.
  const drawnHere = (comp: StandardComponentDefinition): boolean =>
    !profile || !comp.renderers || comp.renderers.includes(profile.renderer);

  // Phase 1: Build leaf (non-container) component schemas — no children
  // selfRef is passed so factories (e.g. table) can wire up recursive refs.
  const leafSchemas = new Map<string, TSchema>();
  for (const comp of STANDARD_COMPONENTS_REGISTRY) {
    if (!drawnHere(comp)) continue;
    if (!comp.hasChildren) {
      leafSchemas.set(
        comp.name,
        createComponentSchemaObject(comp, undefined, selfRef, profile)
      );
    }
  }

  // Phase 2: Resolve containers in dependency order
  const containers = STANDARD_COMPONENTS_REGISTRY.filter(
    (c) => c.hasChildren && drawnHere(c)
  );
  const resolved = new Map<string, TSchema>();
  const pending = [...containers];

  while (pending.length > 0) {
    const before = pending.length;
    for (let i = pending.length - 1; i >= 0; i--) {
      const comp = pending[i];

      if (!comp.allowedChildren) {
        // No allowedChildren declared — fallback to full recursive ref
        resolved.set(
          comp.name,
          createComponentSchemaObject(comp, selfRef, selfRef, profile)
        );
        pending.splice(i, 1);
        continue;
      }

      // Check if all container dependencies are resolved
      const containerDeps = comp.allowedChildren.filter((name) =>
        containers.some((c) => c.name === name)
      );
      if (!containerDeps.every((d) => resolved.has(d))) continue;

      // Build narrowed children union
      const childSchemas = comp.allowedChildren
        .map((name) => resolved.get(name) ?? leafSchemas.get(name))
        .filter((s): s is TSchema => s !== undefined);

      const allChildSchemas = [...childSchemas, ...pluginSchemas];
      const childrenType =
        allChildSchemas.length === 1
          ? allChildSchemas[0]
          : Type.Union(allChildSchemas);

      resolved.set(
        comp.name,
        createComponentSchemaObject(comp, childrenType, selfRef, profile)
      );
      pending.splice(i, 1);
    }

    if (pending.length === before) {
      throw new Error(
        `Circular allowedChildren among: ${pending.map((c) => c.name).join(', ')}`
      );
    }
  }

  // Combine: containers (resolved) + leaves
  const byName = new Map([...resolved, ...leafSchemas]);
  return { schemas: [...byName.values()], byName };
}

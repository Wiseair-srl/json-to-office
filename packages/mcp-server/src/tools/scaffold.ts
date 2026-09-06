/**
 * `jto_scaffold` — a blueprint, a theme and the facts of a brief become a
 * draft workspace with a fill map.
 *
 * The failure this tool exists for is not a wrong call but a slow drift: an
 * agent asked for a report and left to decide look, structure and layout
 * alone at every node picks the safe generic option each time (#324). A
 * scaffold takes those decisions away. The blueprint chose the sections and
 * the blocks; the theme paints them; the profile is written onto the root so
 * validation judges the draft against its archetype from the first call; and
 * every slot the author still owes carries a `{{…}}` marker whose text is the
 * guidance for filling it.
 *
 * What comes back is a workspace, not detached JSON: a handle at revision 1,
 * and a fill map whose every pointer resolves at that revision — so the agent
 * fills slots through `jto_workspace_patch` without ever holding the
 * document. `jto_validate` reports the markers as advisory draft findings and
 * `generationReady: false`; `jto_generate` refuses until none remain.
 *
 * The brief and the outline fill what they can before the workspace opens.
 * The rule is small enough to state: a brief fact fills the metadata field of
 * that name and the slot of that name on the document's chrome — the cover
 * and the running head — never a body block, where `title` means something
 * else. A markdown outline fills the body: its `#` heading is the title, each
 * `##` heading in order is the next section opener's title, and the paragraph
 * lines beneath it are that section's body text markers in order. Deeper
 * headings, text before the first section and a second title map to nothing.
 * Whatever matches nothing is reported, not dropped silently.
 */

import {
  readBlockDefinitions,
  type Blueprint,
  type BlueprintFillEntry,
} from '@json-to-office/shared';
import type { McpServer } from '@modelcontextprotocol/server';

import type { FormatName } from '../lib/adapters.js';
import { loadCore } from '../lib/core.js';
import type { ToolDeps } from '../lib/deps.js';
import {
  ERROR_CODES,
  diagnostic,
  failure,
  guarded,
  success,
  toolResult,
  type Diagnostic,
} from '../lib/errors.js';
import { S, formatSchema, outputSchema } from '../lib/schema.js';
import { galleryDocument } from '../templates/gallery.js';
import {
  parsePointer,
  resolvePointer,
  setMember,
} from '../workspace/json-pointer.js';
import { workspaceSchema } from './workspace.js';

/** The blocks a brief fact may fill by slot name: document chrome, not body. */
const CHROME_BLOCKS: ReadonlySet<string> = new Set(['cover', 'running-head']);

/** Brief keys that also fill a metadata field under another name. */
const METADATA_ALIASES: Readonly<Record<string, string>> = {
  client: 'company',
};

export interface ScaffoldInput {
  format?: FormatName;
  blueprint: string;
  variant?: string;
  theme?: string;
  brief?: Record<string, string>;
  outline?: string;
  title?: string;
}

const fillEntrySchema = {
  type: 'object' as const,
  properties: {
    path: {
      type: 'string' as const,
      description:
        'RFC 6901 pointer into the workspace document at the returned revision; the value there is the marker. Patch it with `replace`.',
    },
    marker: { type: 'string' as const, description: 'The marker as written.' },
    guidance: {
      type: 'string' as const,
      description: 'The marker’s text: what to write there.',
    },
    kind: {
      type: 'string' as const,
      enum: ['slot', 'text', 'metadata'],
      description:
        '`slot` inside a block invocation, `text` in an ordinary component, `metadata` under props.metadata.',
    },
    block: { type: 'string' as const },
    slot: {
      type: 'string' as const,
      description: 'Dotted for a nested field (`items.label`).',
    },
    type: { type: 'string' as const },
    maxWords: { type: 'integer' as const },
    maxLength: { type: 'integer' as const },
    oneLine: { type: 'boolean' as const },
    required: { type: 'boolean' as const },
  },
  required: ['path', 'marker', 'guidance', 'kind'],
  additionalProperties: false,
};

/** A markdown outline, reduced to what the mapping reads. */
export interface Outline {
  title?: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
  /** Paragraphs before the first `##`: no section to put them in. */
  orphans: string[];
  /** A second `#`, or any `###` and deeper: the mapping has no place for them. */
  skippedHeadings: string[];
}

export function parseOutline(markdown: string): Outline {
  const outline: Outline = { sections: [], orphans: [], skippedHeadings: [] };
  let current: Outline['sections'][number] | undefined;
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0)
      (current?.paragraphs ?? outline.orphans).push(paragraph.join(' '));
    paragraph = [];
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      const [, hashes, text] = heading;
      if (hashes.length === 2) {
        current = { heading: text, paragraphs: [] };
        outline.sections.push(current);
      } else if (hashes.length === 1 && outline.title === undefined) {
        outline.title = text;
      } else {
        outline.skippedHeadings.push(text);
      }
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return outline;
}

/** The `/children/N` a pointer sits under, for grouping markers by section. */
function sectionOf(path: string): string | undefined {
  return path.match(/^\/children\/\d+/)?.[0];
}

interface Fill {
  /** The markers still owed, in document order. */
  remaining: BlueprintFillEntry[];
  filled: number;
  diagnostics: Diagnostic[];
}

/**
 * Write the brief and the outline into the document — in place, since the
 * document is about to be handed to the store and nothing else holds it —
 * and return the markers still owed. The order matters once: a title given in
 * both wins from the brief, because a fact beats an outline heading.
 */
export function applyFacts(
  document: Record<string, unknown>,
  fillMap: readonly BlueprintFillEntry[],
  brief: Readonly<Record<string, string>>,
  outline: Outline | undefined
): Fill {
  const done = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const write = (entry: BlueprintFillEntry, value: string): void => {
    setAt(document, entry.path, value);
    done.add(entry.path);
  };
  const pending = (): BlueprintFillEntry[] =>
    fillMap.filter((entry) => !done.has(entry.path));

  const facts: Record<string, string> = { ...brief };
  if (outline?.title !== undefined && facts.title === undefined)
    facts.title = outline.title;

  for (const [key, value] of Object.entries(facts)) {
    const metadataPaths = [key, METADATA_ALIASES[key]]
      .filter((name): name is string => name !== undefined)
      .map((name) => `/props/metadata/${name}`);
    const targets = pending().filter(
      (entry) =>
        (entry.kind === 'metadata' && metadataPaths.includes(entry.path)) ||
        (entry.kind === 'slot' &&
          entry.slot === key &&
          entry.block !== undefined &&
          CHROME_BLOCKS.has(entry.block))
    );
    if (targets.length === 0) {
      diagnostics.push(
        key in brief
          ? diagnostic(
              ERROR_CODES.BRIEF_UNUSED,
              `The brief’s "${key}" matches no metadata field or chrome slot of this variant; it was not written anywhere.`,
              {
                severity: 'warning',
                suggestion:
                  'Brief keys fill props.metadata.<key> and the <key> slot of the cover and running head. Put body content in the outline or patch it by fill-map pointer.',
                context: { key },
              }
            )
          : unmapped(
              `The outline’s title "${value}" found no title marker to fill.`,
              { headings: [value] }
            )
      );
    }
    for (const entry of targets) write(entry, value);
  }

  if (outline) {
    const openers = pending().filter(
      (entry) => entry.block === 'section-opener' && entry.slot === 'title'
    );
    outline.sections.forEach((section, index) => {
      const opener = openers[index];
      if (!opener) return;
      write(opener, section.heading);
      const bodies = pending().filter(
        (entry) =>
          entry.kind === 'text' &&
          sectionOf(entry.path) === sectionOf(opener.path)
      );
      section.paragraphs.forEach((text, i) => {
        if (bodies[i]) write(bodies[i], text);
      });
      const extra = section.paragraphs.length - bodies.length;
      if (extra > 0) {
        diagnostics.push(
          unmapped(
            `"${section.heading}" has ${extra} more paragraph${extra === 1 ? '' : 's'} than the variant’s section has body text slots; the rest were not written.`,
            { paragraphs: extra },
            sectionOf(opener.path)
          )
        );
      }
    });
    const extraSections = outline.sections.slice(openers.length);
    if (extraSections.length > 0) {
      diagnostics.push(
        unmapped(
          `The outline has ${outline.sections.length} sections and the variant ${openers.length}; ${extraSections.map((s) => `"${s.heading}"`).join(', ')} mapped to nothing.`,
          { headings: extraSections.map((s) => s.heading) }
        )
      );
    }
    if (outline.skippedHeadings.length > 0) {
      diagnostics.push(
        unmapped(
          `Only "##" headings map to sections; ${outline.skippedHeadings.map((h) => `"${h}"`).join(', ')} mapped to nothing (their paragraphs stayed with the enclosing section).`,
          { headings: outline.skippedHeadings }
        )
      );
    }
    if (outline.orphans.length > 0) {
      diagnostics.push(
        unmapped(
          `${outline.orphans.length} paragraph${outline.orphans.length === 1 ? '' : 's'} before the first "##" heading belong to no section and were not written.`,
          { paragraphs: outline.orphans.length }
        )
      );
    }
  }

  return { remaining: pending(), filled: done.size, diagnostics };
}

/** An outline piece with no place in the variant: reported, never dropped. */
function unmapped(
  message: string,
  context: { headings?: string[]; paragraphs?: number },
  path?: string
): Diagnostic {
  return diagnostic(ERROR_CODES.OUTLINE_UNMAPPED, message, {
    severity: 'warning',
    ...(path !== undefined && { path }),
    suggestion:
      'Add sections or paragraphs with jto_workspace_patch, pick a longer variant, or fold the outline into the structure the variant has.',
    context,
  });
}

/** Write at a pointer the fill map produced, so it is known to resolve. */
function setAt(root: unknown, pointer: string, value: unknown): void {
  const parsed = parsePointer(pointer);
  if (!parsed.ok)
    throw new Error(`fill map pointer ${pointer}: ${parsed.message}`);
  const parent = resolvePointer(root, parsed.tokens.slice(0, -1));
  if (!parent.found)
    throw new Error(`fill map pointer ${pointer} stops at ${parent.at}`);
  const last = parsed.tokens[parsed.tokens.length - 1];
  if (Array.isArray(parent.value)) parent.value[Number(last)] = value;
  else setMember(parent.value as Record<string, unknown>, last, value);
}

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_scaffold',
    {
      title: 'Scaffold a document from a blueprint',
      description:
        'The first move for a report: pick a blueprint from jto_discover (or jto://blueprints), name the theme and what you know of the brief, and get back a draft workspace — a handle at revision 1 — plus a fill map listing every `{{…}}` marker still owed: its JSON pointer, kind, budget and the guidance for filling it. The scaffold is schema- and semantic-valid, carries the block definitions it invokes, and names its quality profile, so jto_validate judges it against the archetype from the first call and reports the markers as advisory draft findings with `generationReady: false`; jto_generate refuses until every marker is replaced. Fill slots by pointer with jto_workspace_patch. A brief fact fills props.metadata.<key> and the <key> slot of the cover and running head; a markdown outline fills the body — `#` is the title, each `##` in order the next section opener, the paragraphs beneath it that section’s body text. Whatever matches nothing is reported.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: S<ScaffoldInput>({
        type: 'object',
        properties: {
          format: {
            ...formatSchema,
            description: 'Defaults to docx, the only format with blueprints.',
          },
          blueprint: {
            type: 'string',
            minLength: 1,
            description:
              'A blueprint id from jto_discover, e.g. "client-report".',
          },
          variant: {
            type: 'string',
            description:
              'A variant id of that blueprint; the first when omitted.',
          },
          theme: {
            type: 'string',
            description:
              'A built-in theme name; the blueprint’s recommended one when omitted. Changes the look, never what validation asks.',
          },
          brief: {
            type: 'object',
            description:
              'Facts of the brief by name — title, subtitle, client, date, author, confidentiality — written into the metadata field and the cover / running-head slot of the same name. Anything else is reported as unused.',
            additionalProperties: { type: 'string' },
          },
          outline: {
            type: 'string',
            description:
              'A markdown outline. `# Title` fills the title (the brief’s title wins); each `## Heading` fills the next section opener in order; the paragraphs under it fill that section’s body text markers in order. Extra sections or paragraphs are reported.',
          },
          title: {
            type: 'string',
            description:
              'Your own label for the workspace, echoed by jto_workspace_list; the brief’s title when omitted.',
          },
        },
        required: ['blueprint'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          workspace: workspaceSchema,
          blueprint: {
            type: 'object',
            description: 'What was instantiated.',
            properties: {
              id: { type: 'string' },
              variant: { type: 'string' },
              theme: { type: 'string' },
              profile: {
                type: 'string',
                description:
                  'Written to the document’s props.qualityProfile; jto_validate judges by it without being told.',
              },
              definitions: {
                type: 'string',
                description:
                  'The bundled template whose block definitions the scaffold carries under props.blocks.',
              },
              blocks: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'The definitions the document carries: the ones invoked and their dependencies.',
              },
            },
            required: ['id', 'variant', 'theme', 'profile', 'definitions'],
            additionalProperties: false,
          },
          fillMap: {
            type: 'array',
            items: fillEntrySchema,
            description:
              'Every marker still owed, in document order. Empty once the brief and outline filled everything.',
          },
          filled: {
            type: 'integer',
            description: 'Markers the brief and outline already filled.',
          },
        })
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const format = args.format ?? 'docx';
          const core = await loadCore(format);
          const ids = Object.keys(core?.blueprints ?? {}).sort();
          const blueprint: Blueprint | undefined =
            core?.blueprints[args.blueprint];
          if (!blueprint || !core?.instantiate) {
            return failure(
              ERROR_CODES.BLUEPRINT_NOT_FOUND,
              ids.length === 0
                ? `${format} ships no blueprints yet.`
                : `No ${format} blueprint "${args.blueprint}"; this server has ${ids.join(', ')}.`,
              {
                suggestion:
                  'jto_discover lists every blueprint with its variants; jto://blueprints carries the plans.',
                context: { format, blueprints: ids },
              }
            );
          }
          const variants = Object.keys(blueprint.variants);
          if (args.variant !== undefined && !blueprint.variants[args.variant]) {
            return failure(
              ERROR_CODES.BLUEPRINT_NOT_FOUND,
              `Blueprint "${blueprint.id}" has no variant "${args.variant}"; it has ${variants.join(', ')}.`,
              { context: { blueprint: blueprint.id, variants } }
            );
          }
          if (
            args.theme !== undefined &&
            !core.themeNames.includes(args.theme)
          ) {
            return failure(
              ERROR_CODES.THEME_NOT_FOUND,
              `"${args.theme}" is not a built-in ${format} theme; this server has ${core.themeNames.join(', ')}.`,
              {
                suggestion:
                  'Omit `theme` for the blueprint’s recommended one, or pick a name from jto_discover.',
                context: { themes: core.themeNames },
              }
            );
          }
          const template = galleryDocument(blueprint.definitions);
          const definitions = template
            ? readBlockDefinitions(template)
            : undefined;
          if (!definitions || Object.keys(definitions).length === 0) {
            // A package shipped without its own gallery is our defect, not
            // the caller's document or host.
            return failure(
              ERROR_CODES.INTERNAL,
              `Blueprint "${blueprint.id}" invokes the blocks of "${blueprint.definitions}", which this server’s bundled gallery does not carry.`,
              {
                suggestion:
                  'Reinstall @json-to-office/mcp-server; the gallery ships inside the package.',
              }
            );
          }

          const instantiated = core.instantiate(blueprint, {
            ...(args.variant !== undefined && { variant: args.variant }),
            ...(args.theme !== undefined && { theme: args.theme }),
            definitions,
          });
          const outline =
            args.outline !== undefined ? parseOutline(args.outline) : undefined;
          const fill = applyFacts(
            instantiated.document,
            instantiated.fillMap,
            args.brief ?? {},
            outline
          );

          const title = args.title ?? args.brief?.title ?? outline?.title;
          const created = await deps.workspaces().create({
            format,
            document: instantiated.document,
            ...(title !== undefined && { title }),
          });
          if (!created.ok) return created;

          const props = instantiated.document.props as Record<string, unknown>;
          const remaining = fill.remaining.length;
          return success(
            {
              workspace: created.record,
              blueprint: {
                id: blueprint.id,
                variant: instantiated.variant,
                theme: String(props.theme),
                profile: blueprint.profile,
                definitions: blueprint.definitions,
                blocks: Object.keys(
                  (props.blocks ?? {}) as Record<string, unknown>
                ),
              },
              fillMap: fill.remaining,
              filled: fill.filled,
            },
            [
              ...(created.warnings ?? []),
              ...fill.diagnostics,
              diagnostic(
                ERROR_CODES.SCAFFOLD_DRAFT,
                remaining === 0
                  ? 'Every marker was filled from the brief and outline; jto_validate should report generationReady.'
                  : `${remaining} marker${remaining === 1 ? '' : 's'} still owed; fill each fillMap.path with jto_workspace_patch, then jto_validate — jto_generate refuses while any remains.`,
                {
                  severity: 'info',
                  context: { remaining, filled: fill.filled },
                }
              ),
            ]
          );
        })
      )
  );
}

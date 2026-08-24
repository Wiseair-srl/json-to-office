/**
 * `jto_describe_component` — one component, exactly, and nothing else.
 *
 * The escape hatch that makes `jto_discover` safe to keep small. An agent that
 * knows a component exists asks here for the schema it must satisfy, and gets
 * the branch the validator itself dispatches on — not a paraphrase, and not
 * the 3 MB document schema it is a leaf of.
 *
 * Two reductions keep the answer readable, and both are reported rather than
 * silent:
 *
 * - Nested component unions are replaced by the list of names they accept.
 *   Inlined, `section` alone is 226 KB of its descendants' schemas — which is
 *   the same information as "call this tool again for `paragraph`", at four
 *   orders of magnitude more tokens.
 * - A single prop bigger than `MAX_PROP_SCHEMA_BYTES` is elided and named in
 *   `elided`, with the argument that brings it back. `props.themeOverrides` is
 *   a whole 191 KB theme schema; an agent asking about the root component
 *   almost never wants it, and the one that does can say so.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import { unionBranches } from '@json-to-office/shared';

import type { FormatName } from '../lib/adapters.js';
import type { ToolDeps } from '../lib/deps.js';
import { failure, guarded, success, toolResult } from '../lib/errors.js';
import { S, formatSchema, outputSchema } from '../lib/schema.js';
import {
  childNamesOf,
  deref,
  formatSchemas,
  isComponentUnion,
  registryEntries,
  type SchemaNode,
} from './discover.js';

/**
 * Codes this tool adds. They belong in `lib/errors.ts`' `ERROR_CODES` next to
 * the rest; they are declared here only because that file is another issue's
 * to edit.
 */
const UNKNOWN_COMPONENT = 'E_UNKNOWN_COMPONENT';
const UNKNOWN_RENDERER = 'E_UNKNOWN_RENDERER';

/**
 * Per-prop budget, in bytes of JSON.
 *
 * Sized from what the schema actually contains: every component prop in either
 * format is under 16 KiB except the four that embed a whole theme or template
 * model (`themeOverrides`, `componentDefaults`, `theme`, `templates`). So this
 * elides exactly the props that are documents in their own right and nothing
 * else.
 */
const MAX_PROP_SCHEMA_BYTES = 16 * 1024;

interface Elision {
  /** JSON Pointer into the returned `schema`. */
  pointer: string;
  prop: string;
  bytes: number;
  hint: string;
}

/**
 * Every component name a format's schema declares, under any renderer.
 *
 * Not memoized: `formatSchemas` already is, and a second cache would survive
 * the `resetSchemaCache` the tests use to prove generation is repeatable.
 */
function componentNamesOf(format: FormatName): Set<string> {
  return new Set(
    formatSchemas(format).profiles.flatMap((profile) => [
      ...profile.components.keys(),
    ])
  );
}

/** The other format, which is the only other place a component can live. */
function otherFormat(format: FormatName): FormatName {
  return format === 'docx' ? 'pptx' : 'docx';
}

/**
 * Which format's registry a collapsed union's names come from.
 *
 * Usually the one being described, but not always: a DOCX `visual` carries a
 * pptx slide in `props.elements`, so its child union names pptx components. A
 * hint that assumed the enclosing format would send an agent to a describe call
 * that fails, and the trail ends there.
 */
function unionFormat(names: string[], described: FormatName): FormatName {
  if (names.every((name) => componentNamesOf(described).has(name))) {
    return described;
  }
  const other = otherFormat(described);
  return names.every((name) => componentNamesOf(other).has(name))
    ? other
    : described;
}

/** What a nested component union collapses to. */
function unionStub(names: string[], described: FormatName): SchemaNode {
  const format = unionFormat(names, described);
  return {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string', enum: names } },
    description: `A nested component: one of ${names.join(', ')}. Call jto_describe_component with format "${format}" for its schema.`,
  };
}

/**
 * Copy a schema, collapsing component unions and collecting the definitions
 * the copy still needs.
 */
function collapse(
  node: unknown,
  definitions: Readonly<Record<string, SchemaNode>>,
  needed: Set<string>,
  described: FormatName
): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => collapse(entry, definitions, needed, described));
  }
  if (typeof node !== 'object' || node === null) return node;

  const object = node as SchemaNode;
  if (typeof object.$ref === 'string') {
    const target = deref(object, definitions);
    if (target && isComponentUnion(target)) {
      return unionStub(componentNames(target), described);
    }
    const match = /^#\/definitions\/(.+)$/.exec(object.$ref);
    if (match?.[1] !== undefined && definitions[match[1]]) needed.add(match[1]);
    return { ...object };
  }
  if (isComponentUnion(object)) {
    return unionStub(componentNames(object), described);
  }

  const copy: SchemaNode = {};
  for (const [key, value] of Object.entries(object)) {
    copy[key] = collapse(value, definitions, needed, described);
  }
  return copy;
}

function componentNames(union: unknown): string[] {
  return unionBranches(union)
    .map((branch) => {
      const name = (branch.properties as SchemaNode | undefined)?.name as
        | SchemaNode
        | undefined;
      return typeof name?.const === 'string' ? name.const : undefined;
    })
    .filter((name): name is string => name !== undefined);
}

/**
 * Elide oversized props in place, returning what was cut.
 *
 * Only top-level props are candidates: they are the unit an agent asks about
 * and the unit `expandProps` brings back, so cutting deeper would leave a hole
 * nothing can reopen.
 */
function elideLargeProps(
  schema: SchemaNode,
  keep: readonly string[]
): Elision[] {
  const props = (schema.properties as SchemaNode | undefined)?.props as
    | SchemaNode
    | undefined;
  const entries = props?.properties as SchemaNode | undefined;
  if (!entries) return [];

  const elided: Elision[] = [];
  for (const [prop, value] of Object.entries(entries)) {
    if (keep.includes(prop)) continue;
    const bytes = JSON.stringify(value).length;
    if (bytes <= MAX_PROP_SCHEMA_BYTES) continue;
    const description = (value as SchemaNode).description;
    entries[prop] = {
      ...(typeof description === 'string' && { description }),
      $comment: `Elided: ${bytes} bytes.`,
    };
    elided.push({
      pointer: `/properties/props/properties/${prop}`,
      prop,
      bytes,
      hint: `Call jto_describe_component again with expandProps: ["${prop}"] for this sub-schema.`,
    });
  }
  return elided;
}

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_describe_component',
    {
      title: 'Describe one component',
      description:
        'The exact JSON Schema one component must satisfy under one renderer, plus the children it accepts, the containers that accept it, and which renderers support it. Nested components collapse to their names — describe those separately rather than reading one giant schema.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<{
        format: FormatName;
        name: string;
        renderer?: string;
        expandProps?: string[];
      }>({
        type: 'object',
        properties: {
          format: formatSchema,
          name: {
            type: 'string',
            description:
              'Component name, as listed by jto_discover (e.g. "paragraph", "slide").',
            minLength: 1,
          },
          renderer: {
            type: 'string',
            description:
              'Renderer profile to describe the component under. Omit for the format default; profiles differ wherever a backend cannot draw something.',
          },
          expandProps: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Props to return in full even when oversized. Names come from a previous call’s `elided`.',
          },
        },
        required: ['format', 'name'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema(
          {
            component: {
              type: 'object',
              properties: {
                format: { type: 'string' },
                name: { type: 'string' },
                category: { type: 'string' },
                description: { type: 'string' },
                hasChildren: { type: 'boolean' },
                root: { type: 'boolean' },
                stability: { type: 'string' },
              },
              required: ['format', 'name', 'hasChildren', 'root'],
              additionalProperties: true,
            },
            renderer: {
              type: 'string',
              description: 'The profile `schema` was taken from.',
            },
            renderers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  default: { type: 'boolean' },
                  supported: { type: 'boolean' },
                },
                required: ['id', 'default', 'supported'],
                additionalProperties: false,
              },
            },
            schema: {
              type: 'object',
              description:
                'The component branch the validator dispatches on, with nested component unions collapsed and oversized props elided.',
              additionalProperties: true,
            },
            definitions: {
              type: 'object',
              description:
                'Targets of the `$ref`s left in `schema`, so it resolves on its own.',
              additionalProperties: true,
            },
            elided: {
              type: 'array',
              description: 'Props cut for size, and how to get them back.',
              items: {
                type: 'object',
                properties: {
                  pointer: { type: 'string' },
                  prop: { type: 'string' },
                  bytes: { type: 'integer' },
                  hint: { type: 'string' },
                },
                required: ['pointer', 'prop', 'bytes', 'hint'],
                additionalProperties: false,
              },
            },
            allowedChildren: {
              type: 'array',
              items: { type: 'string' },
              description: 'Absent when the component takes no children.',
            },
            allowedParents: { type: 'array', items: { type: 'string' } },
          }
          // Everything but the envelope is conditional on `ok`: an unknown
          // component comes back as a normal result with diagnostics, so
          // demanding `schema` here would turn that answer into the protocol
          // error the envelope exists to avoid.
        )
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const schemas = formatSchemas(args.format);
          const profiles = schemas.profiles;

          let rendererIds: string[] = [];
          try {
            rendererIds = [
              ...(await deps.getAdapter(args.format).rendererIds()),
            ];
          } catch {
            /* fall back to the order the schema declares */
          }
          const ordered = [
            ...rendererIds.filter((id) => profiles.some((p) => p.id === id)),
            ...profiles
              .map((profile) => profile.id)
              .filter((id) => !rendererIds.includes(id)),
          ];

          const known = [
            ...new Set(profiles.flatMap((p) => [...p.components.keys()])),
          ].sort();
          if (!known.includes(args.name)) {
            // The other format is checked before giving up: the DOCX `visual`
            // component embeds pptx elements, so "describe the chart you just
            // told me about" legitimately arrives here with the wrong format.
            const elsewhere = otherFormat(args.format);
            const availableElsewhere = componentNamesOf(elsewhere).has(
              args.name
            );
            return failure(
              UNKNOWN_COMPONENT,
              `No component "${args.name}" in ${args.format}.`,
              {
                suggestion: availableElsewhere
                  ? `It exists in ${elsewhere} — pass format: "${elsewhere}". Known ${args.format} components: ${known.join(', ')}.`
                  : `Known ${args.format} components: ${known.join(', ')}.`,
                context: {
                  format: args.format,
                  known,
                  ...(availableElsewhere && { availableIn: elsewhere }),
                },
              }
            );
          }

          const rendererId = args.renderer ?? ordered[0];
          if (rendererId === undefined || !ordered.includes(rendererId)) {
            return failure(
              UNKNOWN_RENDERER,
              `No renderer "${String(args.renderer)}" for ${args.format}.`,
              {
                suggestion: `Known ${args.format} renderers: ${ordered.join(', ')}.`,
                context: { format: args.format, known: ordered },
              }
            );
          }

          const profile = profiles.find((entry) => entry.id === rendererId)!;
          const branch = profile.components.get(args.name);
          if (!branch) {
            // Known to the format, absent from this profile: the renderer
            // cannot draw it. That is an answer, not a failure — the agent
            // needs to know which renderer can.
            const supporting = ordered.filter((id) =>
              profiles.find((p) => p.id === id)?.components.has(args.name)
            );
            return failure(
              UNKNOWN_COMPONENT,
              `The "${rendererId}" renderer does not support "${args.name}".`,
              {
                suggestion:
                  supporting.length > 0
                    ? `Renderers that do: ${supporting.join(', ')}.`
                    : 'No renderer of this format supports it.',
                context: { format: args.format, renderer: rendererId },
              }
            );
          }

          const needed = new Set<string>();
          const schema = collapse(
            branch,
            schemas.definitions,
            needed,
            args.format
          ) as SchemaNode;

          // Definitions are collapsed on the same terms and chased
          // transitively, so what comes back resolves without the document
          // schema behind it.
          const definitions: Record<string, unknown> = {};
          const queue = [...needed];
          while (queue.length > 0) {
            const key = queue.shift() as string;
            const target = schemas.definitions[key];
            if (definitions[key] !== undefined || !target) continue;
            const nested = new Set<string>();
            definitions[key] = collapse(
              target,
              schemas.definitions,
              nested,
              args.format
            );
            for (const next of nested) {
              if (definitions[next] === undefined) queue.push(next);
            }
          }

          const elided = elideLargeProps(schema, args.expandProps ?? []);
          const children = childNamesOf(branch, schemas.definitions);
          const entry = registryEntries(args.format).find(
            (candidate) => candidate.name === args.name
          );

          const parents = new Set<string>();
          for (const [name, candidate] of profile.components) {
            if (
              childNamesOf(candidate, schemas.definitions)?.includes(args.name)
            ) {
              parents.add(name);
            }
          }

          return success({
            component: {
              format: args.format,
              name: args.name,
              ...(entry !== undefined && {
                category: entry.category,
                description: entry.description,
              }),
              hasChildren: children !== undefined,
              root: args.name === schemas.rootComponent,
              ...(entry?.stability !== undefined && {
                stability: entry.stability,
              }),
              ...(entry?.deprecated !== undefined && {
                deprecated: entry.deprecated,
              }),
            },
            renderer: rendererId,
            renderers: ordered.map((id, index) => ({
              id,
              default: index === 0,
              supported:
                profiles.find((p) => p.id === id)?.components.has(args.name) ??
                false,
            })),
            schema,
            ...(Object.keys(definitions).length > 0 && { definitions }),
            elided,
            ...(children !== undefined && { allowedChildren: children }),
            allowedParents: [...parents].sort(),
          });
        })
      )
  );
}

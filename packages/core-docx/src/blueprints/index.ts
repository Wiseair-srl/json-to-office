/**
 * DOCX blueprints: document archetypes as data, and the one operation that
 * turns one into a document.
 *
 * The registry is the JSON files under `templates/blueprints`: the bundled
 * one is imported so a stale or missing `dist` cannot lose it, and the
 * directory is scanned for any other `*.docx.blueprint.json` beside it, so
 * adding a blueprint is a file. Each is validated against the shared
 * blueprint schema when this module loads, so a malformed one fails at import
 * rather than at scaffold time. `instantiate` copies
 * a variant's children, writes the recommended theme and the archetype's
 * quality profile onto the root, brings the block definitions the children
 * invoke — and the definitions those depend on — from the playground
 * template the blueprint names, and lists every `{{…}}` scaffold marker as a
 * fill-map entry: where it is, what kind of slot holds it, its budget and the
 * guidance the marker text carries. Nothing here composes or styles.
 */
import {
  blockDependencies,
  validateBlueprint,
  type Blueprint,
  type BlueprintFillEntry,
  type BlueprintVariant,
  type BlockSlot,
  type JsonBlockDefinition,
} from '@json-to-office/shared';
import { collectPlaceholders } from '@json-to-office/quality';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import clientReport from '../templates/blueprints/client-report.docx.blueprint.json';

function register(...candidates: unknown[]): Record<string, Blueprint> {
  const registry: Record<string, Blueprint> = {};
  for (const candidate of candidates) {
    const issues = validateBlueprint(candidate);
    if (issues.length > 0)
      throw new Error(
        `Invalid bundled blueprint: ${issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`
      );
    const blueprint = candidate as Blueprint;
    if (blueprint.format !== 'docx')
      throw new Error(`Blueprint ${blueprint.id} is not a DOCX blueprint.`);
    if (registry[blueprint.id])
      throw new Error(
        `Two bundled blueprints share the id "${blueprint.id}"; the later one would silently replace the earlier.`
      );
    registry[blueprint.id] = blueprint;
  }
  return registry;
}

/**
 * Blueprint files beside this module — `src/templates/blueprints` when run
 * from source, `dist/templates/blueprints` from the built package — that the
 * static import above does not already carry.
 */
function scanned(known: Readonly<Record<string, unknown>>): unknown[] {
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return [];
  }
  const directory = [
    join(here, '../templates/blueprints'),
    join(here, 'templates/blueprints'),
  ].find((path) => existsSync(path));
  if (!directory) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith('.docx.blueprint.json'))
    .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')))
    .filter((candidate) => {
      const id = (candidate as { id?: unknown } | null)?.id;
      return !(typeof id === 'string' && id in known);
    });
}

const bundled = register(clientReport);

/** Every bundled DOCX blueprint, by id. */
export const DOCX_BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  ...bundled,
  ...register(...scanned(bundled)),
};

export function docxBlueprint(id: string): Blueprint | undefined {
  return DOCX_BLUEPRINTS[id];
}

export type { BlueprintFillEntry };

export interface InstantiateBlueprintOptions {
  /** A variant id from `blueprint.variants`; the first when omitted. */
  variant?: string;
  /** Overrides the blueprint's recommended theme. */
  theme?: string;
  /**
   * The block definitions the variant invokes — the `props.blocks` of the
   * playground template the blueprint names. The scaffold carries the ones it
   * uses, plus their dependencies; nothing is looked up at render time.
   */
  definitions: Readonly<Record<string, JsonBlockDefinition>>;
  /** Metadata values that replace the variant's marked ones. */
  metadata?: Readonly<Record<string, string>>;
}

export interface InstantiatedBlueprint {
  document: Record<string, unknown>;
  fillMap: BlueprintFillEntry[];
  variant: string;
}

const MARKER = /^\{\{\s*([\s\S]*?)\s*\}\}$/;

export function instantiateDocxBlueprint(
  blueprint: Blueprint,
  options: InstantiateBlueprintOptions
): InstantiatedBlueprint {
  if (blueprint.format !== 'docx')
    throw new Error(
      `Blueprint ${blueprint.id} is a ${blueprint.format} blueprint; this instantiates DOCX ones.`
    );
  const variantId = options.variant ?? Object.keys(blueprint.variants)[0];
  const variant: BlueprintVariant | undefined = blueprint.variants[variantId];
  if (!variant)
    throw new Error(
      `Blueprint ${blueprint.id} has no variant "${variantId}"; it has ${Object.keys(
        blueprint.variants
      ).join(', ')}.`
    );
  const children = structuredClone(variant.children) as unknown[];
  const blocks = definitionsFor(children, options.definitions, blueprint);
  const document: Record<string, unknown> = {
    name: 'docx',
    props: {
      theme: options.theme ?? blueprint.theme,
      qualityProfile: blueprint.profile,
      ...(Object.keys(blocks).length > 0 && { blocks }),
      metadata: { ...variant.metadata, ...options.metadata },
    },
    children,
  };
  return { document, fillMap: fillMap(document, blocks), variant: variantId };
}

/** The definitions the children invoke, dependencies first, from `available`. */
function definitionsFor(
  children: unknown[],
  available: Readonly<Record<string, JsonBlockDefinition>>,
  blueprint: Blueprint
): Record<string, JsonBlockDefinition> {
  const refs = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const props = record.props as Record<string, unknown> | undefined;
    if (record.name === 'block' && typeof props?.ref === 'string')
      refs.add(props.ref);
    Object.values(record).forEach(visit);
  };
  visit(children);
  const result: Record<string, JsonBlockDefinition> = {};
  for (const ref of refs) {
    if (!available[ref])
      throw new Error(
        `Blueprint ${blueprint.id} invokes "${ref}", which ${blueprint.definitions} does not define.`
      );
    for (const name of [...blockDependencies(available, ref), ref])
      result[name] ??= structuredClone(available[name]);
  }
  return result;
}

function fillMap(
  document: unknown,
  blocks: Readonly<Record<string, JsonBlockDefinition>>
): BlueprintFillEntry[] {
  return collectPlaceholders(document)
    .filter((occurrence) => occurrence.match.kind === 'scaffold-marker')
    .map((occurrence) => {
      const guidance = occurrence.text.match(MARKER)?.[1] ?? occurrence.text;
      const base = { path: occurrence.path, marker: occurrence.text, guidance };
      if (occurrence.path.startsWith('/props/metadata/'))
        return { ...base, kind: 'metadata' as const };
      const slot = slotAt(document, occurrence.path, blocks);
      return slot
        ? { ...base, kind: 'slot' as const, ...slot }
        : { ...base, kind: 'text' as const };
    });
}

/** The declared slot a pointer inside an invocation's `slots` lands in. */
function slotAt(
  document: unknown,
  pointer: string,
  blocks: Readonly<Record<string, JsonBlockDefinition>>
):
  | Omit<BlueprintFillEntry, 'path' | 'marker' | 'guidance' | 'kind'>
  | undefined {
  const at = pointer.lastIndexOf('/props/slots/');
  if (at < 0) return undefined;
  const invocation = valueAt(document, pointer.slice(0, at)) as
    | { props?: { ref?: unknown } }
    | undefined;
  const ref = invocation?.props?.ref;
  if (typeof ref !== 'string' || !blocks[ref]) return undefined;
  const segments = pointer
    .slice(at + '/props/slots/'.length)
    .split('/')
    .map(unescape);
  let slot: BlockSlot | undefined = blocks[ref].slots[segments[0]];
  const names = [segments[0]];
  for (const segment of segments.slice(1)) {
    if (!slot) break;
    if (slot.type === 'array' && /^\d+$/.test(segment)) slot = slot.items;
    else if (slot.type === 'object') {
      slot = slot.properties?.[segment];
      names.push(segment);
    } else if (slot.type === 'component')
      break; // content inside the slot
    else slot = undefined;
  }
  if (!slot) return undefined;
  return {
    block: ref,
    slot: names.join('.'),
    type: slot.type,
    ...(slot.maxWords !== undefined && { maxWords: slot.maxWords }),
    ...(slot.maxLength !== undefined && { maxLength: slot.maxLength }),
    ...(slot.oneLine !== undefined && { oneLine: slot.oneLine }),
    ...(slot.required !== undefined && { required: slot.required }),
  };
}

function unescape(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** The value a JSON pointer names, or undefined. */
export function valueAt(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let current: unknown = root;
  for (const segment of pointer.split('/').slice(1).map(unescape)) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current && typeof current === 'object')
      current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  return current;
}

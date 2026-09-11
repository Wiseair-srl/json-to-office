/**
 * What instantiating a blueprint means in either format, so each core keeps
 * only the shape of its own root.
 *
 * A registry is the bundled JSON files, each validated against the shared
 * schema when the module loads (each core scans its own directory for more,
 * since this module also serves the browser). Instantiation copies a variant's children, brings the definitions
 * the children invoke — and the definitions those depend on — from the
 * playground template the blueprint names, and lists every `{{…}}` scaffold
 * marker as a fill-map entry: where it is, what kind of slot holds it, its
 * budget and the guidance the marker text carries. The core decides where its
 * metadata lives (`props.metadata` in a document, `props` in a deck) and hands
 * over the marker occurrences its placeholder detector found.
 */
import { blockDependencies } from '../blocks';
import type { BlockSlot, JsonBlockDefinition } from '../blocks';
import {
  validateBlueprint,
  type Blueprint,
  type BlueprintFillEntry,
  type BlueprintFormat,
  type BlueprintVariant,
} from './schema';

/** Validate and key candidate blueprints of one format by id. */
export function registerBlueprints(
  format: BlueprintFormat,
  candidates: readonly unknown[]
): Record<string, Blueprint> {
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
    if (blueprint.format !== format)
      throw new Error(
        `Blueprint ${blueprint.id} is not a ${format.toUpperCase()} blueprint.`
      );
    if (registry[blueprint.id])
      throw new Error(
        `Two bundled blueprints share the id "${blueprint.id}"; the later one would silently replace the earlier.`
      );
    registry[blueprint.id] = blueprint;
  }
  return registry;
}

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
  /**
   * The variant's children after a caller reshaped them — a deck whose slides
   * an outline redistributed (#421). The variant's own when omitted.
   *
   * They are instantiated in place of the variant's, so the definitions they
   * invoke and the fill map they produce describe what is actually in the
   * document. A reshaping that invents a block the blueprint's template does
   * not define fails here rather than at render time.
   */
  children?: readonly unknown[];
}

export interface InstantiatedBlueprint {
  document: Record<string, unknown>;
  fillMap: BlueprintFillEntry[];
  variant: string;
}

/** One `{{…}}` occurrence the core's placeholder detector found. */
export interface MarkerOccurrence {
  path: string;
  text: string;
}

export interface InstantiateRoot {
  /** The format, which is also the root component's name. */
  format: BlueprintFormat;
  /** Props the root carries besides theme, profile, blocks and metadata. */
  props?: Readonly<Record<string, unknown>>;
  /** JSON pointer prefix under which metadata lives: `/props/metadata` or `/props`. */
  metadataPointer: string;
  /** The scaffold markers in a document, in document order. */
  markers: (document: unknown) => readonly MarkerOccurrence[];
}

const MARKER = /^\{\{\s*([\s\S]*?)\s*\}\}$/;

/** The variant a request names, or the first; throws on a wrong format or a missing variant. */
export function selectVariant(
  blueprint: Blueprint,
  format: BlueprintFormat,
  variantId: string | undefined
): { id: string; variant: BlueprintVariant } {
  if (blueprint.format !== format)
    throw new Error(
      `Blueprint ${blueprint.id} is a ${blueprint.format} blueprint; this instantiates ${format.toUpperCase()} ones.`
    );
  const id = variantId ?? Object.keys(blueprint.variants)[0];
  const variant = blueprint.variants[id];
  if (!variant)
    throw new Error(
      `Blueprint ${blueprint.id} has no variant "${id}"; it has ${Object.keys(
        blueprint.variants
      ).join(', ')}.`
    );
  return { id, variant };
}

/**
 * Turn a blueprint into a draft document and the fill map of what it still
 * owes.
 *
 * The variant's children are copied — or the reshaped ones a caller passes as
 * `options.children` — and only the definitions they invoke come with them,
 * dependencies included. The fill map is computed from the document as built,
 * so every pointer in it resolves in the document returned beside it.
 */
export function instantiateBlueprint(
  blueprint: Blueprint,
  options: InstantiateBlueprintOptions,
  root: InstantiateRoot
): InstantiatedBlueprint {
  const { id: variantId, variant } = selectVariant(
    blueprint,
    root.format,
    options.variant
  );
  const children = structuredClone(
    options.children ?? variant.children
  ) as unknown[];
  const blocks = definitionsFor(children, options.definitions, blueprint);
  const metadata = { ...variant.metadata, ...options.metadata };
  const props: Record<string, unknown> = {
    theme: options.theme ?? blueprint.theme,
    qualityProfile: blueprint.profile,
    ...root.props,
    ...(Object.keys(blocks).length > 0 && { blocks }),
    ...(root.metadataPointer === '/props' ? metadata : { metadata }),
  };
  const document: Record<string, unknown> = {
    name: root.format,
    props,
    children,
  };
  return {
    document,
    fillMap: fillMap(document, blocks, root),
    variant: variantId,
  };
}

/** The definitions the children invoke, dependencies first, from `available`. */
export function definitionsFor(
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
  blocks: Readonly<Record<string, JsonBlockDefinition>>,
  root: InstantiateRoot
): BlueprintFillEntry[] {
  const metadataPrefix = `${root.metadataPointer}/`;
  return root.markers(document).map((occurrence) => {
    const guidance = occurrence.text.match(MARKER)?.[1] ?? occurrence.text;
    const base = { path: occurrence.path, marker: occurrence.text, guidance };
    // Under `/props` only a direct child is metadata: `/props/blocks/...` and
    // `/props/theme` are not, and a marker never lands in those anyway.
    if (
      occurrence.path.startsWith(metadataPrefix) &&
      !occurrence.path.slice(metadataPrefix.length).includes('/')
    )
      return { ...base, kind: 'metadata' as const };
    const slot = slotAt(document, occurrence.path, blocks);
    return slot
      ? { ...base, kind: 'slot' as const, ...slot }
      : { ...base, kind: 'text' as const };
  });
}

/** The declared slot a pointer inside an invocation's `slots` lands in. */
export function slotAt(
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

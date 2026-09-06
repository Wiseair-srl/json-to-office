/**
 * Editor assistance derived from a document's own block definitions.
 *
 * A published schema cannot know which blocks one document defines, so the
 * exported `block` component accepts any `ref` and any `slots`. Everything
 * here is computed from the definitions actually present — in the editor on
 * every change, on the server for a reference catalog — and expressed in
 * standard draft-07 so the JSON language service completes, hovers and
 * diagnoses exactly what the runtime validator will accept: the names in
 * `props.blocks`, each one's slots with their descriptions, defaults and
 * constraints, and the placement a component slot may not carry.
 */
import { Value } from '@sinclair/typebox/value';
import type { OfficeFormat } from '../rendering/types';
import { blockSlotsJsonSchema } from './metadata';
import {
  BLOCK_SLOT_PLACEMENT_PROPS,
  blockPointerKey,
  isBlockRecord,
  readBlockDefinitions,
  validateBlockDefinitions,
} from './evaluator';
import {
  BlockDefinitionsSchema,
  type BlockSlot,
  type JsonBlockDefinition,
} from './schema';

type Schema = Record<string, any>;

/** A block invocation as authored: the component the editor inserts. */
export interface BlockInvocationExample {
  name: 'block';
  props: { ref: string; slots?: Record<string, unknown> };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function range(
  minimum: number | undefined,
  maximum: number | undefined,
  unit: string
): string | undefined {
  if (minimum !== undefined && maximum !== undefined)
    return minimum === maximum
      ? `${minimum} ${unit}`
      : `${minimum}–${maximum} ${unit}`;
  if (minimum !== undefined) return `at least ${minimum} ${unit}`;
  if (maximum !== undefined) return `at most ${maximum} ${unit}`;
  return undefined;
}

/**
 * A slot's contract as short facts, in one order, for every place that shows
 * it: the editor hover, the AI prompt, a catalog summary. "Required" means
 * the caller must supply a value — a slot with a default never is.
 */
export function blockSlotFacts(slot: BlockSlot): string[] {
  const facts: string[] = [];
  if (slot.required && slot.default === undefined) facts.push('Required');
  if (slot.default !== undefined)
    facts.push(`Default: \`${JSON.stringify(slot.default)}\``);
  if (slot.type === 'component')
    facts.push('A component; placement stays in the definition');
  if (slot.enum)
    facts.push(
      `One of ${slot.enum.map((value) => `\`${JSON.stringify(value)}\``).join(', ')}`
    );
  const length = range(slot.minLength, slot.maxLength, 'characters');
  if (length) facts.push(length);
  if (slot.maxWords !== undefined) facts.push(`at most ${slot.maxWords} words`);
  if (slot.oneLine) facts.push('one line');
  const bounds = range(slot.minimum, slot.maximum, '');
  if (bounds) facts.push(bounds.trim());
  const entries = range(slot.minItems, slot.maxItems, 'entries');
  if (entries) facts.push(entries);
  if (slot.role) facts.push(`Role: ${slot.role}`);
  return facts;
}

/** The hover text for a slot: its description, then its contract in one line. */
export function blockSlotMarkdown(slot: BlockSlot): string {
  return [slot.description, blockSlotFacts(slot).join(' · ')]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * JSON Schema for one slot as the editor should see it. Unlike the portable
 * `blockSlotJsonSchema`, a component slot references the real component
 * definition — so a chart placed in it completes like any other chart — with
 * the placement props the runtime rejects flagged at the key they appear on.
 */
export function blockSlotEditorSchema(
  slot: BlockSlot,
  componentRef?: Schema
): Schema {
  let schema: Schema;
  if (slot.type === 'component') {
    schema = componentRef
      ? {
          allOf: [
            componentRef,
            {
              properties: {
                props: {
                  propertyNames: {
                    not: { enum: [...BLOCK_SLOT_PLACEMENT_PROPS] },
                    errorMessage:
                      'Block placement belongs in the definition, not in a component slot.',
                  },
                },
              },
            },
          ],
        }
      : {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        };
  } else {
    const { oneLine, properties, items, ...rest } = slot;
    // Runtime-only facts leave the schema and go into the hover text.
    for (const key of ['role', 'required', 'maxWords', 'description'] as const)
      delete rest[key];
    schema = { ...rest };
    if (oneLine) schema.pattern = '^[^\\r\\n]*$';
    if (items) schema.items = blockSlotEditorSchema(items, componentRef);
    if (properties) {
      schema.properties = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          blockSlotEditorSchema(value, componentRef),
        ])
      );
      schema.required = Object.entries(properties)
        .filter(([, value]) => value.required && value.default === undefined)
        .map(([key]) => key);
      schema.additionalProperties = false;
    }
  }
  if (slot.description) schema.description = slot.description;
  const markdown = blockSlotMarkdown(slot);
  if (markdown) schema.markdownDescription = markdown;
  return schema;
}

/** The `slots` object of an invocation of this definition. */
export function blockSlotsEditorSchema(
  definition: JsonBlockDefinition,
  componentRef?: Schema
): Schema {
  return {
    type: 'object',
    additionalProperties: false,
    description:
      'Input values keyed by the slot names declared in the referenced block definition.',
    properties: Object.fromEntries(
      Object.entries(definition.slots).map(([key, slot]) => [
        key,
        blockSlotEditorSchema(slot, componentRef),
      ])
    ),
    required: Object.entries(definition.slots)
      .filter(([, slot]) => slot.required && slot.default === undefined)
      .map(([key]) => key),
  };
}

/**
 * The `props` of a `block` component given this document's definitions:
 * `ref` enumerates the names with their descriptions, and each name
 * dispatches `slots` to its own schema. With no definitions the reference
 * stays a free string — the runtime says which name is missing.
 */
export function blockInvocationPropsSchema(
  definitions: Record<string, JsonBlockDefinition>,
  componentRef?: Schema
): Schema {
  const names = Object.keys(definitions);
  const schema: Schema = {
    type: 'object',
    additionalProperties: false,
    required: ['ref'],
    properties: {
      ref: {
        type: 'string',
        minLength: 1,
        description: 'Name in this document’s props.blocks.',
        ...(names.length && {
          anyOf: names.map((name) => ({
            const: name,
            type: 'string',
            description:
              definitions[name].description ??
              `Block "${name}", defined in this document.`,
          })),
        }),
      },
      slots: {
        type: 'object',
        description:
          'Input values keyed by the slot names declared in the referenced block definition.',
      },
    },
  };
  if (names.length)
    schema.allOf = names.map((name) => ({
      if: { properties: { ref: { const: name } }, required: ['ref'] },
      then: {
        properties: {
          slots: blockSlotsEditorSchema(definitions[name], componentRef),
        },
      },
    }));
  return schema;
}

/** Where the document-aware invocation props go in an exported schema. */
export interface DocumentBlockTarget {
  /** A component definition under `definitions`, typically one per renderer. */
  name: string;
  /**
   * What a component slot accepts — the content a slide or a section holds,
   * as a reference into the same schema. Omitted, a component slot only asks
   * for a `name`.
   */
  componentRef?: Schema;
}

/**
 * Install the document-aware invocation props on every `block` branch inside
 * the targeted component definitions — the definition's own branch and the
 * copies a container inlines for its children — so an invocation completes
 * the same wherever a slide or section places it. References out of the
 * definition are not followed: block bodies live in their own derived
 * definitions and keep their binding-aware props. Mutates in place; call on
 * a copy of the shared schema.
 */
export function applyDocumentBlocksToSchema(
  schema: Schema,
  definitions: Record<string, JsonBlockDefinition>,
  targets: readonly DocumentBlockTarget[]
): void {
  for (const target of targets) {
    const definition = schema.definitions?.[target.name];
    if (!definition) continue;
    const props = blockInvocationPropsSchema(definitions, target.componentRef);
    const seen = new Set<object>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const value = node as Schema;
      if (value.properties?.name?.const === 'block' && value.properties.props) {
        value.properties.props = clone(props);
        return;
      }
      for (const [key, child] of Object.entries(value))
        if (key !== '$ref') walk(child);
    };
    walk(definition);
  }
}

/** Every `block` invocation reachable from a node, in document order. */
function invocations(
  node: unknown,
  visit: (ref: string, invocation: Record<string, unknown>) => void
): void {
  if (Array.isArray(node)) {
    node.forEach((item) => invocations(item, visit));
    return;
  }
  if (!isBlockRecord(node)) return;
  if (
    node.name === 'block' &&
    isBlockRecord(node.props) &&
    typeof node.props.ref === 'string'
  )
    visit(node.props.ref, node);
  for (const value of Object.values(node)) invocations(value, visit);
}

/**
 * The definitions a block needs beside itself, dependencies first, so a
 * copied definition never leaves an unresolved reference behind. Unknown
 * references and cycles are skipped: the runtime reports those.
 */
export function blockDependencies(
  definitions: Record<string, JsonBlockDefinition>,
  name: string
): string[] {
  const order: string[] = [];
  const seen = new Set<string>([name]);
  const walk = (current: string): void => {
    const definition = Object.prototype.hasOwnProperty.call(
      definitions,
      current
    )
      ? definitions[current]
      : undefined;
    if (!definition) return;
    invocations(
      [definition.body, definition.section, definition.slide],
      (ref) => {
        if (seen.has(ref)) return;
        seen.add(ref);
        if (!Object.prototype.hasOwnProperty.call(definitions, ref)) return;
        walk(ref);
        order.push(ref);
      }
    );
  };
  walk(name);
  return order;
}

function exampleValue(
  slot: BlockSlot,
  name: string,
  format: OfficeFormat
): unknown {
  if (slot.default !== undefined) return clone(slot.default);
  if (slot.enum?.length) return slot.enum[0];
  switch (slot.type) {
    case 'string':
      return name;
    case 'number':
    case 'integer': {
      const minimum = slot.minimum ?? 0;
      return slot.maximum !== undefined && slot.maximum < minimum
        ? slot.maximum
        : minimum;
    }
    case 'boolean':
      return true;
    case 'array': {
      // Typical cardinality: three entries, pulled inside the declared bounds.
      const count = Math.min(
        Math.max(3, slot.minItems ?? 0),
        slot.maxItems ?? Number.POSITIVE_INFINITY
      );
      const item = slot.items ?? { type: 'string' };
      return Array.from({ length: count }, (_, index) =>
        exampleValue(item, `${name} ${index + 1}`, format)
      );
    }
    case 'object':
      return exampleSlots(slot.properties ?? {}, format);
    case 'component':
      return format === 'docx'
        ? { name: 'paragraph', props: { text: name } }
        : { name: 'text', props: { text: name } };
    default:
      return name;
  }
}

/** Required slots and role-bearing chrome; everything else stays omitted. */
function exampleSlots(
  slots: Record<string, BlockSlot>,
  format: OfficeFormat
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(slots)
      .filter(
        ([, slot]) => (slot.required && slot.default === undefined) || slot.role
      )
      .map(([key, slot]) => [key, exampleValue(slot, key, format)])
  );
}

/**
 * A valid invocation to insert: the first one the source document makes, if
 * it makes one — real content, at the cardinality its author chose — else
 * one synthesized from the slots at typical cardinality.
 */
export function blockInvocationExample(
  name: string,
  definition: JsonBlockDefinition,
  options: { document?: unknown; format: OfficeFormat }
): BlockInvocationExample {
  let found: BlockInvocationExample | undefined;
  if (isBlockRecord(options.document)) {
    // Authored slides only: the definitions themselves also invoke blocks.
    const authored = Object.fromEntries(
      Object.entries(options.document).filter(([key]) => key !== 'props')
    );
    invocations(authored, (ref, invocation) => {
      if (found || ref !== name) return;
      const props = invocation.props as Record<string, unknown>;
      found = {
        name: 'block',
        props: {
          ref,
          ...(isBlockRecord(props.slots) && { slots: clone(props.slots) }),
        },
      };
    });
  }
  return (
    found ?? {
      name: 'block',
      props: {
        ref: name,
        slots: exampleSlots(definition.slots, options.format),
      },
    }
  );
}

/** An authoring reference extracted from a complete document. */
export interface BlockReference {
  name: string;
  format: OfficeFormat;
  /** The document the definition comes from. */
  template: string;
  definitionPointer: string;
  description: string;
  definition: JsonBlockDefinition;
  /** Portable slot schema, as `jto://blocks` publishes it. */
  slotsSchema: Record<string, unknown>;
  /** A valid invocation at typical cardinality. */
  example: BlockInvocationExample;
  /** Other definitions of the same document this one invokes, dependencies first. */
  dependencies: string[];
}

/**
 * Every block a complete document defines, as a reference an editor or an
 * agent can copy: definition, dependencies and a working invocation. A
 * document whose definitions do not validate contributes nothing — a
 * reference must be copyable as is.
 */
export function blockReferencesFromDocument(
  document: unknown,
  source: { template: string; format: OfficeFormat }
): BlockReference[] {
  const definitions = readBlockDefinitions(document);
  if (
    !Value.Check(BlockDefinitionsSchema, definitions) ||
    validateBlockDefinitions(definitions, source.format).length > 0
  )
    return [];
  return Object.entries(definitions).map(([name, definition]) => ({
    name,
    format: source.format,
    template: source.template,
    definitionPointer: `/props/blocks/${blockPointerKey(name)}`,
    description: definition.description ?? '',
    definition,
    slotsSchema: blockSlotsJsonSchema(definition),
    example: blockInvocationExample(name, definition, {
      document,
      format: source.format,
    }),
    dependencies: blockDependencies(definitions, name),
  }));
}

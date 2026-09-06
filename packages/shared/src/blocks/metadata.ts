import { Value } from '@sinclair/typebox/value';
import {
  BlockDefinitionsSchema,
  blockSlotJsonSchema,
  type BlockSlot,
  type BlockSlotRole,
  type JsonBlockDefinition,
} from './schema';
import {
  blockPointerKey,
  blockValueAt,
  blockWordCount,
  isBlockRecord,
  readBlockDefinitions,
} from './evaluator';

export function blockSlotsJsonSchema(
  definition: JsonBlockDefinition
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(definition.slots).map(([key, slot]) => [
        key,
        blockSlotJsonSchema(slot),
      ])
    ),
    required: Object.entries(definition.slots)
      .filter(([, slot]) => slot.required && slot.default === undefined)
      .map(([key]) => key),
  };
}

/** Authored definitions and fill pointers for exactly this document revision. */
export function documentBlockMetadata(document: unknown) {
  const definitions = readBlockDefinitions(document);
  if (!Value.Check(BlockDefinitionsSchema, definitions))
    return { definitions: [], invocations: [], invalidDefinitions: true };
  const invocations: {
    ref: string;
    path: string;
    slotsPath: string;
    defined: boolean;
  }[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}/${i}`));
      return;
    }
    if (!isBlockRecord(value)) return;
    if (
      value.name === 'block' &&
      isBlockRecord(value.props) &&
      typeof value.props.ref === 'string'
    )
      invocations.push({
        ref: value.props.ref,
        path,
        slotsPath: `${path}/props/slots`,
        defined: Object.prototype.hasOwnProperty.call(
          definitions,
          value.props.ref
        ),
      });
    for (const [key, item] of Object.entries(value)) {
      if (path === '/props' && key === 'blocks') continue;
      walk(item, `${path}/${blockPointerKey(key)}`);
    }
  };
  walk(document, '');
  return {
    definitions: Object.entries(definitions).map(([name, definition]) => ({
      name,
      definitionPointer: `/props/blocks/${blockPointerKey(name)}`,
      definition,
      slotsSchema: blockSlotsJsonSchema(definition),
    })),
    invocations,
    invalidDefinitions: false,
  };
}

/** Compiled pointer → authored pointer. */
export type BlockSourceMap = Readonly<Record<string, string>>;
/** A document with every block lowered in place, and how to get back. */
export interface ExpandedBlocks<T> {
  document: T;
  sourceMap: BlockSourceMap;
  /** Authored pointers of every expanded invocation, in document order. */
  blocks: readonly string[];
}

export interface BlockSlotBudget {
  block: string;
  slot: string;
  path: string;
  words: number;
  maxWords: number;
}

export interface BlockSlotRoleValue {
  block: string;
  /** Authored pointer of the invocation. */
  invocation: string;
  slot: string;
  role: BlockSlotRole;
  /** Authored pointer of the slot value, whether or not one was supplied. */
  path: string;
  /** The resolved value after defaults; undefined when absent. */
  value: unknown;
}

/** Visit every declared slot of an invocation with its resolved value. */
function visitInvocationSlots(
  document: unknown,
  blocks: readonly string[],
  visit: (
    ref: string,
    slot: BlockSlot,
    value: unknown,
    pointer: string,
    name: string
  ) => void
): void {
  const definitions = readBlockDefinitions(document);
  for (const path of blocks) {
    const node = blockValueAt(document, path);
    if (
      !isBlockRecord(node) ||
      !isBlockRecord(node.props) ||
      typeof node.props.ref !== 'string'
    )
      continue;
    const ref = node.props.ref;
    const definition = definitions[ref];
    if (!definition) continue;
    const walk = (
      slot: BlockSlot,
      value: unknown,
      pointer: string,
      name: string
    ): void => {
      visit(ref, slot, value, pointer, name);
      if (isBlockRecord(value) && slot.properties) {
        for (const [key, property] of Object.entries(slot.properties)) {
          walk(
            property,
            blockValueAt(value, `/${blockPointerKey(key)}`),
            `${pointer}/${blockPointerKey(key)}`,
            `${name}.${key}`
          );
        }
      }
      if (Array.isArray(value) && slot.items)
        value.forEach((item, i) =>
          walk(slot.items!, item, `${pointer}/${i}`, name)
        );
    };
    for (const [name, slot] of Object.entries(definition.slots)) {
      const authored = blockValueAt(
        node.props.slots,
        `/${blockPointerKey(name)}`
      );
      walk(
        slot,
        authored === undefined && slot.default !== undefined
          ? slot.default
          : authored,
        `${path}/props/slots/${blockPointerKey(name)}`,
        name
      );
    }
  }
}

/** Metadata is always read from authored definitions, never from a named catalog. */
export function blockSlotBudgets(
  document: unknown,
  blocks: readonly string[]
): BlockSlotBudget[] {
  const result: BlockSlotBudget[] = [];
  visitInvocationSlots(document, blocks, (ref, slot, value, pointer, name) => {
    if (typeof value === 'string' && slot.maxWords !== undefined)
      result.push({
        block: ref,
        slot: name,
        path: pointer,
        words: blockWordCount(value),
        maxWords: slot.maxWords,
      });
  });
  return result;
}

/**
 * Every role-bearing slot of every invocation, present or not, so a profile
 * can require one (a source under a chart) and measure another (an action
 * title's length) at the authored pointer the author can patch.
 */
export function blockSlotRoles(
  document: unknown,
  blocks: readonly string[]
): BlockSlotRoleValue[] {
  const result: BlockSlotRoleValue[] = [];
  visitInvocationSlots(document, blocks, (ref, slot, value, pointer, name) => {
    if (!slot.role) return;
    result.push({
      block: ref,
      invocation: pointer.replace(/\/props\/slots\/.*$/, ''),
      slot: name,
      role: slot.role,
      path: pointer,
      value,
    });
  });
  return result;
}

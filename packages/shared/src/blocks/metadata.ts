import { Value } from '@sinclair/typebox/value';
import {
  BlockDefinitionsSchema,
  blockSlotJsonSchema,
  type JsonBlockDefinition,
} from './schema';
import {
  blockPointerKey,
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

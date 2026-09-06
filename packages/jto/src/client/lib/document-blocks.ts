/**
 * The block definitions of the document being edited, read from the editor
 * text as it is — often mid-edit and temporarily invalid — so the schema
 * Monaco validates against can name them.
 *
 * Built on jsonc-parser, like document-outline.ts: `parseTree` tolerates a
 * missing comma three lines down from the definition being read. Only
 * definitions that satisfy the block schema count; a half-typed one is left
 * out until it is whole, rather than turning the whole document's completion
 * off.
 */
import { findNodeAtLocation, getNodeValue, parseTree } from 'jsonc-parser';
import { Value } from '@sinclair/typebox/value';
import {
  JsonBlockDefinitionSchema,
  type JsonBlockDefinition,
} from '@json-to-office/shared';

export type DocumentBlockDefinitions = Record<string, JsonBlockDefinition>;

export function readDocumentBlockDefinitions(
  text: string
): DocumentBlockDefinitions {
  if (!text.trim()) return {};
  let root;
  try {
    root = parseTree(text, [], { allowTrailingComma: true });
  } catch {
    return {};
  }
  if (!root) return {};
  const blocks = findNodeAtLocation(root, ['props', 'blocks']);
  if (!blocks || blocks.type !== 'object') return {};
  const definitions: DocumentBlockDefinitions = {};
  for (const property of blocks.children ?? []) {
    if (property.type !== 'property' || !property.children) continue;
    const [key, valueNode] = property.children;
    const name = key?.value;
    if (typeof name !== 'string' || !valueNode) continue;
    let value: unknown;
    try {
      value = getNodeValue(valueNode);
    } catch {
      continue;
    }
    if (Value.Check(JsonBlockDefinitionSchema, value))
      definitions[name] = value as JsonBlockDefinition;
  }
  return definitions;
}

/** Changes exactly when the schema built from these definitions would. */
export function blockDefinitionsSignature(
  definitions: DocumentBlockDefinitions
): string {
  return JSON.stringify(definitions);
}

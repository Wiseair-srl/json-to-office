/**
 * Block snippets for the JSON editor: what the language service cannot offer
 * from a schema alone.
 *
 * The schema (see monaco-config) completes the names a document already
 * defines and their slots. Two more things belong in the completion list:
 * a reference block the document does *not* define yet — offered at `ref`,
 * and inserting it brings its definition (and the definitions it depends
 * on) into `props.blocks` in the same edit, so no reference is ever left
 * unresolved — and, wherever a slide or section takes content, a whole
 * invocation of any block at typical slot cardinality, with tab stops on its
 * text slots.
 *
 * Everything here is text in, edits out (offsets, not positions), so it runs
 * and is tested without Monaco; monaco-config maps the result onto ranges.
 */
import {
  findNodeAtLocation,
  findNodeAtOffset,
  getLocation,
  parse,
  parseTree,
  type Node,
} from 'jsonc-parser';
import {
  blockInvocationExample,
  type BlockInvocationExample,
  type BlockReference,
  type JsonBlockDefinition,
} from '@json-to-office/shared';
import type { DocumentBlockDefinitions } from './document-blocks';

export interface TextEdit {
  offset: number;
  length: number;
  content: string;
}

export interface BlockSnippet {
  /** `ref` replaces the reference string; `component` inserts an invocation. */
  kind: 'ref' | 'component';
  label: string;
  detail: string;
  documentation: string;
  /** Monaco snippet syntax (`${1:text}`) for `component`, plain JSON for `ref`. */
  insertText: string;
  /** What the insert replaces; zero-length when inserting at the cursor. */
  replace: { offset: number; length: number };
  /** Definitions to add elsewhere in the document, applied with the insert. */
  additionalEdits: TextEdit[];
}

export interface BlockSnippetOptions {
  references: readonly BlockReference[];
  /** The definitions the document already carries (see document-blocks). */
  definitions: DocumentBlockDefinitions;
  format: 'docx' | 'pptx';
}

/** Containers whose `children` take a block invocation directly. */
const CONTENT_OWNERS: Record<'docx' | 'pptx', readonly string[]> = {
  pptx: ['slide', 'group'],
  docx: ['docx', 'section', 'group'],
};

export interface BlockCompletionContext {
  kind: 'ref' | 'component';
  replace: { offset: number; length: number };
}

function objectNameAt(
  root: Node,
  path: (string | number)[]
): string | undefined {
  const node = findNodeAtLocation(root, [...path, 'name']);
  return node?.type === 'string' ? (node.value as string) : undefined;
}

function isSingleLine(text: string, node: Node): boolean {
  return !text.slice(node.offset, node.offset + node.length).includes('\n');
}

function parseTolerant(text: string): Node | undefined {
  try {
    return parseTree(text, [], { allowTrailingComma: true });
  } catch {
    return undefined;
  }
}

/** Where the cursor is, in block terms; null anywhere snippets do not apply. */
export function blockCompletionContext(
  text: string,
  offset: number,
  format: 'docx' | 'pptx'
): BlockCompletionContext | null {
  const root = parseTolerant(text);
  if (!root) return null;
  const location = getLocation(text, offset);
  const path = location.path;
  const node = findNodeAtOffset(root, offset, true);

  // `"ref": "|"` on a block invocation: the reference string being typed.
  if (
    !location.isAtPropertyKey &&
    path.length >= 2 &&
    path[path.length - 1] === 'ref' &&
    path[path.length - 2] === 'props' &&
    objectNameAt(root, path.slice(0, -2)) === 'block' &&
    node?.type === 'string'
  )
    return {
      kind: 'ref',
      replace: { offset: node.offset, length: node.length },
    };

  // An element of a content container's `children`: either a fresh object —
  // `{|}`, `{"|"}`, `{"name": "|"}` — still on one line, or the empty slot of
  // an array. Multi-line objects are being edited, not started; leave them.
  let elementDepth = -1;
  for (let index = path.length - 1; index >= 1; index--)
    if (typeof path[index] === 'number' && path[index - 1] === 'children') {
      elementDepth = index;
      break;
    }
  if (elementDepth < 0) return null;
  const owner = objectNameAt(root, path.slice(0, elementDepth - 1));
  if (!owner || !CONTENT_OWNERS[format].includes(owner)) return null;
  const element = findNodeAtLocation(root, path.slice(0, elementDepth + 1));
  if (!element) {
    // `"children": [|]` — nothing there yet.
    const array = findNodeAtLocation(root, path.slice(0, elementDepth));
    if (array?.type !== 'array' || (array.children?.length ?? 0) > 0)
      return null;
    return { kind: 'component', replace: { offset, length: 0 } };
  }
  if (element.type !== 'object' || !isSingleLine(text, element)) return null;
  const properties = element.children ?? [];
  const onlyName =
    properties.length === 0 ||
    (properties.length === 1 &&
      ['', 'name'].includes(String(properties[0].children?.[0]?.value ?? '')));
  if (!onlyName || path.length > elementDepth + 2) return null;
  return {
    kind: 'component',
    replace: { offset: element.offset, length: element.length },
  };
}

/** Text a Monaco snippet takes literally. */
function escapeSnippet(value: string): string {
  return value.replace(/[\\$}]/g, (match) => `\\${match}`);
}

/**
 * The invocation as snippet text: JSON in the document's indentation unit,
 * each string slot a tab stop. Lines are relative — Monaco prepends the
 * insertion line's own indentation to every line of a snippet — and deep
 * values (a chart's data) stay literal.
 */
export function invocationSnippet(
  example: BlockInvocationExample,
  unit = '  '
): string {
  const stops: string[] = [];
  const marker = (index: number) => `\u0007${index}\u0007`;
  const slots = Object.fromEntries(
    Object.entries(example.props.slots ?? {}).map(([key, value]) => [
      key,
      typeof value === 'string' ? marker(stops.push(value)) : value,
    ])
  );
  const json = JSON.stringify(
    { name: 'block', props: { ref: example.props.ref, slots } },
    null,
    unit
  );
  return json.replace(/"\\u0007(\d+)\\u0007"/g, (_match, index) => {
    const value = JSON.stringify(stops[Number(index) - 1]).slice(1, -1);
    return `"\${${index}:${escapeSnippet(value)}}"`;
  });
}

/** The indentation unit the document uses; two spaces when it says nothing. */
function indentUnit(text: string): string {
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
}

function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, offset))?.[0] ?? '';
}

function indentLines(json: string, indent: string): string {
  return json
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n');
}

/**
 * Add definitions to `props.blocks`, creating `props` and `blocks` when the
 * document has neither. Names already defined are left as they are — the
 * author's definition wins over a reference copy.
 */
export function insertBlockDefinitions(
  text: string,
  definitions: Record<string, JsonBlockDefinition>
): TextEdit[] {
  const root = parseTolerant(text);
  if (!root || root.type !== 'object') return [];
  const unit = indentUnit(text);
  const blocks = findNodeAtLocation(root, ['props', 'blocks']);
  const props = findNodeAtLocation(root, ['props']);
  const existing = new Set(
    blocks?.type === 'object'
      ? (blocks.children ?? []).map((property) =>
          String(property.children?.[0]?.value ?? '')
        )
      : []
  );
  const entries = Object.entries(definitions).filter(
    ([name]) => !existing.has(name)
  );
  if (!entries.length) return [];

  // The object the new property goes into, and how deep the definitions sit
  // below its indentation once the missing wrappers are written.
  const target =
    blocks?.type === 'object'
      ? blocks
      : props?.type === 'object'
        ? props
        : root;
  const depth = target === blocks ? 1 : target === props ? 2 : 3;
  const base = lineIndent(text, target.offset);
  const at = (level: number) => base + unit.repeat(level);
  const list = entries
    .map(
      ([name, definition]) =>
        `${at(depth)}${JSON.stringify(name)}: ${indentLines(
          JSON.stringify(definition, null, unit),
          at(depth)
        )}`
    )
    .join(',\n');
  const body =
    target === blocks
      ? list
      : target === props
        ? `${at(1)}"blocks": {\n${list}\n${at(1)}}`
        : `${at(1)}"props": {\n${at(2)}"blocks": {\n${list}\n${at(2)}}\n${at(1)}}`;
  const hasProperties = (target.children?.length ?? 0) > 0;
  const content = hasProperties ? `\n${body},` : `\n${body}\n${base}`;
  return [{ offset: target.offset + 1, length: 0, content }];
}

/** Apply offset edits (non-overlapping) to text. */
export function applyTextEdits(
  text: string,
  edits: readonly TextEdit[]
): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.offset - a.offset))
    result =
      result.slice(0, edit.offset) +
      edit.content +
      result.slice(edit.offset + edit.length);
  return result;
}

/** Definitions a reference needs in this document, dependencies first. */
function definitionsToInsert(
  reference: BlockReference,
  references: readonly BlockReference[],
  present: DocumentBlockDefinitions
): Record<string, JsonBlockDefinition> {
  const out: Record<string, JsonBlockDefinition> = {};
  for (const name of [...reference.dependencies, reference.name]) {
    if (name in present) continue;
    const entry = references.find(
      (candidate) =>
        candidate.template === reference.template && candidate.name === name
    );
    if (entry) out[name] = entry.definition;
  }
  return out;
}

/** The snippets to offer at this cursor, if any. */
export function blockSnippets(
  text: string,
  offset: number,
  options: BlockSnippetOptions
): BlockSnippet[] {
  const context = blockCompletionContext(text, offset, options.format);
  if (!context) return [];
  const references = options.references.filter(
    (reference) =>
      reference.format === options.format &&
      !(reference.name in options.definitions)
  );
  if (context.kind === 'ref')
    return references.map((reference) => ({
      kind: 'ref' as const,
      label: reference.name,
      detail: `block from ${reference.template}`,
      documentation: reference.description,
      insertText: JSON.stringify(reference.name),
      replace: context.replace,
      additionalEdits: insertBlockDefinitions(
        text,
        definitionsToInsert(reference, options.references, options.definitions)
      ),
    }));
  const unit = indentUnit(text);
  let document: unknown;
  try {
    document = parse(text, [], { allowTrailingComma: true });
  } catch {
    document = undefined;
  }
  const local = Object.entries(options.definitions).map(
    ([name, definition]) => ({
      kind: 'component' as const,
      label: name,
      detail: 'block defined in this document',
      documentation: definition.description ?? '',
      insertText: invocationSnippet(
        blockInvocationExample(name, definition, {
          document,
          format: options.format,
        }),
        unit
      ),
      replace: context.replace,
      additionalEdits: [],
    })
  );
  const remote = references.map((reference) => ({
    kind: 'component' as const,
    label: reference.name,
    detail: `block from ${reference.template}`,
    documentation: reference.description,
    insertText: invocationSnippet(reference.example, unit),
    replace: context.replace,
    additionalEdits: insertBlockDefinitions(
      text,
      definitionsToInsert(reference, options.references, options.definitions)
    ),
  }));
  return [...local, ...remote];
}

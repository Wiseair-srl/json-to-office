/**
 * RFC 6902 JSON Patch.
 *
 * Two properties the workspace store depends on and no library gave us for
 * free: every failure is a *value* naming the operation index and the pointer
 * that broke (not a thrown, string-formatted `Error`), and the whole patch is
 * checked for syntax before any of it is applied. The apply itself is still
 * all-or-nothing at the caller's level — see the ownership note on
 * `applyPatch`.
 *
 * Hand-writing it also kept `package.json` — a file this issue does not own —
 * untouched, and the spec is short enough that the suite next door covers it
 * operation by operation, including the array-index and `-` append rules.
 */

import type { JsonPatchOperation } from '../lib/workspace-store.js';
import {
  POINTER_ERROR_CODE,
  arrayIndex,
  cloneJson,
  formatPointer,
  hasOwn,
  isRecord,
  jsonEqual,
  parsePointer,
  resolvePointer,
  setMember,
} from './json-pointer.js';

/**
 * Patch-specific codes.
 *
 * Kept beside the implementation rather than in `lib/errors.ts`, which #203
 * owns and other agents are editing; they read as ordinary diagnostic codes to
 * a client either way. `TEST_FAILED` is deliberately distinct from `FAILED`:
 * agents use `test` as a precondition guard, and "your assumption was wrong"
 * is a different repair from "that location does not exist".
 */
export const PATCH_ERROR_CODES = {
  SYNTAX: 'E_PATCH_SYNTAX',
  INVALID_POINTER: POINTER_ERROR_CODE,
  FAILED: 'E_PATCH_FAILED',
  TEST_FAILED: 'E_PATCH_TEST_FAILED',
} as const;

export const PATCH_OPS = [
  'add',
  'remove',
  'replace',
  'move',
  'copy',
  'test',
] as const;

export type PatchOp = (typeof PATCH_OPS)[number];

export interface PatchProblem {
  code: string;
  message: string;
  /** Index into the operations array, so the agent can fix the right one. */
  operationIndex: number;
  /** The pointer the operation targeted, when it parsed. */
  pointer?: string;
  suggestion?: string;
  context?: Record<string, unknown>;
}

export type PatchResult =
  | { ok: true; document: unknown }
  | { ok: false; problem: PatchProblem };

interface CompiledOperation {
  op: PatchOp;
  path: string;
  tokens: string[];
  from?: string;
  fromTokens?: string[];
  value?: unknown;
}

type OpResult =
  | { ok: true; root: unknown }
  | { ok: false; problem: PatchProblem };

const VALUE_OPS = new Set<PatchOp>(['add', 'replace', 'test']);
const FROM_OPS = new Set<PatchOp>(['move', 'copy']);

function problem(
  code: string,
  message: string,
  operationIndex: number,
  extra: Omit<PatchProblem, 'code' | 'message' | 'operationIndex'> = {}
): { ok: false; problem: PatchProblem } {
  return { ok: false, problem: { code, message, operationIndex, ...extra } };
}

/** Short, safe rendering of a value for a diagnostic — never the whole subtree. */
function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    return '<unserializable>';
  }
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** Shared with the store, which names the same types in its own messages. */
export function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Check every operation's shape and pointers before any of them runs.
 *
 * This is the "validate the patch first" half of atomicity: a typo in the last
 * operation of a batch must not leave the first four applied, and the agent
 * gets told about all of the patch's structure being wrong at the point where
 * nothing has happened yet.
 */
export function compilePatch(
  operations: readonly JsonPatchOperation[]
):
  | { ok: true; compiled: CompiledOperation[] }
  | { ok: false; problem: PatchProblem } {
  const compiled: CompiledOperation[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const raw = operations[index] as unknown;
    if (!isRecord(raw)) {
      return problem(
        PATCH_ERROR_CODES.SYNTAX,
        `Operation ${index} is a ${typeName(raw)}; each operation must be an object.`,
        index
      );
    }

    const op = raw.op as PatchOp;
    if (
      typeof op !== 'string' ||
      !(PATCH_OPS as readonly string[]).includes(op)
    ) {
      return problem(
        PATCH_ERROR_CODES.SYNTAX,
        `Operation ${index} has op ${preview(raw.op)}, which is not an RFC 6902 operation.`,
        index,
        { suggestion: `Use one of: ${PATCH_OPS.join(', ')}.` }
      );
    }

    if (typeof raw.path !== 'string') {
      return problem(
        PATCH_ERROR_CODES.SYNTAX,
        `Operation ${index} (${op}) has no string \`path\`.`,
        index,
        {
          suggestion:
            'Every operation needs an RFC 6901 JSON Pointer in `path`.',
        }
      );
    }
    const path = parsePointer(raw.path);
    if (!path.ok) {
      return problem(PATCH_ERROR_CODES.INVALID_POINTER, path.message, index, {
        context: { op, pointer: raw.path },
        suggestion:
          'Pointers are RFC 6901: "/children/0/props/text", with "~0" for "~" and "~1" for "/".',
      });
    }

    const entry: CompiledOperation = {
      op,
      path: raw.path,
      tokens: path.tokens,
    };

    if (VALUE_OPS.has(op)) {
      if (raw.value === undefined) {
        return problem(
          PATCH_ERROR_CODES.SYNTAX,
          `Operation ${index} (${op} ${raw.path}) has no \`value\`.`,
          index,
          {
            pointer: raw.path,
            suggestion: `\`${op}\` carries the JSON to write in \`value\`; use null for a JSON null.`,
          }
        );
      }
      entry.value = raw.value;
    }

    if (FROM_OPS.has(op)) {
      if (typeof raw.from !== 'string') {
        return problem(
          PATCH_ERROR_CODES.SYNTAX,
          `Operation ${index} (${op} ${raw.path}) has no string \`from\`.`,
          index,
          {
            pointer: raw.path,
            suggestion: `\`${op}\` needs the source pointer in \`from\`.`,
          }
        );
      }
      const from = parsePointer(raw.from);
      if (!from.ok) {
        return problem(PATCH_ERROR_CODES.INVALID_POINTER, from.message, index, {
          context: { op, pointer: raw.from, member: 'from' },
        });
      }
      entry.from = raw.from;
      entry.fromTokens = from.tokens;
    }

    compiled.push(entry);
  }

  return { ok: true, compiled };
}

/**
 * Apply a patch.
 *
 * **Takes ownership of `document`**: operations mutate it in place, so callers
 * pass a private copy and keep their own. The workspace store hands over a
 * fresh `JSON.parse` of the committed text and only re-serializes on success,
 * which is what makes a failed patch leave the stored document byte-identical.
 */
export function applyPatch(
  document: unknown,
  operations: readonly JsonPatchOperation[]
): PatchResult {
  const compiled = compilePatch(operations);
  if (!compiled.ok) return compiled;

  let root = document;
  for (let index = 0; index < compiled.compiled.length; index += 1) {
    const result = applyOne(root, compiled.compiled[index], index);
    if (!result.ok) return result;
    root = result.root;
  }
  return { ok: true, document: root };
}

function applyOne(
  root: unknown,
  operation: CompiledOperation,
  index: number
): OpResult {
  switch (operation.op) {
    case 'add':
      return add(
        root,
        operation.tokens,
        cloneJson(operation.value),
        operation,
        index
      );
    case 'remove': {
      const removed = remove(root, operation.tokens, operation, index);
      return removed.ok ? { ok: true, root: removed.root } : removed;
    }
    case 'replace':
      return replace(
        root,
        operation.tokens,
        cloneJson(operation.value),
        operation,
        index
      );
    case 'move':
      return move(root, operation, index);
    case 'copy':
      return copy(root, operation, index);
    case 'test':
      return test(root, operation, index);
  }
}

/** Resolve the container a leaf operation writes into. */
function parentOf(
  root: unknown,
  tokens: readonly string[],
  operation: CompiledOperation,
  index: number
): { ok: true; parent: unknown } | { ok: false; problem: PatchProblem } {
  const parentTokens = tokens.slice(0, -1);
  const found = resolvePointer(root, parentTokens);
  if (!found.found) {
    return problem(
      PATCH_ERROR_CODES.FAILED,
      `${operation.op} ${operation.path}: the parent location ${
        formatPointer(parentTokens) || '(document root)'
      } does not exist (stopped at ${found.at}).`,
      index,
      {
        pointer: found.at,
        suggestion:
          'Add the missing container first — RFC 6902 never creates intermediate objects or arrays.',
        context: { op: operation.op, pointer: operation.path },
      }
    );
  }
  return { ok: true, parent: found.value };
}

function badContainer(
  parent: unknown,
  operation: CompiledOperation,
  index: number
): { ok: false; problem: PatchProblem } {
  return problem(
    PATCH_ERROR_CODES.FAILED,
    `${operation.op} ${operation.path}: the parent location holds a ${typeName(
      parent
    )}, which has no members to address.`,
    index,
    { pointer: operation.path, context: { op: operation.op } }
  );
}

function badIndex(
  reason: 'malformed' | 'out_of_range',
  token: string,
  length: number,
  operation: CompiledOperation,
  index: number,
  allowAppend: boolean
): { ok: false; problem: PatchProblem } {
  if (reason === 'malformed') {
    return problem(
      PATCH_ERROR_CODES.INVALID_POINTER,
      `${operation.op} ${operation.path}: ${JSON.stringify(
        token
      )} is not an array index (no leading zeros, no negatives).`,
      index,
      {
        pointer: operation.path,
        suggestion: allowAppend
          ? 'Use a decimal index, or "-" to append.'
          : 'Use a decimal index of an existing element.',
        context: { op: operation.op, token, length },
      }
    );
  }
  if (token === '-') {
    return problem(
      PATCH_ERROR_CODES.FAILED,
      `${operation.op} ${operation.path}: "-" names the position after the last element and is only valid for add.`,
      index,
      { pointer: operation.path, context: { op: operation.op, length } }
    );
  }
  return problem(
    PATCH_ERROR_CODES.FAILED,
    `${operation.op} ${operation.path}: index ${token} is past the end of a ${length}-element array.`,
    index,
    {
      pointer: operation.path,
      suggestion: allowAppend
        ? `Valid indices are 0-${length} (or "-" to append).`
        : `Valid indices are 0-${Math.max(length - 1, 0)}.`,
      context: { op: operation.op, token, length },
    }
  );
}

function add(
  root: unknown,
  tokens: readonly string[],
  value: unknown,
  operation: CompiledOperation,
  index: number
): OpResult {
  if (tokens.length === 0) return { ok: true, root: value };

  const parent = parentOf(root, tokens, operation, index);
  if (!parent.ok) return parent;

  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent.parent)) {
    const at = arrayIndex(key, parent.parent.length, true);
    if (!at.ok) {
      return badIndex(
        at.reason,
        key,
        parent.parent.length,
        operation,
        index,
        true
      );
    }
    parent.parent.splice(at.index, 0, value);
    return { ok: true, root };
  }
  if (isRecord(parent.parent)) {
    setMember(parent.parent, key, value);
    return { ok: true, root };
  }
  return badContainer(parent.parent, operation, index);
}

function remove(
  root: unknown,
  tokens: readonly string[],
  operation: CompiledOperation,
  index: number
):
  | { ok: true; root: unknown; removed: unknown }
  | { ok: false; problem: PatchProblem } {
  if (tokens.length === 0) {
    return problem(
      PATCH_ERROR_CODES.FAILED,
      `${operation.op} "": the document root cannot be removed.`,
      index,
      {
        suggestion:
          'Use replace with path "" to swap the whole document, or remove a member of it.',
        context: { op: operation.op },
      }
    );
  }

  const parent = parentOf(root, tokens, operation, index);
  if (!parent.ok) return parent;

  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent.parent)) {
    const at = arrayIndex(key, parent.parent.length, false);
    if (!at.ok) {
      return badIndex(
        at.reason,
        key,
        parent.parent.length,
        operation,
        index,
        false
      );
    }
    const [removed] = parent.parent.splice(at.index, 1);
    return { ok: true, root, removed };
  }
  if (isRecord(parent.parent)) {
    if (!hasOwn(parent.parent, key)) {
      return problem(
        PATCH_ERROR_CODES.FAILED,
        `${operation.op} ${operation.path}: no such member.`,
        index,
        {
          pointer: operation.path,
          context: {
            op: operation.op,
            available: Object.keys(parent.parent).slice(0, 20),
          },
        }
      );
    }
    const removed = parent.parent[key];
    delete parent.parent[key];
    return { ok: true, root, removed };
  }
  return badContainer(parent.parent, operation, index);
}

function replace(
  root: unknown,
  tokens: readonly string[],
  value: unknown,
  operation: CompiledOperation,
  index: number
): OpResult {
  if (tokens.length === 0) return { ok: true, root: value };

  const parent = parentOf(root, tokens, operation, index);
  if (!parent.ok) return parent;

  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent.parent)) {
    const at = arrayIndex(key, parent.parent.length, false);
    if (!at.ok) {
      return badIndex(
        at.reason,
        key,
        parent.parent.length,
        operation,
        index,
        false
      );
    }
    parent.parent[at.index] = value;
    return { ok: true, root };
  }
  if (isRecord(parent.parent)) {
    // RFC 6902 §4.3: replace requires the member to exist. Creating it here
    // would hide a typo'd pointer as a silently-added member.
    if (!hasOwn(parent.parent, key)) {
      return problem(
        PATCH_ERROR_CODES.FAILED,
        `replace ${operation.path}: no such member to replace.`,
        index,
        {
          pointer: operation.path,
          suggestion: 'Use add to create a member that does not exist yet.',
          context: {
            op: operation.op,
            available: Object.keys(parent.parent).slice(0, 20),
          },
        }
      );
    }
    setMember(parent.parent, key, value);
    return { ok: true, root };
  }
  return badContainer(parent.parent, operation, index);
}

function move(
  root: unknown,
  operation: CompiledOperation,
  index: number
): OpResult {
  const fromTokens = operation.fromTokens as string[];
  if (
    isPrefix(fromTokens, operation.tokens) &&
    fromTokens.length < operation.tokens.length
  ) {
    return problem(
      PATCH_ERROR_CODES.FAILED,
      `move ${operation.from} -> ${operation.path}: a location cannot be moved into its own child.`,
      index,
      { pointer: operation.path, context: { op: 'move', from: operation.from } }
    );
  }
  if (jsonEqualTokens(fromTokens, operation.tokens)) return { ok: true, root };

  const source = resolvePointer(root, fromTokens);
  if (!source.found) {
    return problem(
      PATCH_ERROR_CODES.FAILED,
      `move ${operation.from}: the source location does not exist (stopped at ${source.at}).`,
      index,
      { pointer: source.at, context: { op: 'move', from: operation.from } }
    );
  }

  const removed = remove(
    root,
    fromTokens,
    { ...operation, path: operation.from as string },
    index
  );
  if (!removed.ok) return removed;
  // The removed subtree is already detached and ours, so it goes back in
  // as-is; cloning here would double the cost of moving a large subtree.
  return add(removed.root, operation.tokens, removed.removed, operation, index);
}

function copy(
  root: unknown,
  operation: CompiledOperation,
  index: number
): OpResult {
  const fromTokens = operation.fromTokens as string[];
  const source = resolvePointer(root, fromTokens);
  if (!source.found) {
    return problem(
      PATCH_ERROR_CODES.FAILED,
      `copy ${operation.from}: the source location does not exist (stopped at ${source.at}).`,
      index,
      { pointer: source.at, context: { op: 'copy', from: operation.from } }
    );
  }
  return add(root, operation.tokens, cloneJson(source.value), operation, index);
}

function test(
  root: unknown,
  operation: CompiledOperation,
  index: number
): OpResult {
  const found = resolvePointer(root, operation.tokens);
  if (!found.found) {
    return problem(
      PATCH_ERROR_CODES.TEST_FAILED,
      `test ${operation.path}: the location does not exist (stopped at ${found.at}).`,
      index,
      {
        pointer: found.at,
        context: {
          op: 'test',
          reason: 'missing',
          expected: preview(operation.value),
        },
      }
    );
  }
  if (!jsonEqual(found.value, operation.value)) {
    return problem(
      PATCH_ERROR_CODES.TEST_FAILED,
      `test ${operation.path}: expected ${preview(operation.value)} but found ${preview(
        found.value
      )}.`,
      index,
      {
        pointer: operation.path,
        suggestion:
          'Re-read the location (jto_workspace_inspect) before patching: the document moved under you.',
        context: {
          op: 'test',
          reason: 'mismatch',
          expected: preview(operation.value),
          actual: preview(found.value),
        },
      }
    );
  }
  return { ok: true, root };
}

function isPrefix(
  prefix: readonly string[],
  tokens: readonly string[]
): boolean {
  if (prefix.length > tokens.length) return false;
  return prefix.every((token, index) => token === tokens[index]);
}

function jsonEqualTokens(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length && isPrefix(left, right);
}

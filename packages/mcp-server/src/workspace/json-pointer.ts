/**
 * RFC 6901 JSON Pointers.
 *
 * Written out rather than depended on: a tool has to tell an agent *which*
 * pointer failed and *why* in a structured diagnostic it can act on, and the
 * libraries on offer signal that by throwing a formatted `Error` — the parse
 * failure and the "no such location" failure arrive as the same string. The
 * spec is one page, and the suite next door covers all of it.
 */

const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

/** Code for a pointer that is not RFC 6901. Shared by patching and inspection. */
export const POINTER_ERROR_CODE = 'E_INVALID_POINTER';

export type PointerParseResult =
  | { ok: true; tokens: string[] }
  | { ok: false; message: string };

/** Split a pointer into unescaped reference tokens. `''` is the whole document. */
export function parsePointer(pointer: string): PointerParseResult {
  if (typeof pointer !== 'string') {
    return { ok: false, message: 'A JSON Pointer must be a string.' };
  }
  if (pointer === '') return { ok: true, tokens: [] };
  if (!pointer.startsWith('/')) {
    return {
      ok: false,
      message: `JSON Pointer ${JSON.stringify(
        pointer
      )} must be empty (the whole document) or start with "/".`,
    };
  }

  const tokens: string[] = [];
  for (const raw of pointer.slice(1).split('/')) {
    const token = unescapeToken(raw);
    if (token === undefined) {
      return {
        ok: false,
        message: `JSON Pointer ${JSON.stringify(
          pointer
        )} contains a "~" that is not part of "~0" or "~1".`,
      };
    }
    tokens.push(token);
  }
  return { ok: true, tokens };
}

/** `~1` → `/` then `~0` → `~`, in that order (RFC 6901 §4). */
function unescapeToken(token: string): string | undefined {
  if (!token.includes('~')) return token;
  let out = '';
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char !== '~') {
      out += char;
      continue;
    }
    const next = token[index + 1];
    if (next === '0') out += '~';
    else if (next === '1') out += '/';
    else return undefined;
    index += 1;
  }
  return out;
}

export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Rebuild a pointer from tokens — used to name the exact place a walk stopped. */
export function formatPointer(tokens: readonly string[]): string {
  return tokens.map((token) => `/${escapeToken(token)}`).join('');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Write a member without letting `__proto__` reach the prototype.
 *
 * `obj.__proto__ = value` mutates the prototype chain instead of adding a
 * member, which is both wrong (the pointer named a member) and a way to poison
 * every object in the process. `defineProperty` stores it as the own, plainly
 * enumerable property JSON semantics call for.
 */
export function setMember(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}

export type ArrayIndexResult =
  | { ok: true; index: number }
  | { ok: false; reason: 'malformed' | 'out_of_range' };

/**
 * Read an array index token.
 *
 * `allowAppend` is the `add` case, where `-` and `length` both mean "past the
 * last element". Leading zeros are malformed per RFC 6901 §4, which matters:
 * `/items/01` silently meaning `/items/1` would let an agent believe a patch
 * landed where it did not.
 */
export function arrayIndex(
  token: string,
  length: number,
  allowAppend: boolean
): ArrayIndexResult {
  if (token === '-') {
    return allowAppend
      ? { ok: true, index: length }
      : { ok: false, reason: 'out_of_range' };
  }
  if (!ARRAY_INDEX.test(token)) return { ok: false, reason: 'malformed' };
  const index = Number(token);
  const limit = allowAppend ? length : length - 1;
  if (index > limit) return { ok: false, reason: 'out_of_range' };
  return { ok: true, index };
}

export type PointerLookup =
  | { found: true; value: unknown }
  /** `at` is the deepest pointer prefix that could not be resolved. */
  | { found: false; at: string };

/** Walk `tokens` from `document`, reporting where the walk stopped. */
export function resolvePointer(
  document: unknown,
  tokens: readonly string[]
): PointerLookup {
  let current: unknown = document;
  for (let depth = 0; depth < tokens.length; depth += 1) {
    const token = tokens[depth];
    if (Array.isArray(current)) {
      const index = arrayIndex(token, current.length, false);
      if (!index.ok)
        return { found: false, at: formatPointer(tokens.slice(0, depth + 1)) };
      current = current[index.index];
    } else if (isRecord(current)) {
      if (!hasOwn(current, token)) {
        return { found: false, at: formatPointer(tokens.slice(0, depth + 1)) };
      }
      current = current[token];
    } else {
      return { found: false, at: formatPointer(tokens.slice(0, depth + 1)) };
    }
  }
  return { found: true, value: current };
}

/** Deep copy of a JSON value. Inserted values are never aliased into the tree. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item)) as unknown as T;
  }
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value))
      setMember(copy, key, cloneJson(value[key]));
    return copy as unknown as T;
  }
  return value;
}

/** RFC 6902 §4.6 equality: same JSON value, member order irrelevant. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) => hasOwn(right, key) && jsonEqual(left[key], right[key])
    );
  }
  return false;
}

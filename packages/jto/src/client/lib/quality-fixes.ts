/**
 * RFC 6902 JSON Patch, applied to the parsed playground document.
 *
 * Quality findings can carry the operations that repair the defect they
 * report, which is what the "Apply fix" affordance runs. Two properties make
 * that safe to hand a user: the patch is all-or-nothing (a half-applied repair
 * is worse than none), and the caller's object graph is never mutated, so the
 * editor can diff or discard the result.
 */
import { pathArrayToPointer, pointerToPathArray } from './json-pointer';
import type { QualityFixOp } from './quality-findings';

export type ApplyFixesResult =
  | { ok: true; doc: unknown; applied: number }
  | { ok: false; error: string };

const SUPPORTED_OPS = [
  'add',
  'remove',
  'replace',
  'move',
  'copy',
  'test',
] as const;

type SupportedOp = (typeof SUPPORTED_OPS)[number];

type Segment = string | number;

/**
 * Fallible result threaded through every helper below. Failures are values
 * because the public contract forbids throwing, and an exception escaping mid
 * patch would also make "all-or-nothing" a claim we could not keep.
 */
type Step<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Apply RFC 6902 operations in order. All-or-nothing: if any operation fails
 * the original document is left untouched and an error is returned.
 */
export function applyQualityFixes(
  doc: unknown,
  fixes: readonly QualityFixOp[]
): ApplyFixesResult {
  try {
    let next = doc;
    for (let index = 0; index < fixes.length; index++) {
      const outcome = applyOne(next, fixes[index], index);
      if (!outcome.ok) return { ok: false, error: outcome.error };
      next = outcome.value;
    }
    return { ok: true, doc: next, applied: fixes.length };
  } catch (error) {
    // Fixes arrive over the network and the document is whatever the user
    // typed, so an unforeseen shape must degrade to a failed patch rather
    // than take the editor down.
    return { ok: false, error: `quality fix failed: ${describeError(error)}` };
  }
}

/**
 * True when every op in the list is one this module can apply. A missing or
 * empty list is false: there is nothing to apply, so the caller must not
 * surface a fix affordance for it.
 */
export function canApplyFixes(
  fixes: readonly QualityFixOp[] | undefined
): boolean {
  if (!fixes || fixes.length === 0) return false;
  return fixes.every((fix) => {
    if (!isSupportedOp(fix.op)) return false;
    // A move or copy without a source can never resolve, however well-formed
    // the rest of the operation looks.
    if (fix.op === 'move' || fix.op === 'copy') {
      return typeof fix.from === 'string';
    }
    return true;
  });
}

function applyOne(
  doc: unknown,
  fix: QualityFixOp,
  index: number
): Step<unknown> {
  const label = `fix #${index + 1} (${String(fix.op)} "${String(fix.path)}")`;
  const op = fix.op;
  if (!isSupportedOp(op)) {
    return fail(`${label}: unsupported operation "${String(op)}"`);
  }

  const path = pointerToPathArray(fix.path);

  switch (op) {
    case 'add':
      return addAtPath(doc, path, fix.value, label);

    case 'replace':
      return replaceAtPath(doc, path, fix.value, label);

    case 'remove': {
      const removed = removeAtPath(doc, path, label);
      if (!removed.ok) return removed;
      return step(removed.value.doc);
    }

    case 'copy': {
      const from = readFrom(fix, label);
      if (!from.ok) return from;
      const source = resolvePath(doc, from.value.path);
      if (!source.ok) return fail(`${label}: ${source.error}`);
      // The copied subtree is shared rather than deep-cloned: every write in
      // this module clones the path it touches, so neither reference can ever
      // observe an edit made through the other.
      return addAtPath(doc, path, source.value, label);
    }

    case 'move': {
      const from = readFrom(fix, label);
      if (!from.ok) return from;
      if (samePath(from.value.path, path)) return step(doc);
      if (isProperPrefix(from.value.path, path)) {
        return fail(
          `${label}: ${describePointer(from.value.path)} cannot be moved ` +
            'into its own child'
        );
      }
      // RFC 6902 removes first, so a move inside one array is expressed
      // against post-removal indices.
      const removed = removeAtPath(doc, from.value.path, label);
      if (!removed.ok) return removed;
      return addAtPath(removed.value.doc, path, removed.value.removed, label);
    }

    case 'test': {
      const actual = resolvePath(doc, path);
      if (!actual.ok) return fail(`${label}: ${actual.error}`);
      if (!deepEqual(actual.value, fix.value)) {
        return fail(`${label}: test failed, the value at the path differs`);
      }
      return step(doc);
    }
  }
}

function addAtPath(
  doc: unknown,
  path: readonly Segment[],
  value: unknown,
  label: string
): Step<unknown> {
  // An empty pointer addresses the whole document.
  if (path.length === 0) return step(value);
  const last = path[path.length - 1];
  return updateParent(doc, path, label, (parent) => {
    if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : toIndex(last);
      if (index === null) {
        return fail(`${label}: "${String(last)}" is not an array index`);
      }
      if (index > parent.length) {
        return fail(`${label}: index ${index} is past the end of the array`);
      }
      const next = cloneContainer(parent) as unknown[];
      // `add` inserts and only `replace` overwrites. Getting this backwards
      // drops the element that was there and silently corrupts the document.
      next.splice(index, 0, value);
      return step(next);
    }
    if (isPlainObject(parent)) {
      const next = cloneContainer(parent) as Record<string, unknown>;
      next[String(last)] = value;
      return step(next);
    }
    return fail(
      `${label}: ${describePointer(path.slice(0, -1))} is not an object or array`
    );
  });
}

function replaceAtPath(
  doc: unknown,
  path: readonly Segment[],
  value: unknown,
  label: string
): Step<unknown> {
  if (path.length === 0) return step(value);
  const last = path[path.length - 1];
  return updateParent(doc, path, label, (parent) => {
    if (Array.isArray(parent)) {
      const index = toIndex(last);
      if (index === null || index >= parent.length) {
        return fail(
          `${label}: "${String(last)}" is not an existing array index`
        );
      }
      const next = cloneContainer(parent) as unknown[];
      next[index] = value;
      return step(next);
    }
    if (isPlainObject(parent)) {
      const key = String(last);
      if (!hasOwn(parent, key)) {
        return fail(`${label}: "${key}" does not exist`);
      }
      const next = cloneContainer(parent) as Record<string, unknown>;
      next[key] = value;
      return step(next);
    }
    return fail(
      `${label}: ${describePointer(path.slice(0, -1))} is not an object or array`
    );
  });
}

function removeAtPath(
  doc: unknown,
  path: readonly Segment[],
  label: string
): Step<{ doc: unknown; removed: unknown }> {
  if (path.length === 0) {
    return fail(`${label}: the whole document cannot be removed`);
  }
  const last = path[path.length - 1];
  let removed: unknown;
  const next = updateParent(doc, path, label, (parent) => {
    if (Array.isArray(parent)) {
      const index = toIndex(last);
      if (index === null || index >= parent.length) {
        return fail(
          `${label}: "${String(last)}" is not an existing array index`
        );
      }
      const clone = cloneContainer(parent) as unknown[];
      removed = clone.splice(index, 1)[0];
      return step(clone);
    }
    if (isPlainObject(parent)) {
      const key = String(last);
      if (!hasOwn(parent, key)) {
        return fail(`${label}: "${key}" does not exist`);
      }
      const clone = cloneContainer(parent) as Record<string, unknown>;
      removed = clone[key];
      delete clone[key];
      return step(clone);
    }
    return fail(
      `${label}: ${describePointer(path.slice(0, -1))} is not an object or array`
    );
  });
  if (!next.ok) return next;
  return step({ doc: next.value, removed });
}

/**
 * Walk to the container that owns the last segment of `path`, hand it to
 * `update`, and rebuild the document around what comes back. Only containers
 * on the path are cloned — every sibling subtree stays shared, the structural
 * sharing `doc-mutations.ts` relies on to leave the caller's graph intact.
 */
function updateParent(
  doc: unknown,
  path: readonly Segment[],
  label: string,
  update: (parent: unknown) => Step<unknown>
): Step<unknown> {
  return rewrite(doc, path.slice(0, -1), 0, label, update);
}

function rewrite(
  node: unknown,
  parentPath: readonly Segment[],
  depth: number,
  label: string,
  update: (parent: unknown) => Step<unknown>
): Step<unknown> {
  if (depth === parentPath.length) return update(node);

  const here = () => describePointer(parentPath.slice(0, depth + 1));
  const segment = parentPath[depth];

  if (Array.isArray(node)) {
    const index = toIndex(segment);
    if (index === null || index >= node.length) {
      return fail(`${label}: ${here()} does not exist`);
    }
    const child = rewrite(node[index], parentPath, depth + 1, label, update);
    if (!child.ok) return child;
    const next = cloneContainer(node) as unknown[];
    next[index] = child.value;
    return step(next);
  }

  if (isPlainObject(node)) {
    const key = String(segment);
    // Writing through a missing parent would invent structure the fix never
    // described, so it fails instead of materializing containers.
    if (!hasOwn(node, key)) {
      return fail(`${label}: ${here()} does not exist`);
    }
    const child = rewrite(node[key], parentPath, depth + 1, label, update);
    if (!child.ok) return child;
    const next = cloneContainer(node) as Record<string, unknown>;
    next[key] = child.value;
    return step(next);
  }

  return fail(
    `${label}: ${describePointer(
      parentPath.slice(0, depth)
    )} is not an object or array`
  );
}

function resolvePath(doc: unknown, path: readonly Segment[]): Step<unknown> {
  let current = doc;
  for (let depth = 0; depth < path.length; depth++) {
    const segment = path[depth];
    if (Array.isArray(current)) {
      const index = toIndex(segment);
      if (index === null || index >= current.length) {
        return fail(
          `${describePointer(path.slice(0, depth + 1))} does not exist`
        );
      }
      current = current[index];
      continue;
    }
    if (isPlainObject(current)) {
      const key = String(segment);
      if (!hasOwn(current, key)) {
        return fail(
          `${describePointer(path.slice(0, depth + 1))} does not exist`
        );
      }
      current = current[key];
      continue;
    }
    return fail(
      `${describePointer(path.slice(0, depth))} is not an object or array`
    );
  }
  return step(current);
}

function readFrom(
  fix: QualityFixOp,
  label: string
): Step<{ pointer: string; path: Segment[] }> {
  const pointer = fix.from;
  if (typeof pointer !== 'string') {
    return fail(`${label}: a "from" pointer is required`);
  }
  return step({ pointer, path: pointerToPathArray(pointer) });
}

/**
 * Shallow-clone a container before writing into it — the `cloneContainer`
 * idiom from `doc-mutations.ts`, minus its materialization of missing levels,
 * which RFC 6902 forbids.
 */
function cloneContainer(
  value: readonly unknown[] | Record<string, unknown>
): unknown[] | Record<string, unknown> {
  if (Array.isArray(value)) return [...value];
  return { ...(value as Record<string, unknown>) };
}

/**
 * Coerce a pointer segment to an array index. The pointer parser already
 * hands back numbers for canonical indices, but a segment that survived as a
 * string ('01', '-', 'title') addresses nothing in an array.
 */
function toIndex(segment: Segment): number | null {
  if (typeof segment === 'number') {
    return Number.isInteger(segment) && segment >= 0 ? segment : null;
  }
  return /^(?:0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : null;
}

function describePointer(path: readonly Segment[]): string {
  return path.length === 0
    ? 'the document root'
    : `"${pathArrayToPointer(path)}"`;
}

function isSupportedOp(op: unknown): op is SupportedOp {
  return (SUPPORTED_OPS as readonly unknown[]).includes(op);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function samePath(a: readonly Segment[], b: readonly Segment[]): boolean {
  return (
    a.length === b.length && a.every((seg, i) => String(seg) === String(b[i]))
  );
}

function isProperPrefix(
  prefix: readonly Segment[],
  path: readonly Segment[]
): boolean {
  if (prefix.length >= path.length) return false;
  return prefix.every((seg, i) => String(seg) === String(path[i]));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function step<T>(value: T): Step<T> {
  return { ok: true, value };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * RFC 6901 JSON Pointer helpers. Quality findings address the authored
 * document by pointer ('/children/0/props/fontSize'); the playground needs
 * those pointers both as character ranges (to reveal the location in Monaco)
 * and as path arrays (to mutate the parsed document).
 *
 * Built on jsonc-parser, like document-outline.ts, because `parseTree` is
 * error-tolerant: the editor text is frequently mid-edit and temporarily
 * invalid, and a pointer lookup must degrade to null rather than throw.
 */
import { parseTree, findNodeAtLocation, type Node } from 'jsonc-parser';

/**
 * A segment is an array index only when it is a canonical non-negative
 * integer. '01' and '-1' stay strings so they can still match an object key
 * spelled exactly that way.
 */
const ARRAY_INDEX_RE = /^(?:0|[1-9][0-9]*)$/;

/** RFC 6901 segment decode: ~1 -> '/', ~0 -> '~'. Order matters. */
export function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** RFC 6901 segment encode: '~' -> ~0, '/' -> ~1. Order matters. */
function encodePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** '' -> []. '/a/0/b' -> ['a', 0, 'b']. Numeric segments become numbers. */
export function pointerToPathArray(pointer: string): (string | number)[] {
  if (pointer === '') return [];
  // Tolerate a missing leading '/' so a caller-built 'a/b' still resolves;
  // splitting a well-formed pointer always yields an empty first element.
  const body = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return body.split('/').map((raw) => {
    const decoded = decodePointerSegment(raw);
    return ARRAY_INDEX_RE.test(decoded) ? Number(decoded) : decoded;
  });
}

/** Inverse of pointerToPathArray, with ~ and / re-escaped. */
export function pathArrayToPointer(path: readonly (string | number)[]): string {
  return path
    .map((segment) => `/${encodePointerSegment(String(segment))}`)
    .join('');
}

/**
 * Resolves one segment below `node`. A numeric-looking OBJECT key is
 * ambiguous — pointerToPathArray turns '0' into the number 0, which
 * findNodeAtLocation only matches against arrays — so a failed numeric lookup
 * retries as the string key before giving up.
 */
function resolveSegment(
  node: Node,
  segment: string | number
): Node | undefined {
  const hit = findNodeAtLocation(node, [segment]);
  if (hit || typeof segment !== 'number') return hit;
  return findNodeAtLocation(node, [String(segment)]);
}

/**
 * Character offsets of the VALUE the pointer addresses, in the given JSON
 * text. Returns null when the pointer does not resolve.
 *
 * Callers pass Monaco MODEL text, which may contain collapsed-string
 * sentinels (`§jtoc:<id>§`). Those are ordinary JSON string contents, so the
 * parse succeeds and the offsets line up with what is on screen — do not
 * "fix" this by expanding them first.
 */
export function findPointerRange(
  text: string,
  pointer: string
): { start: number; end: number } | null {
  if (!text.trim()) return null;
  let node: Node | undefined;
  try {
    node = parseTree(text, [], { allowTrailingComma: true });
    if (!node) return null;
    for (const segment of pointerToPathArray(pointer)) {
      node = resolveSegment(node, segment);
      if (!node) return null;
    }
  } catch {
    // parseTree is error-tolerant, but a pointer must never take the editor
    // down over text the user is halfway through typing.
    return null;
  }
  return { start: node.offset, end: node.offset + node.length };
}

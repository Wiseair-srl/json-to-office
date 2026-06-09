/**
 * Word-level text diff
 *
 * Tokenizes text into words and whitespace, runs an LCS diff over the
 * tokens, and emits revision segments. Pure, dependency-free.
 */

import type { RevisionSegment } from '../schemas/components/revision';

/**
 * Anchored to the schema type so the diff engine can never emit segments
 * the RevisionSchema would reject.
 */
export type DiffSegment = RevisionSegment;

/**
 * Above this many DP cells the LCS table is not worth building: fall back
 * to a whole-text replace. ~1000x1000 tokens covers any realistic paragraph.
 */
const MAX_LCS_CELLS = 1_000_000;

/** Split into alternating word / whitespace tokens (both preserved). */
export function tokenizeWords(text: string): string[] {
  if (!text) return [];
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/**
 * Readability pass over the raw LCS output:
 * 1. A whitespace-only equal segment flanked by changes joins the change
 *    (the space is both deleted and re-inserted), so "x y" -> "a b" reads
 *    as one replacement instead of three fragments.
 * 2. Within each change run, deletions are emitted before insertions.
 * The old/new reconstruction invariant is preserved.
 */
function normalizeSegments(segments: DiffSegment[]): DiffSegment[] {
  const folded: DiffSegment[] = [];
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    if (seg.type === 'equal' && /^\s+$/.test(seg.text)) {
      const prev = folded[folded.length - 1];
      const next = segments[k + 1];
      if (prev && prev.type !== 'equal' && next && next.type !== 'equal') {
        folded.push(
          { type: 'delete', text: seg.text },
          { type: 'insert', text: seg.text }
        );
        continue;
      }
    }
    folded.push({ ...seg });
  }

  const out: DiffSegment[] = [];
  let k = 0;
  while (k < folded.length) {
    if (folded[k].type === 'equal') {
      out.push(folded[k]);
      k++;
      continue;
    }
    let deleted = '';
    let inserted = '';
    while (k < folded.length && folded[k].type !== 'equal') {
      if (folded[k].type === 'delete') deleted += folded[k].text;
      else inserted += folded[k].text;
      k++;
    }
    if (deleted) out.push({ type: 'delete', text: deleted });
    if (inserted) out.push({ type: 'insert', text: inserted });
  }
  return mergeSegments(out);
}

/**
 * Word-level diff between two strings.
 *
 * Returns merged segments in document order. Deleting everything and
 * inserting everything (whole replace) is the degenerate output for
 * completely different texts or oversized inputs.
 */
export function diffWords(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) {
    return oldText ? [{ type: 'equal', text: oldText }] : [];
  }

  const oldTokens = tokenizeWords(oldText);
  const newTokens = tokenizeWords(newText);

  if (oldTokens.length === 0) {
    return mergeSegments([{ type: 'insert', text: newText }]);
  }
  if (newTokens.length === 0) {
    return mergeSegments([{ type: 'delete', text: oldText }]);
  }

  if (oldTokens.length * newTokens.length > MAX_LCS_CELLS) {
    return mergeSegments([
      { type: 'delete', text: oldText },
      { type: 'insert', text: newText },
    ]);
  }

  // Standard LCS dynamic programming table
  const n = oldTokens.length;
  const m = newTokens.length;
  // lcs[i][j] = LCS length of oldTokens[i..] and newTokens[j..]
  const lcs: Int32Array[] = Array.from(
    { length: n + 1 },
    () => new Int32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldTokens[i] === newTokens[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Backtrack
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      segments.push({ type: 'equal', text: oldTokens[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      segments.push({ type: 'delete', text: oldTokens[i] });
      i++;
    } else {
      segments.push({ type: 'insert', text: newTokens[j] });
      j++;
    }
  }
  while (i < n) {
    segments.push({ type: 'delete', text: oldTokens[i] });
    i++;
  }
  while (j < m) {
    segments.push({ type: 'insert', text: newTokens[j] });
    j++;
  }

  return normalizeSegments(segments);
}

/**
 * Strip the inline markdown the renderer understands (bold/italic markers,
 * hyperlinks) so revision segments — which render literally — never expose
 * raw markers. Uses the exact decorator regex of textParser.ts (lazy
 * [\s\S]*? content), so what the parser would style, this strips — including
 * content containing '*' or '_' (e.g. **snake_case**).
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') // [text](url) -> text
    .replace(
      /(\*\*\*|___)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5/g,
      (_match, _d1, bi, _d2, b, _d3, i) => bi ?? b ?? i ?? ''
    );
}

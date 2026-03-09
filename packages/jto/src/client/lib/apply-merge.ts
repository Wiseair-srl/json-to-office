/** Deterministic hash of a string — used as a stable apply-diff ID. */
export function applyId(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Content-based merge: finds `selectedText` in the current document
 * and splices `aiOutput` at that location. Falls back to full-doc
 * replacement when the selected text can't be uniquely located.
 */
export function mergeAiOutput(
  currentDoc: string,
  aiOutput: string,
  ctx?: { selectedText?: string; startLine?: number }
): { original: string; modified: string } {
  if (!ctx?.selectedText) {
    return { original: currentDoc, modified: aiOutput };
  }

  const needle = ctx.selectedText;
  const firstIdx = currentDoc.indexOf(needle);

  if (firstIdx === -1) {
    // Selected text no longer exists — full-doc replacement
    return { original: currentDoc, modified: aiOutput };
  }

  const secondIdx = currentDoc.indexOf(needle, firstIdx + 1);

  let spliceIdx: number;

  if (secondIdx === -1) {
    // Unique match
    spliceIdx = firstIdx;
  } else {
    // Multiple matches — pick closest to original startLine
    if (ctx.startLine && ctx.startLine > 0) {
      const targetOffset = charOffsetForLine(currentDoc, ctx.startLine);
      spliceIdx = pickClosest(currentDoc, needle, targetOffset);
    } else {
      spliceIdx = firstIdx;
    }
  }

  const before = currentDoc.slice(0, spliceIdx);
  const after = currentDoc.slice(spliceIdx + needle.length);
  const merged = before + aiOutput + after;

  return { original: currentDoc, modified: merged };
}

/** Convert a 1-based line number to a character offset. */
function charOffsetForLine(text: string, line: number): number {
  let offset = 0;
  const lines = text.split('\n');
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
    offset += lines[i].length + 1; // +1 for the newline
  }
  return offset;
}

/** Find all occurrences and return the one closest to `targetOffset`. */
function pickClosest(text: string, needle: string, targetOffset: number): number {
  let best = -1;
  let bestDist = Infinity;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    const dist = Math.abs(idx - targetOffset);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
    idx = text.indexOf(needle, idx + 1);
  }
  return best;
}

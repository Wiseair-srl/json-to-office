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
 * and splices `aiOutput` at that location.
 *
 * Fallback chain:
 * 1. indexOf(selectedText) splice — selection-edit mode
 * 2. Fragment splice — aiOutput is a JSON fragment, locate matching key(s)
 * 3. Line-range splice — use startLine/endLine when indexOf fails
 * 4. Full-doc replacement — last resort
 */
export function mergeAiOutput(
  currentDoc: string,
  aiOutput: string,
  ctx?: { selectedText?: string; startLine?: number; endLine?: number }
): { original: string; modified: string } {
  // ── 0. Named-object splice ─────────────────────────────────────────
  // When the AI output is a JSON object with a "name" field, find the
  // matching named object in the document and replace only that one.
  // Only when there's no active selection — selection splice takes priority.
  if (!ctx?.selectedText) {
    const namedResult = tryNamedObjectSplice(currentDoc, aiOutput);
    if (namedResult) return namedResult;
  }

  // ── 1. Selection splice ────────────────────────────────────────────
  if (ctx?.selectedText) {
    const needle = ctx.selectedText;
    const firstIdx = currentDoc.indexOf(needle);

    if (firstIdx !== -1) {
      const secondIdx = currentDoc.indexOf(needle, firstIdx + 1);

      let spliceIdx: number;

      if (secondIdx === -1) {
        spliceIdx = firstIdx;
      } else {
        if (ctx.startLine && ctx.startLine > 0) {
          const targetOffset = charOffsetForLine(currentDoc, ctx.startLine);
          spliceIdx = pickClosest(currentDoc, needle, targetOffset);
        } else {
          spliceIdx = firstIdx;
        }
      }

      const before = currentDoc.slice(0, spliceIdx);
      const after = currentDoc.slice(spliceIdx + needle.length);
      return { original: currentDoc, modified: before + aiOutput + after };
    }

    // indexOf failed — try line-range splice
    if (ctx.startLine && ctx.endLine) {
      const result = lineRangeSplice(currentDoc, aiOutput, ctx.startLine, ctx.endLine);
      if (result) return result;
    }

    // Fall through to fragment splice before full-doc replacement
    const fragResult = tryFragmentSplice(currentDoc, aiOutput);
    if (fragResult) return fragResult;

    return { original: currentDoc, modified: aiOutput };
  }

  // ── 2. Fragment splice (no selection) ──────────────────────────────
  const fragmentResult = tryFragmentSplice(currentDoc, aiOutput);
  if (fragmentResult) return fragmentResult;

  // ── 3. Full-doc replacement ────────────────────────────────────────
  return { original: currentDoc, modified: aiOutput };
}

/**
 * When the AI output is a JSON object with a "name" property, locate the
 * matching named object in the parsed document tree, replace it, and
 * re-serialize with the document's own indent style to avoid format diffs.
 */
function tryNamedObjectSplice(
  currentDoc: string,
  aiOutput: string
): { original: string; modified: string } | null {
  let aiParsed: Record<string, unknown>;
  try {
    aiParsed = JSON.parse(aiOutput);
  } catch {
    return null;
  }
  if (!aiParsed || typeof aiParsed !== 'object' || Array.isArray(aiParsed)) return null;
  const name = aiParsed.name;
  if (typeof name !== 'string' || !name) return null;

  let doc: unknown;
  try {
    doc = JSON.parse(currentDoc);
  } catch {
    return null;
  }

  // Detect the document's indent size from the source text
  const indentMatch = currentDoc.match(/\n(\s+)"/);
  const indent = indentMatch ? indentMatch[1].length : 2;

  // Recursively find and replace the named object in the parsed tree
  if (!replaceNamedObject(doc, name, aiParsed)) return null;

  const modified = JSON.stringify(doc, null, indent);
  return { original: currentDoc, modified };
}

/** Recursively walk a parsed JSON tree and replace the first object whose
 *  "name" matches `target`. Returns true if a replacement was made. */
function replaceNamedObject(node: unknown, target: string, replacement: Record<string, unknown>): boolean {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      if (item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).name === target) {
        node[i] = replacement;
        return true;
      }
      if (replaceNamedObject(item, target, replacement)) return true;
    }
    return false;
  }
  if (node && typeof node === 'object') {
    for (const val of Object.values(node as Record<string, unknown>)) {
      if (replaceNamedObject(val, target, replacement)) return true;
    }
  }
  return false;
}

/**
 * Detect whether aiOutput is a JSON fragment (not a complete document)
 * and splice it into the correct location in currentDoc.
 */
function tryFragmentSplice(
  currentDoc: string,
  aiOutput: string
): { original: string; modified: string } | null {
  // If aiOutput parses as a complete object with the same root keys as the
  // document, it's a full replacement — not a fragment.  Fragments like
  // {"text":"hi"} also parse successfully, so we must compare keys.
  try {
    const parsed = JSON.parse(aiOutput);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      try {
        const doc = JSON.parse(currentDoc);
        if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
          const fragKeys = Object.keys(parsed).sort().join(',');
          const docKeys = Object.keys(doc).sort().join(',');
          if (fragKeys === docKeys) {
            // Root keys match — treat as full-doc replacement
            return null;
          }
        }
      } catch {
        // currentDoc isn't valid JSON — fall through to fragment logic
      }
    }
  } catch {
    // Doesn't parse as standalone JSON — likely a fragment
  }

  // Extract fragment keys: lines like `"key": ...` at the start of the fragment
  const fragmentKeys = extractFragmentKeys(aiOutput);
  if (fragmentKeys.length === 0) return null;

  // Try to splice each key's value into the document
  let modified = currentDoc;
  let anyReplaced = false;

  for (const key of fragmentKeys) {
    const result = spliceKeyValue(modified, aiOutput, key);
    if (result) {
      modified = result;
      anyReplaced = true;
    }
  }

  return anyReplaced ? { original: currentDoc, modified } : null;
}

/**
 * Extract top-level property keys from a JSON fragment string.
 * Handles fragments like: `"table": [...]` or `"text": "hello", "fontSize": 12`
 */
export function extractFragmentKeys(fragment: string): string[] {
  const keys: string[] = [];

  // Only grab keys that appear to be at top indentation level
  const lines = fragment.split('\n');
  const firstContentLine = lines.find((l) => l.trim().length > 0);
  if (!firstContentLine) return keys;
  const baseIndent = firstContentLine.search(/\S/);

  for (const line of lines) {
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    if (indent !== baseIndent) continue;
    const keyMatch = line.match(/^\s*"([^"]+)"\s*:/);
    if (keyMatch) keys.push(keyMatch[1]);
  }

  return [...new Set(keys)];
}

/**
 * Find `"key": <value>` in the document and replace it with the
 * corresponding span from the fragment.
 */
function spliceKeyValue(
  doc: string,
  fragment: string,
  key: string
): string | null {
  // Find all occurrences of `"key":` in the document
  const keyPattern = `"${key}"`;
  const occurrences = findKeyValueSpans(doc, keyPattern);
  if (occurrences.length === 0) return null;

  // Find the key-value span in the fragment
  const fragSpans = findKeyValueSpans(fragment, keyPattern);
  if (fragSpans.length === 0) return null;

  const fragSpan = fragSpans[0];
  const newText = fragment.slice(fragSpan.start, fragSpan.end);

  // Pick the occurrence in doc whose old value is most similar to the new value
  let bestIdx = 0;
  if (occurrences.length > 1) {
    let bestScore = -1;
    for (let i = 0; i < occurrences.length; i++) {
      const oldText = doc.slice(occurrences[i].start, occurrences[i].end);
      const score = similarity(oldText, newText);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }

  const span = occurrences[bestIdx];
  return doc.slice(0, span.start) + newText + doc.slice(span.end);
}

export interface Span {
  start: number;
  end: number;
}

/**
 * Find all `"key": <value>` spans in text. Returns the span covering
 * from the opening `"` of the key to the end of the value
 * (excluding trailing comma).
 */
export function findKeyValueSpans(text: string, keyPattern: string): Span[] {
  const spans: Span[] = [];
  let searchFrom = 0;

  for (;;) {
    const keyIdx = text.indexOf(keyPattern, searchFrom);
    if (keyIdx === -1) break;

    // Verify this is actually a key position, not a string value
    let prev = keyIdx - 1;
    while (prev >= 0 && (text[prev] === ' ' || text[prev] === '\t')) prev--;
    const precChar = prev < 0 ? '' : text[prev];
    if (precChar !== '' && precChar !== '{' && precChar !== ',' && precChar !== '\n' && precChar !== '\r') {
      searchFrom = keyIdx + 1;
      continue;
    }

    const colonIdx = text.indexOf(':', keyIdx + keyPattern.length);
    if (colonIdx === -1) {
      searchFrom = keyIdx + 1;
      continue;
    }

    // Find the extent of the value after the colon
    const valueStart = colonIdx + 1;
    const valueEnd = findValueEnd(text, valueStart);
    if (valueEnd === -1) {
      searchFrom = keyIdx + 1;
      continue;
    }

    // Exclude trailing comma — let the doc's original punctuation remain
    spans.push({ start: keyIdx, end: valueEnd });
    searchFrom = valueEnd;
  }

  return spans;
}

/**
 * From a position right after `:`, skip whitespace then find the end
 * of the JSON value (string, number, boolean, null, array, or object).
 */
function findValueEnd(text: string, pos: number): number {
  // Skip whitespace
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  if (pos >= text.length) return -1;

  const ch = text[pos];

  if (ch === '"') {
    // String value — find closing quote (handle escapes)
    let i = pos + 1;
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '"') return i + 1;
      i++;
    }
    return -1;
  }

  if (ch === '[' || ch === '{') {
    // Bracket/brace matching
    const open = ch;
    const close = ch === '[' ? ']' : '}';
    let depth = 1;
    let i = pos + 1;
    let inString = false;
    while (i < text.length && depth > 0) {
      if (text[i] === '\\' && inString) {
        i += 2;
        continue;
      }
      if (text[i] === '"') inString = !inString;
      if (!inString) {
        if (text[i] === open) depth++;
        else if (text[i] === close) depth--;
      }
      i++;
    }
    return depth === 0 ? i : -1;
  }

  // Primitive: number, boolean, null — read until delimiter
  let i = pos;
  while (i < text.length && /[^\s,\]}]/.test(text[i])) i++;
  return i > pos ? i : -1;
}

/**
 * Line-range splice: replace lines startLine..endLine with aiOutput.
 */
export function lineRangeSplice(
  doc: string,
  replacement: string,
  startLine: number,
  endLine: number
): { original: string; modified: string } | null {
  const lines = doc.split('\n');
  if (startLine < 1 || endLine < startLine || startLine > lines.length) return null;

  const before = lines.slice(0, startLine - 1).join('\n');
  const after = lines.slice(endLine).join('\n');
  const modified = before + (before ? '\n' : '') + replacement + (after ? '\n' : '') + after;
  return { original: doc, modified };
}

/**
 * Simple similarity score (ratio of matching characters via LCS length).
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  // For perf, use a simplified approach: count shared 3-grams
  const size = 3;
  const gramsA = new Set<string>();
  for (let i = 0; i <= a.length - size; i++) gramsA.add(a.slice(i, i + size));

  let shared = 0;
  for (let i = 0; i <= b.length - size; i++) {
    if (gramsA.has(b.slice(i, i + size))) shared++;
  }

  const total = Math.max(a.length - size + 1, b.length - size + 1);
  return total > 0 ? shared / total : 0;
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

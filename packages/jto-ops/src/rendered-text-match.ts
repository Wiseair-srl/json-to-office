/**
 * Locate authored text in rendered PDF geometry.
 *
 * Promoted from the ground-truth harness's sentinel search: fold both sides
 * into lowercase alphanumerics (NFKC splits ligatures, punctuation and bullet
 * glyphs drop out), concatenate every word fragment into one stream, and
 * search that. Narrow boxes hard-wrap a word mid-word and letter-spaced text
 * makes poppler emit per-cluster fragments; a per-word comparison loses both,
 * a stream keeps them.
 *
 * The stream spans the whole document, not one page, so a paragraph that
 * breaks across a page is still one match — which is exactly the case the
 * widow and orphan checks need. Running heads and footers would interleave
 * the two halves, so text that repeats by design is matched first, page by
 * page, and its words are removed from the stream before anything else is.
 *
 * Duplicate strings — "Total" in three tables — are why a search returns
 * every occurrence. `assignInventory` resolves them by reading order: the
 * inventory is walked in document order and the stream is in page order, so
 * the next unclaimed occurrence at or after the previous claim is the one.
 */

import type { PdfTextPage } from './pdf-text-geometry';

/** Fold rendered and authored text into one comparable form. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Authored strings carry markup the page never shows: emphasis markers,
 * footnote references, link targets, field codes. Strip those before folding
 * so the needle is what LibreOffice actually set. Fields become nothing —
 * "Page {PAGE}" matches the word "Page" — because their rendered value is
 * unknowable here.
 */
export function authoredTextForMatch(text: string): string {
  return text
    .replace(/\{[A-Z_]+(?::[^}]*)?\}/g, ' ')
    .replace(/\[\^[^\]\s]+\]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '');
}

/** A word of the document: which page, which index on it. */
export interface WordRef {
  pageIndex: number;
  word: number;
}

/** The part of a match that lies on one page, with its union box. */
export interface OccurrencePart {
  pageIndex: number;
  words: number[];
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface TextOccurrence {
  /** Offset into the document stream, for ordering. */
  at: number;
  /** First and last page the match touches; equal unless it breaks across. */
  pageIndex: number;
  endPageIndex: number;
  parts: OccurrencePart[];
}

interface StreamIndex {
  pages: readonly PdfTextPage[];
  /** One entry per word of the document, in stream order. */
  refs: WordRef[];
  fragments: string[];
  positions: number[];
  stream: string;
}

/**
 * Index every word of every page into one stream. Words in `exclude` keep
 * their slot with an empty fragment, so positions stay comparable while a
 * match can never touch them.
 */
export function indexDocument(
  pages: readonly PdfTextPage[],
  exclude: ReadonlySet<string> = new Set()
): StreamIndex {
  const refs: WordRef[] = [];
  const fragments: string[] = [];
  const positions: number[] = [];
  let cursor = 0;
  pages.forEach((page, pageIndex) => {
    page.words.forEach((word, index) => {
      const key = `${pageIndex}:${index}`;
      const fragment = exclude.has(key) ? '' : normalizeForMatch(word.text);
      refs.push({ pageIndex, word: index });
      fragments.push(fragment);
      positions.push(cursor);
      cursor += fragment.length;
    });
  });
  return { pages, refs, fragments, positions, stream: fragments.join('') };
}

function partsOf(index: StreamIndex, touched: number[]): OccurrencePart[] {
  const parts: OccurrencePart[] = [];
  for (const i of touched) {
    const ref = index.refs[i];
    const w = index.pages[ref.pageIndex].words[ref.word];
    let part = parts[parts.length - 1];
    if (!part || part.pageIndex !== ref.pageIndex) {
      part = {
        pageIndex: ref.pageIndex,
        words: [],
        xMin: Infinity,
        yMin: Infinity,
        xMax: -Infinity,
        yMax: -Infinity,
      };
      parts.push(part);
    }
    part.words.push(ref.word);
    part.xMin = Math.min(part.xMin, w.xMin);
    part.yMin = Math.min(part.yMin, w.yMin);
    part.xMax = Math.max(part.xMax, w.xMax);
    part.yMax = Math.max(part.yMax, w.yMax);
  }
  return parts;
}

/** Every occurrence of a folded needle in the stream, in reading order. */
export function findOccurrences(
  index: StreamIndex,
  needle: string
): TextOccurrence[] {
  if (needle === '') return [];
  const hits: TextOccurrence[] = [];
  let searchFrom = 0;
  for (;;) {
    const at = index.stream.indexOf(needle, searchFrom);
    if (at === -1) break;
    searchFrom = at + 1;
    const end = at + needle.length;
    const touched: number[] = [];
    // Fragments are in stream order, so the first fragment past `end` ends
    // the scan; a binary search would be faster but this runs once per
    // occurrence over a few thousand words.
    for (let i = 0; i < index.fragments.length; i++) {
      const start = index.positions[i];
      if (start >= end) break;
      const stop = start + index.fragments[i].length;
      if (stop > at && index.fragments[i] !== '') touched.push(i);
    }
    const parts = partsOf(index, touched);
    hits.push({
      at,
      pageIndex: parts[0].pageIndex,
      endPageIndex: parts[parts.length - 1].pageIndex,
      parts,
    });
  }
  return hits;
}

/** What an inventory entry needs to be matched: its text, in reading order. */
export interface InventoryEntry {
  path: string;
  text: string;
  /** Header/footer text repeats per page: every occurrence is legitimate. */
  repeats?: boolean;
}

export type MappingStatus = 'mapped' | 'ambiguous' | 'missing' | 'skipped';

export interface InventoryMatch<T extends InventoryEntry = InventoryEntry> {
  entry: T;
  needle: string;
  status: MappingStatus;
  /** One occurrence when mapped; every occurrence when the text repeats. */
  occurrences: TextOccurrence[];
  /**
   * Set when only a leading part of the text rendered: the rest was cut
   * off by a frame, a page edge or a box. Folded character counts.
   */
  partial?: { matchedChars: number; totalChars: number };
}

/** Below this many folded characters a needle matches too much to trust. */
export const MIN_NEEDLE_LENGTH = 3;
/** A prefix shorter than this could be any sentence; it proves nothing. */
export const MIN_PARTIAL_PREFIX = 16;

/**
 * The longest prefix of `needle` that occurs in the stream, when the whole
 * does not — a paragraph whose tail was clipped still starts where it was
 * written. Binary search over the prefix length: occurrence of a prefix is
 * monotone in its length.
 */
export function longestRenderedPrefix(
  index: StreamIndex,
  needle: string
): number {
  if (needle.length < MIN_PARTIAL_PREFIX) return 0;
  if (findOccurrences(index, needle.slice(0, MIN_PARTIAL_PREFIX)).length === 0)
    return 0;
  let low = MIN_PARTIAL_PREFIX;
  let high = needle.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (index.stream.includes(needle.slice(0, mid))) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Vertical overlap of more than half the shorter box: one row of text. */
function sameRow(
  a: { yMin: number; yMax: number },
  b: { yMin: number; yMax: number }
): boolean {
  const overlap = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
  const shorter = Math.min(a.yMax - a.yMin, b.yMax - b.yMin);
  return shorter > 0 && overlap > shorter / 2;
}

function needleOf(entry: InventoryEntry): string {
  return normalizeForMatch(authoredTextForMatch(entry.text));
}

/**
 * Attribute rendered occurrences to inventory entries.
 *
 * Repeating entries go first and claim every occurrence, page by page.
 * The rest are visited in document order over a stream without those
 * words; each claims the first unclaimed occurrence at or after the previous
 * claim, which is how "Total" in the second table finds the second "Total".
 * An entry with no occurrence is `missing` — fully clipped, or never set —
 * and one whose every occurrence was already claimed is `ambiguous`.
 */
export interface InventoryAssignment<T extends InventoryEntry> {
  matches: InventoryMatch<T>[];
  /** `pageIndex:word` keys of every word chrome claimed — whole rows. */
  chromeWords: ReadonlySet<string>;
}

export function assignInventory<T extends InventoryEntry>(
  pages: readonly PdfTextPage[],
  inventory: readonly T[]
): InventoryAssignment<T> {
  const results = new Map<T, InventoryMatch<T>>();
  const chromeWords = new Set<string>();
  const full = indexDocument(pages);

  for (const entry of inventory) {
    if (!entry.repeats) continue;
    const needle = needleOf(entry);
    if (needle.length < MIN_NEEDLE_LENGTH) {
      results.set(entry, { entry, needle, status: 'skipped', occurrences: [] });
      continue;
    }
    const occurrences = findOccurrences(full, needle).filter(
      (o) => o.pageIndex === o.endPageIndex
    );
    // A running head or footer owns its whole row: the page number beside
    // it is a field whose rendered value the inventory cannot know, and it
    // would otherwise sit in the stream between two halves of a paragraph.
    for (const o of occurrences) {
      for (const part of o.parts) {
        pages[part.pageIndex].words.forEach((w, i) => {
          if (sameRow(w, part)) chromeWords.add(`${part.pageIndex}:${i}`);
        });
      }
    }
    results.set(entry, {
      entry,
      needle,
      status: occurrences.length > 0 ? 'mapped' : 'missing',
      occurrences,
    });
  }

  const body = indexDocument(pages, chromeWords);
  const claimed = new Set<number>();
  let cursor = 0;
  for (const entry of inventory) {
    if (entry.repeats) continue;
    const needle = needleOf(entry);
    if (needle.length < MIN_NEEDLE_LENGTH) {
      results.set(entry, { entry, needle, status: 'skipped', occurrences: [] });
      continue;
    }
    let all = findOccurrences(body, needle);
    let partial: InventoryMatch<T>['partial'];
    if (all.length === 0) {
      const prefix = longestRenderedPrefix(body, needle);
      if (prefix > 0) {
        all = findOccurrences(body, needle.slice(0, prefix));
        partial = { matchedChars: prefix, totalChars: needle.length };
      }
    }
    if (all.length === 0) {
      results.set(entry, { entry, needle, status: 'missing', occurrences: [] });
      continue;
    }
    const free = all.filter((o) => !claimed.has(o.at));
    if (free.length === 0) {
      results.set(entry, {
        entry,
        needle,
        status: 'ambiguous',
        occurrences: all,
      });
      continue;
    }
    const chosen = free.find((o) => o.at >= cursor) ?? free[0];
    claimed.add(chosen.at);
    cursor = chosen.at;
    results.set(entry, {
      entry,
      needle,
      status: 'mapped',
      occurrences: [chosen],
      ...(partial && { partial }),
    });
  }

  return {
    matches: inventory.map((entry) => results.get(entry) as InventoryMatch<T>),
    chromeWords,
  };
}

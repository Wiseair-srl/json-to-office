/**
 * Locate authored text in rendered PDF geometry.
 *
 * Promoted from the ground-truth harness's sentinel search: fold both sides
 * into lowercase alphanumerics (NFKC splits ligatures, punctuation and bullet
 * glyphs drop out), concatenate every word fragment into one stream, and
 * search that. Narrow boxes hard-wrap a word mid-word and letter-spaced text
 * makes poppler emit per-cluster fragments; a per-word comparison loses both,
 * a stream keeps them. A match must start where a fragment starts and end
 * where one ends, so "page" never matches inside "homepage".
 *
 * The stream spans the whole document, not one page, so a paragraph that
 * breaks across a page is still one match — which is exactly the case the
 * widow and orphan checks need. Running heads and footers would interleave
 * the two halves, so text that repeats by design is matched first, inside
 * the top and bottom bands of each page, and its rows are removed from the
 * stream before anything else is; a row of nothing but digits in those
 * bands is a page number and goes with them.
 *
 * Fields, footnote marks and cross-references render a value the author
 * never typed. The needle is cut at each of them into segments that must
 * follow one another in the stream with at most a short gap between.
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

/** Marks a place where the renderer paints something the author did not type. */
const FIELD = '';

/**
 * Authored strings carry markup the page never shows: emphasis markers,
 * link targets, and fields, footnote references and cross-references whose
 * rendered value is unknowable here. The first two are dropped; the others
 * become a `FIELD` mark that `needleSegments` splits on.
 */
export function authoredTextForMatch(text: string): string {
  return text
    .replace(/\{[^}\s]+\}/g, FIELD)
    .replace(/\[\^[^\]\s]+\]/g, FIELD)
    .replace(/\[@[^\]\s]+\]/g, FIELD)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '');
}

/** Folded segments of an authored string, split at every field. */
export function needleSegments(text: string): string[] {
  return authoredTextForMatch(text)
    .split(FIELD)
    .map(normalizeForMatch)
    .filter((segment) => segment !== '');
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

export interface StreamIndex {
  pages: readonly PdfTextPage[];
  /** One entry per word of the document, in stream order. */
  refs: WordRef[];
  fragments: string[];
  /** Offset of each fragment in `stream`; excluded fragments are empty. */
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

/** Index of the first non-empty fragment starting at or after `offset`. */
function fragmentAt(index: StreamIndex, offset: number): number {
  let low = 0;
  let high = index.positions.length - 1;
  // Last fragment whose position is <= offset; empty fragments share their
  // successor's position, so walk forward past them afterwards.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (index.positions[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  while (low < index.fragments.length && index.fragments[low] === '') low++;
  return low;
}

/** Whether [at, end) starts on a fragment boundary and ends on one. */
function alignedToFragments(
  index: StreamIndex,
  at: number,
  end: number
): boolean {
  const first = fragmentAt(index, at);
  if (first >= index.fragments.length || index.positions[first] !== at) {
    return false;
  }
  let i = first;
  while (
    i < index.fragments.length &&
    index.positions[i] + index.fragments[i].length < end
  ) {
    i++;
  }
  return (
    i < index.fragments.length &&
    index.positions[i] + index.fragments[i].length === end
  );
}

/**
 * The stream range [at, end) as one part per page it touches, each with the
 * union box of its words — how a paragraph broken across a page reports the
 * geometry of both halves without losing which page each is on.
 */
function partsOf(
  index: StreamIndex,
  at: number,
  end: number
): OccurrencePart[] {
  const parts: OccurrencePart[] = [];
  for (let i = fragmentAt(index, at); i < index.fragments.length; i++) {
    const start = index.positions[i];
    if (start >= end) break;
    if (index.fragments[i] === '') continue;
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

/** One match of a stream range, with the pages it spans. */
function occurrence(
  index: StreamIndex,
  at: number,
  end: number
): TextOccurrence {
  const parts = partsOf(index, at, end);
  return {
    at,
    pageIndex: parts[0].pageIndex,
    endPageIndex: parts[parts.length - 1].pageIndex,
    parts,
  };
}

/** The most a rendered field value may add between two segments, folded. */
export const MAX_FIELD_GAP = 24;

/**
 * Every occurrence of a segmented needle in the stream, in reading order:
 * the first segment anywhere, each following one within `MAX_FIELD_GAP`
 * characters of the previous, the whole aligned to fragment boundaries.
 */
export function findOccurrences(
  index: StreamIndex,
  segments: readonly string[]
): TextOccurrence[] {
  if (segments.length === 0 || segments[0] === '') return [];
  const hits: TextOccurrence[] = [];
  let searchFrom = 0;
  for (;;) {
    const at = index.stream.indexOf(segments[0], searchFrom);
    if (at === -1) break;
    searchFrom = at + 1;
    let end = at + segments[0].length;
    let complete = true;
    for (let s = 1; s < segments.length; s++) {
      const next = index.stream.indexOf(segments[s], end);
      if (next === -1 || next - end > MAX_FIELD_GAP) {
        complete = false;
        break;
      }
      end = next + segments[s].length;
    }
    if (!complete || !alignedToFragments(index, at, end)) continue;
    hits.push(occurrence(index, at, end));
    searchFrom = end;
  }
  return hits;
}

/** What an inventory entry needs to be matched: its text, in reading order. */
export interface InventoryEntry {
  path: string;
  text: string;
  /** Header/footer text repeats per page: every occurrence is legitimate. */
  repeats?: boolean;
  /**
   * Painted by the renderer from other authored text — a contents entry —
   * so it claims its occurrence when there is one and is `skipped`, never
   * `missing`, when there is not.
   */
  optional?: boolean;
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
/** Running heads and footers live in the outer fifth of the page. */
export const CHROME_BAND = 0.2;

/**
 * The longest leading part of `needle` that occurs in the stream, when the
 * whole does not — a paragraph whose tail was clipped still starts where it
 * was written. Every place the first `MIN_PARTIAL_PREFIX` characters occur
 * on a fragment boundary is extended character by character; the longest
 * extension wins.
 */
export function longestRenderedPrefix(
  index: StreamIndex,
  needle: string
): { length: number; at: number } | undefined {
  if (needle.length < MIN_PARTIAL_PREFIX) return undefined;
  const anchor = needle.slice(0, MIN_PARTIAL_PREFIX);
  let best: { length: number; at: number } | undefined;
  let searchFrom = 0;
  for (;;) {
    const at = index.stream.indexOf(anchor, searchFrom);
    if (at === -1) break;
    searchFrom = at + 1;
    const first = fragmentAt(index, at);
    if (first >= index.fragments.length || index.positions[first] !== at) {
      continue;
    }
    let length = MIN_PARTIAL_PREFIX;
    while (
      length < needle.length &&
      index.stream.charCodeAt(at + length) === needle.charCodeAt(length)
    ) {
      length++;
    }
    if (!best || length > best.length) best = { length, at };
  }
  return best;
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

/** Whether a box sits in the top or bottom fifth, where chrome lives. */
function inChromeBand(
  page: PdfTextPage,
  box: { yMin: number; yMax: number }
): boolean {
  return (
    box.yMax <= page.heightPt * CHROME_BAND ||
    box.yMin >= page.heightPt * (1 - CHROME_BAND)
  );
}

const PAGE_NUMBER_ROW = /^[0-9\s./|-]*$/;

export interface InventoryAssignment<T extends InventoryEntry> {
  matches: InventoryMatch<T>[];
  /** `pageIndex:word` keys of every word chrome claimed — whole rows. */
  chromeWords: ReadonlySet<string>;
}

/**
 * Attribute rendered occurrences to inventory entries.
 *
 * Repeating entries go first and claim their occurrences inside the page
 * bands, one row each; rows of nothing but digits in those bands — page
 * numbers — go with them. The rest are visited in document order over a
 * stream without those words; each claims the first unclaimed occurrence at
 * or after the previous claim, which is how "Total" in the second table
 * finds the second "Total". An entry with no occurrence is `missing` —
 * fully clipped, or never set — unless it is optional, and one whose every
 * occurrence was already claimed is `ambiguous`.
 */
export function assignInventory<T extends InventoryEntry>(
  pages: readonly PdfTextPage[],
  inventory: readonly T[]
): InventoryAssignment<T> {
  const results = new Map<T, InventoryMatch<T>>();
  const chromeWords = new Set<string>();
  const claimRow = (
    pageIndex: number,
    box: { yMin: number; yMax: number }
  ): void => {
    pages[pageIndex].words.forEach((w, i) => {
      if (sameRow(w, box)) chromeWords.add(`${pageIndex}:${i}`);
    });
  };

  const repeating = inventory.filter((entry) => entry.repeats);
  if (repeating.length > 0) {
    const full = indexDocument(pages);
    for (const entry of repeating) {
      const segments = needleSegments(entry.text);
      const needle = segments.join('');
      if (needle.length < MIN_NEEDLE_LENGTH) {
        results.set(entry, {
          entry,
          needle,
          status: 'skipped',
          occurrences: [],
        });
        continue;
      }
      const occurrences = findOccurrences(full, segments).filter(
        (o) =>
          o.pageIndex === o.endPageIndex &&
          inChromeBand(pages[o.pageIndex], o.parts[0])
      );
      for (const o of occurrences) claimRow(o.pageIndex, o.parts[0]);
      results.set(entry, {
        entry,
        needle,
        status: occurrences.length > 0 ? 'mapped' : 'missing',
        occurrences,
      });
    }
  }
  // A row of digits alone in a band is a page number, whatever its footer
  // said around it — including a footer that was nothing but the field.
  pages.forEach((page, pageIndex) => {
    page.words.forEach((word, i) => {
      if (chromeWords.has(`${pageIndex}:${i}`)) return;
      if (!inChromeBand(page, word)) return;
      const row = page.words.filter((w) => sameRow(w, word));
      if (row.every((w) => PAGE_NUMBER_ROW.test(w.text))) {
        claimRow(pageIndex, word);
      }
    });
  });

  const body = indexDocument(pages, chromeWords);
  const claimed = new Set<number>();
  let cursor = 0;
  for (const entry of inventory) {
    if (entry.repeats) continue;
    const segments = needleSegments(entry.text);
    const needle = segments.join('');
    if (needle.length < MIN_NEEDLE_LENGTH) {
      results.set(entry, { entry, needle, status: 'skipped', occurrences: [] });
      continue;
    }
    let all = findOccurrences(body, segments);
    let partial: InventoryMatch<T>['partial'];
    // An optional entry is skipped when absent, so its prefix — the costliest
    // search here — is never worth looking for.
    if (all.length === 0 && segments.length === 1 && !entry.optional) {
      const prefix = longestRenderedPrefix(body, needle);
      if (prefix) {
        all = [occurrence(body, prefix.at, prefix.at + prefix.length)];
        partial = { matchedChars: prefix.length, totalChars: needle.length };
      }
    }
    if (all.length === 0) {
      results.set(entry, {
        entry,
        needle,
        status: entry.optional ? 'skipped' : 'missing',
        occurrences: [],
      });
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

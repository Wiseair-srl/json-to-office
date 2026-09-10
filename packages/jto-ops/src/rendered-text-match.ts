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

import type { PdfTextWord, PdfTextPage } from './pdf-text-geometry';

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
    for (const index of readingOrder(page.words)) {
      const word = page.words[index];
      const key = `${pageIndex}:${index}`;
      const fragment = exclude.has(key) ? '' : normalizeForMatch(word.text);
      refs.push({ pageIndex, word: index });
      fragments.push(fragment);
      positions.push(cursor);
      cursor += fragment.length;
    }
  });
  return { pages, refs, fragments, positions, stream: fragments.join('') };
}

/** A run of words on one row with no wide gap between them: one cell's line. */
interface RowFragment {
  xMin: number;
  xMax: number;
  words: number[];
}

/**
 * Word indices in the order a reader takes them, decided from geometry
 * rather than from the order poppler emitted them: poppler 24 lists a table
 * row line by line across every cell, poppler 26 lists it cell by cell, and
 * an authored string in a wrapped cell only survives the second.
 *
 * Rows are grouped by vertical overlap and split into fragments at gaps
 * wider than half the line is tall. A row of two or more fragments opens a
 * column block; the rows under it belong to the block while each of their
 * fragments sits inside one column (a right-aligned cell's second line
 * starts further right; a wrapped label's later lines are the only
 * fragment of their row) and the rows stay a line apart. A block reads
 * column by column, so a cell's lines come out together; a row of one
 * fragment outside any block — prose — reads as it lies.
 */
export function readingOrder(words: readonly PdfTextWord[]): number[] {
  // Rotated text — a chart's value-axis title — comes as boxes taller than
  // they are wide; rows and columns mean nothing to it, so it keeps the
  // order poppler gave it, in the slots it had.
  const rotated = new Set(
    words
      .map((_, i) => i)
      .filter((i) => {
        const w = words[i];
        // Three glyphs or more: a "1:" or an "I" is narrow, not rotated.
        return w.text.length > 2 && w.yMax - w.yMin > 1.5 * (w.xMax - w.xMin);
      })
  );
  const upright = uprightOrder(
    words,
    words.map((_, i) => i).filter((i) => !rotated.has(i))
  );
  const order: number[] = [];
  let next = 0;
  for (let i = 0; i < words.length; i++) {
    if (rotated.has(i)) order.push(i);
    else order.push(upright[next++]);
  }
  return order;
}

/** Middle value of a non-empty list, for a row's typical word gap. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A row of text: the words that share it, and the box they fill. */
interface TextRow {
  words: number[];
  yMin: number;
  yMax: number;
}

/**
 * The given words grouped into the rows they are read on, top down. The
 * reading order and the page-number sweep ask the same question of a page,
 * so they ask it once.
 */
function groupRows(
  words: readonly PdfTextWord[],
  indices: readonly number[]
): TextRow[] {
  const rows: TextRow[] = [];
  const byY = [...indices].sort(
    (a, b) => words[a].yMin - words[b].yMin || words[a].xMin - words[b].xMin
  );
  for (const i of byY) {
    const word = words[i];
    const row = rows[rows.length - 1];
    if (row && sameRow(words[row.words[0]], word)) {
      row.words.push(i);
      row.yMin = Math.min(row.yMin, word.yMin);
      row.yMax = Math.max(row.yMax, word.yMax);
    } else rows.push({ words: [i], yMin: word.yMin, yMax: word.yMax });
  }
  return rows;
}

function uprightOrder(
  words: readonly PdfTextWord[],
  indices: readonly number[]
): number[] {
  const grouped = groupRows(words, indices);
  const rows = grouped.map((row) => row.words);
  const fragmentsOf = (row: number[]): RowFragment[] => {
    const sorted = [...row].sort((a, b) => words[a].xMin - words[b].xMin);
    // A space is a quarter of the size; half a line's height is two of
    // them, and a cell gap on a 23-point figure is more than that. Tight
    // cell padding puts less than that between two columns, though, and
    // then poppler runs the two cells into one fragment and the column
    // they belong to cannot be told. So a gap the row's own spaces cannot
    // account for parts cells as well: within a row a word space holds to
    // its median within a hundredth — justification stretches every space
    // of a line alike — while a cell boundary is close to twice it.
    const gaps = sorted.slice(1).map((i, n) => {
      const height = words[i].yMax - words[i].yMin;
      const gap = words[i].xMin - words[sorted[n]].xMax;
      return { gap, height, wide: gap > height / 2 };
    });
    const spaces = gaps.filter((g) => !g.wide).map((g) => g.gap);
    const typical = spaces.length > 1 ? median(spaces) : undefined;
    const isCellBoundary = (n: number): boolean => {
      const g = gaps[n - 1];
      return (
        g.wide ||
        (typical !== undefined &&
          g.gap > g.height / 3 &&
          g.gap >= typical * 1.5)
      );
    };
    const out: RowFragment[] = [];
    sorted.forEach((i, n) => {
      const last = out[out.length - 1];
      const w = words[i];
      if (last && !isCellBoundary(n)) {
        last.words.push(i);
        last.xMax = Math.max(last.xMax, w.xMax);
      } else out.push({ xMin: w.xMin, xMax: w.xMax, words: [i] });
    });
    return out;
  };
  const fragments = rows.map(fragmentsOf);
  const boxes = grouped;

  // Rows less than a line apart or overlapping (a cell centred beside a
  // wrapped label; DejaVu's wrapped lines sit two thirds of a line apart)
  // belong to one cluster. Columns are the x-intervals its fragments
  // fall in, merged where they overlap, so a right-aligned cell's shorter
  // second line joins its first. A cluster that resolves into more than
  // one column is a table and reads column by column — a single value
  // centred between the two lines of the label beside it parts them
  // exactly as a row of several cells does, and no row of that block has
  // to hold two fragments for the block to exist. A fragment across two
  // columns is prose under the table: it closes the cluster and opens
  // the next.
  interface Column {
    xMin: number;
    xMax: number;
    fragments: RowFragment[];
  }
  const order: number[] = [];
  let cluster: { rows: number[]; columns: Column[] } | null = null;
  const flush = (): void => {
    if (!cluster) return;
    if (cluster.columns.length < 2) {
      for (const r of cluster.rows)
        for (const f of fragments[r]) order.push(...f.words);
    } else {
      cluster.columns.sort((a, b) => a.xMin - b.xMin);
      for (const column of cluster.columns) {
        column.fragments.sort(
          (a, b) =>
            words[a.words[0]].yMin - words[b.words[0]].yMin || a.xMin - b.xMin
        );
        for (const f of column.fragments) order.push(...f.words);
      }
    }
    cluster = null;
  };
  const overlapping = (columns: Column[], f: RowFragment): Column[] =>
    columns.filter(
      (c) => Math.min(c.xMax, f.xMax) - Math.max(c.xMin, f.xMin) > 0
    );
  for (let r = 0; r < rows.length; r++) {
    const lineHeight = boxes[r].yMax - boxes[r].yMin;
    const adjacent =
      cluster !== null && boxes[r].yMin - boxes[r - 1].yMax <= lineHeight * 0.9;
    const wide =
      cluster !== null &&
      fragments[r].some((f) => overlapping(cluster!.columns, f).length > 1);
    if (!adjacent || wide) flush();
    if (!cluster) cluster = { rows: [], columns: [] };
    cluster.rows.push(r);
    for (const f of fragments[r]) {
      const hit = overlapping(cluster.columns, f)[0];
      if (hit) {
        hit.xMin = Math.min(hit.xMin, f.xMin);
        hit.xMax = Math.max(hit.xMax, f.xMax);
        hit.fragments.push(f);
      } else
        cluster.columns.push({ xMin: f.xMin, xMax: f.xMax, fragments: [f] });
    }
  }
  flush();
  return order;
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

/** Rows this close in `yMin` are the same chrome position on different pages. */
const CHROME_ROW_TOLERANCE_PT = 6;

/**
 * Which of a repeating entry's in-band occurrences are its chrome.
 *
 * Chrome sits nearest the page edge and repeats at the same height. So on
 * each page only the occurrence closest to the top or bottom edge stands —
 * a body line near the top of a page that happens to say the same words is
 * further in than the running head above it — and, when the entry shows on
 * more than one page, only heights that recur on another page count. A
 * header that exists on a single page (a two-page report whose cover has
 * none) has nothing to recur against and is kept as it is.
 */
function chromeOccurrences<
  T extends { pageIndex: number; parts: { yMin: number; yMax: number }[] },
>(occurrences: readonly T[], pages: readonly PdfTextPage[]): T[] {
  const nearestPerPage = new Map<number, T>();
  const edgeDistance = (o: T) =>
    Math.min(o.parts[0].yMin, pages[o.pageIndex].heightPt - o.parts[0].yMax);
  for (const o of occurrences) {
    const held = nearestPerPage.get(o.pageIndex);
    if (!held || edgeDistance(o) < edgeDistance(held)) {
      nearestPerPage.set(o.pageIndex, o);
    }
  }
  const nearest = [...nearestPerPage.values()];
  if (nearest.length < 2) return nearest;
  return nearest.filter((o) =>
    nearest.some(
      (other) =>
        other.pageIndex !== o.pageIndex &&
        Math.abs(other.parts[0].yMin - o.parts[0].yMin) <=
          CHROME_ROW_TOLERANCE_PT
    )
  );
}

/**
 * The rows that are page numbers: digits alone in a band, and chrome rather
 * than content that flowed there.
 *
 * A footer that is nothing but the field renders as a bare number with no
 * repeating text to claim it, so it needs a rule of its own. The band is a
 * generous fifth of the page, though, and body content reaches into it: a
 * table's numeric row lands there on whatever page the table breaks on,
 * and a numeric cell claimed as chrome loses its own occurrence and reads
 * as never rendered.
 *
 * Two things tell chrome from content, both geometry. A page number stands
 * apart — the page margin separates it from the body, so no unclaimed row
 * lies within a line of it, while a table row has its wrapped label or its
 * neighbouring rows right against it. And a page number recurs: the
 * renderer paints one at the same height on every page, which content that
 * merely flowed into the band on one page does not. A single-page document
 * has nothing to recur against, so there the first test stands alone.
 */
function pageNumberRows(
  pages: readonly PdfTextPage[],
  claimed: ReadonlySet<string>
): { pageIndex: number; box: { yMin: number; yMax: number } }[] {
  const hits: { pageIndex: number; box: TextRow }[] = [];
  pages.forEach((page, pageIndex) => {
    const rows = groupRows(
      page.words,
      page.words.map((_, i) => i)
    );
    const free = rows.map((row) =>
      row.words.some((i) => !claimed.has(`${pageIndex}:${i}`))
    );
    rows.forEach((row, r) => {
      if (!free[r] || !inChromeBand(page, row)) return;
      if (!row.words.every((i) => PAGE_NUMBER_ROW.test(page.words[i].text)))
        return;
      const line = row.yMax - row.yMin;
      const attached = rows.some(
        (other, o) =>
          o !== r &&
          free[o] &&
          Math.max(other.yMin - row.yMax, row.yMin - other.yMax) < line
      );
      if (!attached) hits.push({ pageIndex, box: row });
    });
  });
  if (pages.length < 2) return hits;
  return hits.filter((hit) =>
    hits.some(
      (other) =>
        other.pageIndex !== hit.pageIndex &&
        Math.abs(other.box.yMin - hit.box.yMin) <= CHROME_ROW_TOLERANCE_PT
    )
  );
}

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
      const inBand = findOccurrences(full, segments).filter(
        (o) =>
          o.pageIndex === o.endPageIndex &&
          inChromeBand(pages[o.pageIndex], o.parts[0])
      );
      const occurrences = chromeOccurrences(inBand, pages);
      for (const o of occurrences) claimRow(o.pageIndex, o.parts[0]);
      results.set(entry, {
        entry,
        needle,
        status: occurrences.length > 0 ? 'mapped' : 'missing',
        occurrences,
      });
    }
  }
  for (const row of pageNumberRows(pages, chromeWords))
    claimRow(row.pageIndex, row.box);

  const body = indexDocument(pages, chromeWords);
  /** Stream offset → the entry that claimed the occurrence there. */
  const claimed = new Map<number, T>();
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
    let free = all.filter((o) => !claimed.has(o.at));
    if (free.length === 0 && !entry.optional) {
      // Every occurrence is taken. One taken by an optional entry — a
      // contents line for a heading the page shows only once — is the
      // author's text, not the field's: the optional claim is released and
      // the entry that was actually written keeps its occurrence.
      const held = all.find((o) => claimed.get(o.at)?.optional);
      if (held) {
        const holder = claimed.get(held.at) as T;
        claimed.delete(held.at);
        results.set(holder, {
          entry: holder,
          needle: results.get(holder)?.needle ?? '',
          status: 'skipped',
          occurrences: [],
        });
        free = [held];
      }
    }
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
    claimed.set(chosen.at, entry);
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

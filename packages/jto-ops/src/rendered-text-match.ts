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
 * Where the format knows more before rendering — a slide is its own page,
 * and its text boxes sit where the deck put them — the entry says so, and
 * only an occurrence on that page, preferably inside that box, is its own.
 */

import type {
  PdfTextLine,
  PdfTextWord,
  PdfTextPage,
} from './pdf-text-geometry';

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
  /** Offset just past the match: `[at, end)` is the range a claim holds. */
  end: number;
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
  /** Where the rotated text of every page starts: all upright text is before. */
  rotatedFrom: number;
}

/**
 * Index every word of every page into one stream. Words in `exclude` keep
 * their slot with an empty fragment, so positions stay comparable while a
 * match can never touch them.
 *
 * The upright text of every page comes first, page after page, so a
 * paragraph that turns the page is one run of the stream; the rotated text
 * of every page follows it all. Anywhere inside the upright text a rotated
 * run cuts whatever string it lands in: where poppler emitted it, a deck's
 * takeaway beside a chart; at the top of a page, a report paragraph that
 * turns onto the page above a chart.
 */
export function indexDocument(
  pages: readonly PdfTextPage[],
  exclude: ReadonlySet<string> = new Set(),
  order: (
    words: readonly PdfTextWord[],
    lines: readonly PdfTextLine[]
  ) => { upright: number[]; rotated: number[] } = pageOrder
): StreamIndex {
  const refs: WordRef[] = [];
  const fragments: string[] = [];
  const positions: number[] = [];
  let cursor = 0;
  const push = (pageIndex: number, index: number): void => {
    const word = pages[pageIndex].words[index];
    const key = `${pageIndex}:${index}`;
    const fragment = exclude.has(key) ? '' : normalizeForMatch(word.text);
    refs.push({ pageIndex, word: index });
    fragments.push(fragment);
    positions.push(cursor);
    cursor += fragment.length;
  };
  const orders = pages.map((page) => order(page.words, page.lines));
  orders.forEach((order, pageIndex) => {
    for (const index of order.upright) push(pageIndex, index);
  });
  const rotatedFrom = cursor;
  orders.forEach((order, pageIndex) => {
    for (const index of order.rotated) push(pageIndex, index);
  });
  return {
    pages,
    refs,
    fragments,
    positions,
    stream: fragments.join(''),
    rotatedFrom,
  };
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
 *
 * Rotated text — a chart's value-axis title — has no rows or columns to
 * take part in. It reads as one run in the order poppler gave it, after the
 * page's upright text: inside that text it could fall between two lines of
 * a paragraph and cut it in two, and a slide's takeaway set beside a chart
 * then reads as clipped, or as never rendered at all. Across a document the
 * stream sets it after every page (`indexDocument`).
 */
export function readingOrder(
  words: readonly PdfTextWord[],
  lines: readonly PdfTextLine[] = []
): number[] {
  const { upright, rotated } = pageOrder(words, lines);
  return [...upright, ...rotated];
}

/** A page's upright words in reading order, and its rotated ones apart. */
function pageOrder(
  words: readonly PdfTextWord[],
  lines: readonly PdfTextLine[] = []
): { upright: number[]; rotated: number[] } {
  const rotated = rotatedWords(words, lines);
  return {
    upright: uprightOrder(
      words,
      words.map((_, i) => i).filter((i) => !rotated.has(i))
    ),
    rotated: [...rotated].sort((a, b) => a - b),
  };
}

/**
 * A page's upright words row by row, each row left to right — the page as it
 * lies, with no columns — and its rotated ones apart.
 */
function linedOrder(
  words: readonly PdfTextWord[],
  lines: readonly PdfTextLine[] = []
): { upright: number[]; rotated: number[] } {
  const rotated = rotatedWords(words, lines);
  const upright = words.map((_, i) => i).filter((i) => !rotated.has(i));
  return {
    upright: groupRows(words, upright).flatMap((row) =>
      [...row.words].sort((a, b) => words[a].xMin - words[b].xMin)
    ),
    rotated: [...rotated].sort((a, b) => a - b),
  };
}

/**
 * Words set on their side. A long enough word says so itself, its box
 * taller than it is wide; a short one does not — "of" in a rotated title is
 * still wider than tall — but poppler groups a rotated title into one line
 * whose words stack along the page instead of across it, and every word of
 * such a line is rotated.
 */
function rotatedWords(
  words: readonly PdfTextWord[],
  lines: readonly PdfTextLine[]
): Set<number> {
  /** Plainly upright: no word set on its side is wider than it is tall. */
  const upright = words.filter(
    (w) => w.text.trim() !== '' && w.xMax - w.xMin >= w.yMax - w.yMin
  );
  /**
   * Whether the word stands on a line of upright text of its own size.
   *
   * The ratio alone cannot tell a rotated word from a short upright one: a
   * three-character word with a comma ("it,", 8.5 by 12.8 points) is half
   * again as tall as it is wide while standing in a paragraph, and taken
   * for rotated text it leaves the page's stream for the run after it and
   * cuts the paragraph it sits in (#471). What tells them apart is the
   * company each keeps. A word in a line of prose shares its baseline with
   * upright words as tall as itself; a rotated axis title crosses the lines
   * of the chart's labels, which are set at another size entirely.
   *
   * The company has to be local. A page-wide measure reads the size the
   * page mostly sets — a dense table of eight-point labels — which a line
   * of ordinary prose then towers over.
   */
  const standsInALine = (w: PdfTextWord): boolean => {
    const height = w.yMax - w.yMin;
    return upright.some((other) => {
      if (other === w) return false;
      const overlap =
        Math.min(w.yMax, other.yMax) - Math.max(w.yMin, other.yMin);
      const shorter = Math.min(height, other.yMax - other.yMin);
      if (shorter <= 0 || overlap <= shorter / 2) return false;
      const ratio = height / (other.yMax - other.yMin);
      return ratio > 0.8 && ratio < 1.25;
    });
  };
  const rotated = new Set(
    words
      .map((_, i) => i)
      .filter((i) => {
        const w = words[i];
        // Three glyphs or more: a "1:" or an "I" is narrow, not rotated.
        if (w.text.length <= 2) return false;
        if (w.yMax - w.yMin <= 1.5 * (w.xMax - w.xMin)) return false;
        return !standsInALine(w);
      })
  );
  for (const line of lines) {
    if (line.words.length < 2) continue;
    const stacked = line.words.slice(1).every((index, n) => {
      const a = words[line.words[n]];
      const b = words[index];
      const across = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
      const along = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
      return across > 0 && along <= 0;
    });
    if (stacked) for (const index of line.words) rotated.add(index);
  }
  return rotated;
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
 * Two words set at sizes this far apart are not one line of text, however
 * they overlap: a display title's box spans both lines of the small print
 * beside it.
 */
const ROW_SIZE_RATIO = 2;

/** Whether two words are set at sizes one line of text could hold. */
function comparableSize(a: PdfTextWord, b: PdfTextWord): boolean {
  const ha = a.yMax - a.yMin;
  const hb = b.yMax - b.yMin;
  return Math.max(ha, hb) <= ROW_SIZE_RATIO * Math.min(ha, hb);
}

/**
 * The given words grouped into the rows they are read on, top down. The
 * reading order and the page-number sweep ask the same question of a page,
 * so they ask it once. A word joins a row it overlaps that holds a word of
 * about its own size; measured only against the row's first word, a title
 * beside a two-line caption took both caption lines into its row, and they
 * were read one word from each line at a time.
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
    const peer = row?.words.find((w) => comparableSize(words[w], word));
    if (row && peer !== undefined && sameRow(words[peer], word)) {
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
  // the next. The other way round, prose over the table, a row that sets
  // two fragments in one column shows the column was several all along:
  // what the column holds so far is read first, whole, and each fragment
  // opens a column of its own. Left as one column, the cells under the
  // prose would be read row by row, one cell's second line after its
  // neighbour's first.
  interface Column {
    xMin: number;
    xMax: number;
    fragments: RowFragment[];
  }
  const order: number[] = [];
  const read = new Set<RowFragment>();
  const readColumn = (column: Column): void => {
    column.fragments.sort(
      (a, b) =>
        words[a.words[0]].yMin - words[b.words[0]].yMin || a.xMin - b.xMin
    );
    for (const f of column.fragments) {
      order.push(...f.words);
      read.add(f);
    }
  };
  let cluster: { rows: number[]; columns: Column[] } | null = null;
  const flush = (): void => {
    if (!cluster) return;
    if (cluster.columns.length < 2) {
      for (const r of cluster.rows)
        for (const f of fragments[r]) if (!read.has(f)) order.push(...f.words);
    } else {
      cluster.columns.sort((a, b) => a.xMin - b.xMin);
      for (const column of cluster.columns) readColumn(column);
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
    const landing = new Map<Column, number>();
    for (const f of fragments[r]) {
      const hit = overlapping(cluster.columns, f)[0];
      if (hit) landing.set(hit, (landing.get(hit) ?? 0) + 1);
    }
    for (const [column, count] of landing) {
      if (count < 2) continue;
      readColumn(column);
      cluster.columns.splice(cluster.columns.indexOf(column), 1);
    }
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
    end,
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
    const hit = occurrence(index, at, end);
    // The stream sets the rotated text of every page after all the upright
    // text: upright text running on into it, or one page's rotated run into
    // the next page's, is two neighbours of the index, not text of a page.
    if (
      at < index.rotatedFrom
        ? end > index.rotatedFrom
        : hit.pageIndex !== hit.endPageIndex
    ) {
      continue;
    }
    hits.push(hit);
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
  /**
   * The 0-based page the text is drawn on, when the format knows it before
   * rendering: a slide is its own page. Only an occurrence starting there
   * is the entry's — "13 pts" on slide 2 is not "+1.3 pts" on slide 8,
   * however alike the two fold.
   */
  page?: number;
  /**
   * Where on that page the text was laid out, in PDF points: a slide text
   * box. Of the entry's occurrences, one inside this region is its own. A
   * section tracker that repeats the first word of the title under it is
   * two occurrences of one word, and reading order cannot say which box
   * painted which; the boxes can.
   */
  region?: { xMin: number; yMin: number; xMax: number; yMax: number };
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
 * extension wins. Given a page, only a prefix starting on it counts, and it
 * ends where the page does: a slide's text never runs on into the next
 * slide's. Upright text never runs on into the rotated text after it, and
 * rotated text never past its own page's run.
 */
export function longestRenderedPrefix(
  index: StreamIndex,
  needle: string,
  page?: number,
  region?: InventoryEntry['region']
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
    if (page !== undefined && index.refs[first].pageIndex !== page) continue;
    const rotated = at >= index.rotatedFrom;
    const limit = Math.min(
      page !== undefined || rotated
        ? pageEnd(index, first)
        : index.stream.length,
      rotated ? index.stream.length : index.rotatedFrom
    );
    if (at + MIN_PARTIAL_PREFIX > limit) continue;
    let length = MIN_PARTIAL_PREFIX;
    while (
      length < needle.length &&
      at + length < limit &&
      index.stream.charCodeAt(at + length) === needle.charCodeAt(length)
    ) {
      length++;
    }
    if (region && !touchesRegion(partsOf(index, at, at + length), region)) {
      continue;
    }
    if (!best || length > best.length) best = { length, at };
  }
  return best;
}

/** Offset where the stream leaves the page of fragment `from`. */
function pageEnd(index: StreamIndex, from: number): number {
  const page = index.refs[from].pageIndex;
  let i = from;
  while (i < index.refs.length && index.refs[i].pageIndex === page) i++;
  return i < index.positions.length ? index.positions[i] : index.stream.length;
}

/** A little past a box's edge still touches it: renderer rounding, insets. */
const REGION_TOLERANCE_PT = 2;

/**
 * Whether any part of an occurrence reaches into a region. Slide text starts
 * inside its box however far it overflows, so an occurrence that nowhere
 * touches the box is some other box's words that happen to read the same.
 */
function touchesRegion(
  parts: readonly OccurrencePart[],
  region: NonNullable<InventoryEntry['region']>
): boolean {
  return parts.some(
    (part) =>
      part.xMax >= region.xMin - REGION_TOLERANCE_PT &&
      part.xMin <= region.xMax + REGION_TOLERANCE_PT &&
      part.yMax >= region.yMin - REGION_TOLERANCE_PT &&
      part.yMin <= region.yMax + REGION_TOLERANCE_PT
  );
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

/**
 * Of an entry's free occurrences, the one lying most inside its region: the
 * largest share of its words' box within it. An occurrence that runs out of
 * the region still counts by the part inside — text overflowing its box
 * starts in it. Nothing inside, and reading order decides after all.
 */
function insideRegion(
  occurrences: readonly TextOccurrence[],
  region: NonNullable<InventoryEntry['region']>
): TextOccurrence | undefined {
  let best: { occurrence: TextOccurrence; share: number } | undefined;
  for (const o of occurrences) {
    let inside = 0;
    let total = 0;
    for (const part of o.parts) {
      const w =
        Math.min(part.xMax, region.xMax) - Math.max(part.xMin, region.xMin);
      const h =
        Math.min(part.yMax, region.yMax) - Math.max(part.yMin, region.yMin);
      if (w > 0 && h > 0) inside += w * h;
      total += (part.xMax - part.xMin) * (part.yMax - part.yMin);
    }
    const share = total > 0 ? inside / total : 0;
    if (share > 0 && (!best || share > best.share)) {
      best = { occurrence: o, share };
    }
  }
  return best?.occurrence;
}

/**
 * Slide text that overflowed its box onto other text. No run of the stream
 * holds it whole: the words it was drawn over share its rows and read in
 * between. Inside the column the box stands in, from its top down, its own
 * words still come in order with only those foreign words between them — so
 * the needle is matched there across whole fragments, skipping the fewest
 * foreign ones, and never consuming a word another entry already claimed.
 * A match that skips more words than it keeps is not the text overprinted
 * but words that happen to spell it, and is refused.
 *
 * The stream range from its first word to its last holds the words it was
 * drawn over, which are another entry's, so the occurrence claims no range:
 * `claims` holds the range of each word it kept, to be claimed one by one.
 */
function overprintedOccurrence(
  index: StreamIndex,
  page: number,
  region: NonNullable<InventoryEntry['region']>,
  needle: string,
  claimed: (offset: number) => boolean
):
  | { occurrence: TextOccurrence; claims: { at: number; end: number }[] }
  | undefined {
  const words = index.pages[page]?.words;
  if (!words) return undefined;
  const fragmentOf = new Map<number, number>();
  index.refs.forEach((ref, i) => {
    if (ref.pageIndex !== page || index.fragments[i] === '') return;
    const w = words[ref.word];
    const centre = (w.xMin + w.xMax) / 2;
    if (centre < region.xMin || centre > region.xMax) return;
    if (w.yMax < region.yMin) return;
    fragmentOf.set(ref.word, i);
  });
  const sequence = groupRows(words, [...fragmentOf.keys()]).flatMap((row) =>
    [...row.words].sort((a, b) => words[a].xMin - words[b].xMin)
  );
  interface Path {
    skips: number;
    words: number[];
  }
  let reach = new Map<number, Path>();
  let best: Path | undefined;
  for (const word of sequence) {
    const i = fragmentOf.get(word) as number;
    const text = index.fragments[i];
    const usable = !claimed(index.positions[i]);
    const next = new Map<number, Path>();
    const offer = (consumed: number, path: Path) => {
      const held = next.get(consumed);
      if (!held || path.skips < held.skips) next.set(consumed, path);
    };
    // Overflow runs out of the box, never into it: the text starts inside.
    const inside =
      words[word].yMin + words[word].yMax <= 2 * region.yMax &&
      words[word].yMin + words[word].yMax >= 2 * region.yMin;
    if (usable && inside && needle.startsWith(text)) {
      offer(text.length, { skips: 0, words: [word] });
    }
    for (const [consumed, path] of reach) {
      if (usable && needle.startsWith(text, consumed)) {
        offer(consumed + text.length, {
          skips: path.skips,
          words: [...path.words, word],
        });
      }
      offer(consumed, { skips: path.skips + 1, words: path.words });
    }
    const done = next.get(needle.length);
    if (done && (!best || done.skips < best.skips)) best = done;
    next.delete(needle.length);
    reach = next;
  }
  if (!best || best.skips > best.words.length) return undefined;
  const first = fragmentOf.get(best.words[0]) as number;
  const part: OccurrencePart = {
    pageIndex: page,
    words: best.words,
    xMin: Math.min(...best.words.map((w) => words[w].xMin)),
    yMin: Math.min(...best.words.map((w) => words[w].yMin)),
    xMax: Math.max(...best.words.map((w) => words[w].xMax)),
    yMax: Math.max(...best.words.map((w) => words[w].yMax)),
  };
  const at = index.positions[first];
  return {
    occurrence: {
      at,
      end: at,
      pageIndex: page,
      endPageIndex: page,
      parts: [part],
    },
    claims: best.words.map((w) => {
      const i = fragmentOf.get(w) as number;
      return {
        at: index.positions[i],
        end: index.positions[i] + index.fragments[i].length,
      };
    }),
  };
}

/**
 * Report text the reading order took for a table. Label and value set on one
 * line by a tab, line under line — a memo's To, From, Date — part into two
 * columns exactly as two cells do, and a table reads column by column, so
 * every label comes out before any value, while the author wrote each line
 * as one string. A string the column reading never spells is looked for once
 * more in the rows as they lie (`lined`). Its words are claimed one by one in
 * the column reading, and only where no other entry holds any of them.
 */
function linedOccurrence(
  lined: StreamIndex,
  body: StreamIndex,
  segments: readonly string[],
  claimed: (offset: number) => boolean
):
  | { occurrence: TextOccurrence; claims: { at: number; end: number }[] }
  | undefined {
  const bodyFragment = new Map<string, number>();
  body.refs.forEach((ref, i) => {
    if (body.fragments[i] !== '')
      bodyFragment.set(`${ref.pageIndex}:${ref.word}`, i);
  });
  for (const hit of findOccurrences(lined, segments)) {
    const claims: { at: number; end: number }[] = [];
    for (const part of hit.parts)
      for (const word of part.words) {
        const i = bodyFragment.get(`${part.pageIndex}:${word}`);
        if (i === undefined) continue;
        claims.push({
          at: body.positions[i],
          end: body.positions[i] + body.fragments[i].length,
        });
      }
    if (claims.length === 0 || claims.some((claim) => claimed(claim.at)))
      continue;
    const at = Math.min(...claims.map((claim) => claim.at));
    return { occurrence: { ...hit, at, end: at }, claims };
  }
  return undefined;
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
 *
 * A claim holds the whole range it matched, not just where it starts: a
 * rendered word belongs to one authored string, so "Revenue" inside a title
 * another entry already owns is not free for a tracker that says "Revenue".
 * An entry that names its page looks only there, and one that names its
 * region takes the occurrence lying most inside it before reading order is
 * consulted at all.
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
  /** The page as it lies, row by row: built only when a string needs it. */
  let lined: StreamIndex | undefined;
  /** Every stream range an entry has claimed, and the entry holding it. */
  const claims: { at: number; end: number; entry: T }[] = [];
  const claimsOver = (o: TextOccurrence) =>
    claims.filter((claim) => o.at < claim.end && claim.at < o.end);
  let cursor = 0;
  for (const entry of inventory) {
    if (entry.repeats) continue;
    const segments = needleSegments(entry.text);
    const needle = segments.join('');
    if (needle.length < MIN_NEEDLE_LENGTH) {
      results.set(entry, { entry, needle, status: 'skipped', occurrences: [] });
      continue;
    }
    let all = findOccurrences(body, segments).filter(
      (o) =>
        (entry.page === undefined ||
          (o.pageIndex === entry.page && o.endPageIndex === entry.page)) &&
        (!entry.region || touchesRegion(o.parts, entry.region))
    );
    let partial: InventoryMatch<T>['partial'];
    /** The words an overprinted match kept, when that is the match. */
    let sparse: { at: number; end: number }[] | undefined;
    if (
      all.length === 0 &&
      segments.length === 1 &&
      entry.page !== undefined &&
      entry.region
    ) {
      const overprinted = overprintedOccurrence(
        body,
        entry.page,
        entry.region,
        needle,
        (offset) =>
          claims.some((claim) => claim.at <= offset && offset < claim.end)
      );
      if (overprinted) {
        all = [overprinted.occurrence];
        sparse = overprinted.claims;
      }
    }
    if (all.length === 0 && entry.page === undefined && !entry.optional) {
      lined ??= indexDocument(pages, chromeWords, linedOrder);
      const found = linedOccurrence(lined, body, segments, (offset) =>
        claims.some((claim) => claim.at <= offset && offset < claim.end)
      );
      if (found) {
        all = [found.occurrence];
        sparse = found.claims;
      }
    }
    // An optional entry is skipped when absent, so its prefix — the costliest
    // search here — is never worth looking for.
    if (all.length === 0 && segments.length === 1 && !entry.optional) {
      const prefix = longestRenderedPrefix(
        body,
        needle,
        entry.page,
        entry.region
      );
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
    let free = all.filter((o) => claimsOver(o).length === 0);
    if (free.length === 0 && !entry.optional) {
      // Every occurrence is taken. One taken by an optional entry — a
      // contents line for a heading the page shows only once — is the
      // author's text, not the field's: the optional claim is released and
      // the entry that was actually written keeps its occurrence.
      const held = all.find((o) => {
        const over = claimsOver(o);
        return over.length > 0 && over.every((claim) => claim.entry.optional);
      });
      if (held) {
        for (const claim of claimsOver(held)) {
          claims.splice(claims.indexOf(claim), 1);
          results.set(claim.entry, {
            entry: claim.entry,
            needle: results.get(claim.entry)?.needle ?? '',
            status: 'skipped',
            occurrences: [],
          });
        }
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
    const chosen =
      (entry.region && insideRegion(free, entry.region)) ??
      free.find((o) => o.at >= cursor) ??
      free[0];
    for (const range of sparse ?? [chosen])
      claims.push({ at: range.at, end: range.end, entry });
    // Rotated text sits past every page's upright text: taking it says
    // nothing about how far reading has got.
    if (chosen.at < body.rotatedFrom) cursor = chosen.at;
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

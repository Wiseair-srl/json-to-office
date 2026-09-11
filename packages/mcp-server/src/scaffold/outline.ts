/**
 * A markdown outline, reduced to what a scaffold can place.
 *
 * The parser reads four things and nothing else: the `#` title, each `##`
 * section with its `###` sub-headings, and — inside a section — prose
 * paragraphs, bullet items and GitHub-flavoured tables. Everything it reads is
 * kept in source order, because a deck built from it has to say the same
 * things in the same order as the notes it came from.
 *
 * It is deliberately not a markdown implementation. Anything it has no place
 * for is collected rather than dropped, so `jto_scaffold` can report it
 * instead of silently losing a paragraph.
 */

/** A GitHub-flavoured table: a header row and the body rows under it. */
export interface OutlineTable {
  headers: string[];
  rows: string[][];
}

export interface OutlineSection {
  heading: string;
  /** Prose paragraphs, in order. */
  paragraphs: string[];
  /** Bullet items of every list in the section, in order. */
  bullets: string[];
  /** Tables in the section, in order. */
  tables: OutlineTable[];
  /** `###` headings under this `##`, in order: the section's sub-headings. */
  subheadings: string[];
  /**
   * Paragraphs and bullets in the order they were written — what a document's
   * body text markers take, where a bullet is simply another line of body.
   */
  lines: string[];
}

/** A markdown outline, reduced to what the mapping reads. */
export interface Outline {
  title?: string;
  sections: OutlineSection[];
  /** Paragraphs before the first `##`: no section to put them in. */
  orphans: string[];
  /**
   * A second `#`, a `###` before the first `##`, or any `####` and deeper:
   * the mapping has no place for them.
   */
  skippedHeadings: string[];
}

/** `- `, `* `, `+ ` or `1. ` at the head of a line. */
const BULLET = /^\s{0,7}(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;

/** A table row: a pipe at each end is optional, a leading pipe is not. */
const TABLE_ROW = /^\s{0,3}\|(.*)$/;

/** `|---|:--:|` and friends: the row that makes the one above a header. */
const TABLE_DELIMITER = /^[\s|]*:?-{1,}:?(?:\s*\|\s*:?-{1,}:?)*[\s|]*$/;

/** The cells of one table row; the outer pipes are optional in GFM. */
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Read an outline. Everything it has no place for is collected, not dropped,
 * so `jto_scaffold` can report it rather than silently losing a paragraph.
 */
export function parseOutline(markdown: string): Outline {
  const outline: Outline = { sections: [], orphans: [], skippedHeadings: [] };
  let current: OutlineSection | undefined;
  let paragraph: string[] = [];
  /** Rows of the table being read, header row first, delimiter dropped. */
  let table: string[][] | undefined;
  /** Whether the previous line was a bullet, so a plain line continues it. */
  let inList = false;

  const push = (kind: 'paragraph' | 'bullet', text: string): void => {
    // Outside a section there is no body to carry a line: a stray paragraph
    // and a stray bullet are both orphans, reported and written nowhere.
    if (!current) return void outline.orphans.push(text);
    (kind === 'paragraph' ? current.paragraphs : current.bullets).push(text);
    current.lines.push(text);
  };
  const flushParagraph = (): void => {
    if (paragraph.length > 0) push('paragraph', paragraph.join(' '));
    paragraph = [];
  };
  const flushTable = (): void => {
    if (table && table.length > 0 && current)
      current.tables.push({ headers: table[0], rows: table.slice(1) });
    table = undefined;
  };
  const flush = (): void => {
    flushParagraph();
    flushTable();
    inList = false;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();

    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      const [, hashes, text] = heading;
      if (hashes.length === 2) {
        current = {
          heading: text,
          paragraphs: [],
          bullets: [],
          tables: [],
          subheadings: [],
          lines: [],
        };
        outline.sections.push(current);
      } else if (hashes.length === 1 && outline.title === undefined) {
        outline.title = text;
      } else if (hashes.length === 3 && current) {
        current.subheadings.push(text);
      } else {
        outline.skippedHeadings.push(text);
      }
      continue;
    }

    if (line === '') {
      flush();
      continue;
    }

    const row = raw.match(TABLE_ROW);
    if (row && current) {
      flushParagraph();
      inList = false;
      if (table && table.length === 1 && TABLE_DELIMITER.test(row[1])) continue;
      table ??= [];
      table.push(cells(line));
      continue;
    }
    flushTable();

    const bullet = raw.match(BULLET);
    if (bullet) {
      flushParagraph();
      push('bullet', bullet[1].trim());
      inList = true;
      continue;
    }

    // A plain line under a bullet continues it, the way markdown reads a
    // wrapped list item; anywhere else it is another line of the paragraph.
    if (inList && current && current.bullets.length > 0) {
      const last = current.bullets.length - 1;
      current.bullets[last] = `${current.bullets[last]} ${line}`;
      current.lines[current.lines.length - 1] = current.bullets[last];
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return outline;
}

/**
 * Page selection: the printer-range syntax, parsed and validated.
 *
 * One spelling, not two. An array (`[1,3]`) and a string (`"1-3"`) would each
 * need their own schema branch, their own validation and their own failure
 * messages, and an agent reading `tools/list` would have to guess which the
 * server prefers. The string wins because it is the notation every print
 * dialog on earth already uses, it survives a JSON Schema `pattern`, and it
 * expresses "from page 4 to the end" without knowing the page count.
 *
 * Grammar (1-based, inclusive, whitespace ignored):
 *
 *     spec  := "all" | item ("," item)*
 *     item  := N | A "-" B | A "-" | "-" B
 *
 * `"all"` is `"1-"`. Duplicates and overlaps are collapsed; the result is
 * always ascending, which is also what makes the cache key stable — `"1,2,3"`,
 * `"3,2,1"` and `"1-3"` are one selection and must not be three cache misses.
 */

import { failure, type Diagnostic, type Failure } from '../lib/errors.js';
import { diagnostic } from '../lib/errors.js';
import { PREVIEW_ERROR_CODES } from './codes.js';

/** Selects every page. */
export const ALL_PAGES = 'all';

/** JSON Schema `pattern` for the syntax above, so bad input fails at the edge. */
export const PAGE_SPEC_PATTERN =
  '^\\s*(all|(\\d+|\\d+\\s*-\\s*\\d*|-\\s*\\d+)(\\s*,\\s*(\\d+|\\d+\\s*-\\s*\\d*|-\\s*\\d+))*)\\s*$';

/** One item of a parsed spec. `to === null` means "to the last page". */
export interface PageRange {
  from: number;
  to: number | null;
}

export type ParsedPageSpec = { ok: true; ranges: PageRange[] } | Failure;

function badSpec(message: string, suggestion?: string): Failure {
  return failure(PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC, message, {
    suggestion:
      suggestion ??
      'Use "all", a page number, a range, or a comma-separated mix: "all", "3", "2-5", "4-", "-3", "1-3,7".',
    context: { syntax: 'all | N | A-B | A- | -B, comma separated, 1-based' },
  });
}

/**
 * Parse a spec without knowing how long the document is.
 *
 * Split from resolution deliberately: syntax is the agent's mistake and can be
 * reported before a single LibreOffice process starts, while "page 9 of 3"
 * cannot be known until the PDF exists.
 */
export function parsePageSpec(spec: string): ParsedPageSpec {
  const trimmed = spec.trim();
  if (trimmed === '') return badSpec('Page selection is empty.');
  if (trimmed.toLowerCase() === ALL_PAGES) {
    return { ok: true, ranges: [{ from: 1, to: null }] };
  }

  const ranges: PageRange[] = [];
  for (const rawItem of trimmed.split(',')) {
    const item = rawItem.trim();
    if (item === '') {
      return badSpec(`Empty item in page selection "${spec}".`);
    }

    const single = /^(\d+)$/.exec(item);
    if (single) {
      const page = Number(single[1]);
      if (page < 1) return badSpec('Pages are numbered from 1.');
      ranges.push({ from: page, to: page });
      continue;
    }

    const range = /^(\d*)\s*-\s*(\d*)$/.exec(item);
    if (!range || (range[1] === '' && range[2] === '')) {
      return badSpec(`Unrecognized item "${item}" in page selection.`);
    }
    const from = range[1] === '' ? 1 : Number(range[1]);
    const to = range[2] === '' ? null : Number(range[2]);
    if (from < 1 || (to !== null && to < 1)) {
      return badSpec('Pages are numbered from 1.');
    }
    if (to !== null && to < from) {
      return badSpec(
        `Range "${item}" runs backwards; write it as "${to}-${from}".`
      );
    }
    ranges.push({ from, to });
  }

  return { ok: true, ranges };
}

export type ResolvedPages =
  | { ok: true; pages: number[]; diagnostics: Diagnostic[] }
  | Failure;

/**
 * Turn parsed ranges into concrete page numbers against a real page count.
 *
 * Open ends clamp silently — `"4-"` means "the rest", and the caller cannot
 * know where that is. A closed range that overshoots clamps too, but says so,
 * because `"1-20"` on a 3-page document usually means the agent expected 20
 * pages. A selection that starts past the end is refused outright: there is
 * nothing to render and silently returning zero pages would read as success.
 */
export function resolvePages(
  ranges: readonly PageRange[],
  totalPages: number,
  maxPages: number
): ResolvedPages {
  if (totalPages < 1) {
    return failure(
      PREVIEW_ERROR_CODES.PAGE_COUNT_UNAVAILABLE,
      'The rendered document has no pages.'
    );
  }

  const diagnostics: Diagnostic[] = [];
  const selected = new Set<number>();

  for (const range of ranges) {
    if (range.from > totalPages) {
      return failure(
        PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC,
        `Page ${range.from} was requested but the document has ${totalPages} page${
          totalPages === 1 ? '' : 's'
        }.`,
        {
          suggestion: `Select within 1-${totalPages}, or pass "all".`,
          context: { totalPages, requestedFrom: range.from },
        }
      );
    }
    const last =
      range.to === null ? totalPages : Math.min(range.to, totalPages);
    if (range.to !== null && range.to > totalPages) {
      diagnostics.push(
        diagnostic(
          PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC,
          `Range ${range.from}-${range.to} was clamped to ${range.from}-${totalPages}: the document has ${totalPages} pages.`,
          { severity: 'info', context: { totalPages } }
        )
      );
    }
    for (let page = range.from; page <= last; page += 1) selected.add(page);
  }

  const pages = [...selected].sort((a, b) => a - b);
  if (pages.length > maxPages) {
    return failure(
      PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC,
      `${pages.length} pages were selected; jto_preview renders at most ${maxPages} per call.`,
      {
        suggestion: `Narrow the selection, e.g. "1-${maxPages}", and call again for the rest.`,
        context: { selected: pages.length, maxPages, totalPages },
      }
    );
  }

  return { ok: true, pages, diagnostics };
}

/**
 * Canonical spelling of a spec that has not met a page count yet.
 *
 * Sorted, with overlapping and adjacent ranges merged, so `"1,2,3"`, `"3,2,1"`
 * and `"1-3"` all come out `"1-3"` — which is what lets the cache key treat
 * three spellings of one request as one request. An open end swallows
 * everything after it, because it already covers every page there could be.
 */
export function canonicalRangeSpec(ranges: readonly PageRange[]): string {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: PageRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...range });
      continue;
    }
    if (last.to === null) break; // Open-ended: nothing after it adds anything.
    if (range.from > last.to + 1) {
      merged.push({ ...range });
      continue;
    }
    last.to = range.to === null ? null : Math.max(last.to, range.to);
  }

  return merged
    .map((range) =>
      range.to === null
        ? `${range.from}-`
        : range.to === range.from
          ? `${range.from}`
          : `${range.from}-${range.to}`
    )
    .join(',');
}

/**
 * Canonical spelling of a resolved selection: `[1,2,3,7]` → `"1-3,7"`.
 *
 * This is what joins the cache key, so every spelling of one selection lands
 * on one entry.
 */
export function formatPageSelection(pages: readonly number[]): string {
  if (pages.length === 0) return '';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  const flush = () => {
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  };

  for (const page of sorted.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    flush();
    start = page;
    previous = page;
  }
  flush();
  return parts.join(',');
}

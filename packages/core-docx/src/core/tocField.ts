/**
 * The `toc` component, resolved into the switches a Word field needs.
 *
 * A table of contents is a field: Word repopulates it on open from the outline
 * and the switches the field carries. Deciding what those switches say — which
 * outline levels, which extra styles, which region, which levels keep their
 * page numbers — is a reading of the authoring props with no renderer in it.
 *
 * The cached entries are the other half. Word refreshes the field, but headless
 * LibreOffice does not, so without them a PDF export shows only the title. What
 * is cached must be exactly what Word would collect, or a reader pressing F9
 * sees the table change under them — the disagreement caching exists to avoid.
 */

import type { ThemeConfig } from '../styles';
import type { TocHeadingEntry } from './collectTocHeadings';
import { headingNumberLabel } from '../utils/numberingConfig';

export interface TocFieldEntry {
  text: string;
  level: number;
}

export interface ResolvedTocField {
  /** `\o` — heading outline levels to include, inclusive. */
  headingRange: { from: number; to: number };
  /** `\t` — extra paragraph styles, by Word display name, with their level. */
  styleLevels: Array<{ styleName: string; level: number }>;
  /** `\b` — restrict to a bookmarked region. */
  bookmarkScope?: string;
  /** `\n` — level ranges whose entries omit a page number. */
  omitPageNumbersForLevels: Array<{ from: number; to: number }>;
  /** What separates an entry's text from its page number. */
  entrySeparator: string;
  entries: TocFieldEntry[];
  /** Things the field cannot express, to be reported by the caller. */
  warnings: string[];
}

/**
 * The Word display name a theme style key registers under: camelCase and
 * kebab/snake separators become spaces (`calloutTitle` → `callout Title`).
 * Mirrors the naming in `themeToDocxAdapter`.
 */
export function toStyleDisplayName(styleId: string): string {
  return styleId
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Validate a `{from, to}` depth range, filling in the defaults. */
function parseDepthRange(
  rawDepth: unknown,
  fieldName: string,
  defaultFrom = 1,
  defaultTo = 3
): { from: number; to: number } {
  if (typeof rawDepth !== 'object' || rawDepth === null) {
    throw new Error(
      `${fieldName} must be a range object with optional "from" and/or "to" fields, received: ${JSON.stringify(rawDepth)}`
    );
  }

  const { from = defaultFrom, to = defaultTo } = rawDepth as {
    from?: number;
    to?: number;
  };

  if (from < 1 || from > 6 || to < 1 || to > 6) {
    throw new Error(
      `${fieldName} range values must be between 1 and 6, received: from=${from}, to=${to}`
    );
  }
  if (from > to) {
    throw new Error(
      `${fieldName} "from" must be less than or equal to "to", received: from=${from}, to=${to}`
    );
  }

  return { from, to };
}

/**
 * The entries this TOC would show, in document order.
 *
 * Mirrors what Word's own refresh does with the switches:
 * - `\o` outline range: heading entries inside [from, to];
 * - `\t` style mappings: paragraphs whose `themeStyle` this TOC maps, at the
 *   mapped level — Word includes those whatever the outline range says, so they
 *   are not depth-filtered here either;
 * - `\b` bookmark: when the TOC is section-scoped, only that section's entries.
 */
function selectEntries(
  collected: readonly TocHeadingEntry[] | undefined,
  options: {
    depthStart: number;
    depthEnd: number;
    bookmarkScope?: string;
    styleLevels: ReadonlyMap<string, number>;
  }
): TocFieldEntry[] {
  if (!collected || collected.length === 0) return [];

  const { depthStart, depthEnd, bookmarkScope, styleLevels } = options;
  const entries: TocFieldEntry[] = [];

  for (const entry of collected) {
    if (bookmarkScope && entry.sectionBookmarkId !== bookmarkScope) continue;

    if (entry.styleId !== undefined) {
      // The entry carries the theme key; the mapping may have named the
      // display name instead.
      const level =
        styleLevels.get(entry.styleId) ??
        styleLevels.get(toStyleDisplayName(entry.styleId));
      if (level === undefined) continue;
      entries.push({ text: entry.title, level });
      continue;
    }

    if (entry.level < depthStart || entry.level > depthEnd) continue;
    // No page number: nothing in generation paginates, and Word fills in real
    // numbers the moment it refreshes. A numbered heading shows its number in
    // that refresh, so the cached copy carries it too — same form, trailing
    // period included, or the entry visibly shifts on the first F9.
    entries.push({
      text: entry.number
        ? `${headingNumberLabel(entry.number)} ${entry.title}`
        : entry.title,
      level: entry.level,
    });
  }

  return entries;
}

export interface TocFieldSource {
  depth?: unknown;
  pageNumbersDepth?: unknown;
  includePageNumbers?: boolean;
  numberingStyle?: string;
  numberSeparator?: boolean;
  scope?: 'auto' | 'document' | 'section';
  styles?: Array<{ styleId: string; level: number }>;
  title?: string;
}

/** Resolve a `toc` component's props into field switches and cached entries. */
export function resolveTocField(
  props: TocFieldSource,
  theme: ThemeConfig,
  context: {
    /** The bookmark of the section this TOC sits in, if any. */
    sectionBookmarkId?: string;
    /** Every heading and mapped-style paragraph in the document, in order. */
    collected?: readonly TocHeadingEntry[];
  }
): ResolvedTocField {
  const warnings: string[] = [];
  const headingRange = parseDepthRange(
    props.depth ?? { to: 3 },
    'TOC depth',
    1,
    3
  );

  const pageNumbers =
    props.pageNumbersDepth !== undefined
      ? parseDepthRange(props.pageNumbersDepth, 'TOC pageNumbersDepth', 1, 3)
      : undefined;

  // `numberingStyle` has no representation in the field: it carries no
  // numbering switch, so entries always inherit the numbering of the heading
  // styles they point at. The prop stays in the schema — documents already set
  // it — but the no-op is announced rather than swallowed.
  if (props.numberingStyle !== undefined) {
    warnings.push(
      `TOC numberingStyle "${props.numberingStyle}" is ignored: Word's ` +
        'table-of-contents field has no numbering switch. TOC entries inherit ' +
        'numbering from the heading styles they reference.'
    );
  }

  const scope = props.scope ?? 'auto';
  const effectiveScope =
    scope === 'auto'
      ? context.sectionBookmarkId
        ? 'section'
        : 'document'
      : scope;
  const bookmarkScope =
    effectiveScope === 'section' ? context.sectionBookmarkId : undefined;

  if (effectiveScope === 'section' && !bookmarkScope) {
    warnings.push(
      'TOC configured for section scope but no section bookmark found. Falling back to document scope.'
    );
  }

  // A mapping may name a style either way — by the theme key an author writes
  // in `themeStyle`, or by the Word display name the `\t` switch needs — and a
  // collected entry always carries the theme key. Indexing both keeps the
  // cached entries in step with what Word collects on refresh.
  const styleLevels = new Map<string, number>();
  const styleSwitches: Array<{ styleName: string; level: number }> = [];
  for (const mapping of props.styles ?? []) {
    const isCustomStyle =
      !!theme.styles &&
      Object.prototype.hasOwnProperty.call(theme.styles, mapping.styleId);
    const displayName = isCustomStyle
      ? toStyleDisplayName(mapping.styleId)
      : mapping.styleId;

    styleLevels.set(mapping.styleId, mapping.level);
    styleLevels.set(displayName, mapping.level);
    styleSwitches.push({ styleName: displayName, level: mapping.level });
  }

  return {
    headingRange,
    styleLevels: styleSwitches,
    ...(bookmarkScope ? { bookmarkScope } : {}),
    omitPageNumbersForLevels: omittedLevels(
      headingRange,
      pageNumbers,
      props.includePageNumbers !== false
    ),
    // A boolean chooses between a tab and a space; a tab is the default.
    entrySeparator: props.numberSeparator === false ? ' ' : '\t',
    entries: selectEntries(context.collected, {
      depthStart: headingRange.from,
      depthEnd: headingRange.to,
      bookmarkScope,
      styleLevels,
    }),
    warnings,
  };
}

/**
 * Which levels lose their page numbers.
 *
 * The `\n` switch names the levels to *omit*, so a stated "show page numbers
 * for 2-3" becomes "omit 1 and 4-6" — the blocks either side of the range that
 * keeps them.
 */
function omittedLevels(
  headingRange: { from: number; to: number },
  pageNumbers: { from: number; to: number } | undefined,
  includePageNumbers: boolean
): Array<{ from: number; to: number }> {
  if (pageNumbers) {
    const omitted: Array<{ from: number; to: number }> = [];
    if (pageNumbers.from > headingRange.from) {
      omitted.push({ from: headingRange.from, to: pageNumbers.from - 1 });
    }
    if (pageNumbers.to < headingRange.to) {
      omitted.push({ from: pageNumbers.to + 1, to: headingRange.to });
    }
    return omitted;
  }
  return includePageNumbers ? [] : [headingRange];
}

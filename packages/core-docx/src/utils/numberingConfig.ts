/**
 * How a list numbers itself.
 *
 * The level shapes an author can state, plus the two constants a numbered
 * heading needs. Turning any of it into OOXML is the compiler's and the
 * adapter's job — this module builds nothing, so both the outline pre-pass and
 * the compiler can read the same declarations without either pulling in a
 * renderer.
 */

/**
 * Styling for the marker glyph itself (`w:lvl/w:rPr`), independent of the list
 * text. `color` must already be resolved to a 6-char hex without '#'.
 */
export interface ListMarkerFontConfig {
  family?: string;
  /** Points. */
  size?: number;
  /** Resolved hex, no leading '#'. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ListLevelConfig {
  level: number;
  format?: string;
  text?: string;
  alignment?: string;
  indent?: {
    left?: number;
    hanging?: number;
  };
  start?: number;
  font?: ListMarkerFontConfig;
}

/**
 * The one multilevel definition every numbered heading in a document shares —
 * shared so that 1., 1.1., 1.1.1. is a single continuous sequence rather than
 * one restarting per heading.
 */
export const HEADING_NUMBERING_REFERENCE = 'jto-heading-numbering';

/**
 * The heading number as Word draws it in the document — the bare dotted number
 * plus the trailing period `lvlText` ends with.
 *
 * A cached TOC entry has to reproduce that form exactly: Word rewrites the
 * entry from the heading's own rendered text the first time it refreshes the
 * field, and an entry cached as "1.1 Methods" would visibly shift to
 * "1.1. Methods". Cross-references keep the bare number instead — Word's `\w`
 * switch is defined as the paragraph number *without* trailing periods.
 */
export function headingNumberLabel(number: string): string {
  return `${number}.`;
}

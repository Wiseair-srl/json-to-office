/**
 * The measure: the width a component is set against.
 *
 * A width a document states as a percentage is a percentage of the text area
 * the component stands in, and that area depends on where it stands: the
 * section's text column in the body, the whole text width in a header or
 * footer, and a cell's content width inside a table — which is also what a
 * text box and a nested `columns` compile to. Each container hands its
 * children that width as `measureTwips` on their scope, so a table sizes its
 * columns, a nested `columns` its cells and gaps, and an image, visual, chart,
 * shape or divider its width against the box that actually holds it rather
 * than against the page. Heights and anchored positions stay page-relative:
 * no container states a height, and OOXML anchors a floating object to the
 * page or its margins whatever holds the anchor.
 *
 * Tables are why it matters. A table in a text box padded 72pt a side, sized
 * against the page, came out two inches wider than the box, and a `w:tblGrid`
 * is a measurement: Google Docs, Apple Pages and QuickLook take each
 * `w:gridCol` as the physical column width (dolanmiu/docx#3476), so a grid has
 * to be right in twips, not just in proportion.
 */

import type {
  DocxIrCellMargins,
  DocxIrPageSetup,
  DocxIrSectionProperties,
  DocxIrTableWidth,
} from './types';

/** Word's gap between equal columns when a section states none: half an inch. */
const DEFAULT_COLUMN_SPACE_TWIPS = 720;

/** The page less its side margins and gutter: the measure page chrome sets to. */
export function textWidthTwips(page: DocxIrPageSetup): number {
  const { leftTwips, rightTwips, gutterTwips = 0 } = page.margins;
  return Math.max(0, page.widthTwips - leftTwips - rightTwips - gutterTwips);
}

/**
 * The measure of the section's body: one column of it.
 *
 * Equal columns share the text width once the gaps between them are taken
 * out. Stated widths can differ, and which column a component flows into is
 * only known once the page is laid out, so the narrowest stands for all of
 * them: whatever is sized to it fits wherever it lands.
 */
export function sectionMeasureTwips(
  properties: DocxIrSectionProperties
): number {
  const textWidth = textWidthTwips(properties.page);
  const columns = properties.columns;
  if (!columns || columns.count <= 1) return textWidth;
  if (columns.equalWidth !== true && columns.widths?.length) {
    return Math.min(...columns.widths.map((column) => column.widthTwips));
  }
  const space = columns.spaceTwips ?? DEFAULT_COLUMN_SPACE_TWIPS;
  return Math.max(0, (textWidth - space * (columns.count - 1)) / columns.count);
}

/**
 * The measure inside a cell: its width less its side margins.
 *
 * That is what LibreOffice sets a percentage table in a cell against — a
 * full-width table in a text box padded 72pt a side spans exactly the box
 * less 144pt — and what is left for anything else the cell holds.
 */
export function cellMeasureTwips(
  widthTwips: number,
  margins: DocxIrCellMargins | undefined
): number {
  return Math.max(
    0,
    widthTwips - (margins?.leftTwips ?? 0) - (margins?.rightTwips ?? 0)
  );
}

/** A table's own width in twips; a percentage is of the measure it stands in. */
export function tableWidthTwips(
  width: DocxIrTableWidth,
  measureTwips: number
): number {
  if (width.kind === 'twips') return width.value;
  if (width.kind === 'percent') return (measureTwips * width.value) / 100;
  // A table that states no width takes the measure, as Word inserts one.
  return measureTwips;
}

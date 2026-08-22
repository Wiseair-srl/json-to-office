/**
 * PptxIR tables → PptxGenJS.
 *
 * Two things live here that are properties of *this backend* rather than of a
 * table:
 *
 * 1. **Units.** PptxGenJS's table path uses a different inch/EMU threshold from
 *    the rest of its API (20 instead of 100) and does not run x/y/h through its
 *    normal parser. Passing EMU directly sidesteps both: any real value is
 *    above the threshold, so PptxGenJS uses it verbatim.
 * 2. **Rounded corners.** OOXML tables have no corner radius, and PptxGenJS
 *    exposes none. The IR asks for one semantically; this module realises it by
 *    drawing rounded rectangles behind the table and making the corner cells
 *    transparent so they show through. That technique is not in the IR.
 */

import type PptxGenJS from 'pptxgenjs';
import type {
  PptxIrTableBorder,
  PptxIrTableCell,
  PptxIrTableElement,
  PptxIrTableFormatting,
} from '../../ir/types';
import { emuToInches } from '../../ir/units';

type Opts = Record<string, unknown>;

const NO_BORDER = { type: 'none', pt: 0 } as const;
const NO_LINE = { type: 'none' } as const;

export function emitTable(
  slide: PptxGenJS.Slide,
  element: PptxIrTableElement,
  pptx: PptxGenJS
): void {
  const rounded = roundedCornerPlan(element);
  if (rounded) emitRoundedBackground(slide, element, rounded, pptx);

  const rows = element.rows.map((row, rowIndex) =>
    row.cells.map((cell, colIndex) =>
      emitCell(cell, {
        element,
        rounded,
        rowIndex,
        colIndex,
        columnCount: row.cells.length,
      })
    )
  );

  slide.addTable(rows as never, tableOpts(element, rounded) as never);
}

/* ------------------------------------------------------------------ *
 * Table-level options
 * ------------------------------------------------------------------ */

function tableOpts(
  element: PptxIrTableElement,
  rounded: RoundedPlan | undefined
): Opts {
  const opts: Opts = {
    // EMU passes through PptxGenJS's table path untouched — see the note above.
    x: element.transform.xEmu,
    y: element.transform.yEmu,
  };
  if (!element.transform.autoWidth) opts.w = element.transform.widthEmu;
  if (!element.transform.autoHeight) opts.h = element.transform.heightEmu;

  if (element.columnWidthsEmu.length > 0) {
    opts.colW = toInchList(element.columnWidthsEmu);
  }
  if (element.rowHeightsEmu.length > 0) {
    opts.rowH = toInchList(element.rowHeightsEmu);
  }

  // A rounded table draws its own outline through the background shapes, so
  // the table-level border is suppressed and the per-cell borders take over.
  if (element.border && !rounded) {
    opts.border = borderOpts(element.border);
  }
  if (element.fill) opts.fill = { color: element.fill.hex };

  Object.assign(opts, defaultsOpts(element.defaults));

  if (element.autoPage) opts.autoPage = true;
  if (element.autoPageRepeatHeader) {
    opts.autoPageRepeatHeader = true;
    opts.autoPageHeaderRows = 1;
  }

  if (rounded) {
    opts.w = rounded.widthEmu;
    opts.border = [
      NO_BORDER_TYPE,
      NO_BORDER_TYPE,
      NO_BORDER_TYPE,
      NO_BORDER_TYPE,
    ];
  }

  return opts;
}

const NO_BORDER_TYPE = { type: 'none' } as const;

function defaultsOpts(defaults: PptxIrTableFormatting): Opts {
  const opts: Opts = {
    fontSize: defaults.fontSize,
    fontFace: defaults.fontFamily,
    valign: defaults.verticalAlign,
  };
  if (defaults.bold !== undefined) opts.bold = defaults.bold;
  if (defaults.color) opts.color = defaults.color.hex;
  if (defaults.align) opts.align = defaults.align;
  if (defaults.insetPoints !== undefined) opts.margin = defaults.insetPoints;
  return opts;
}

function borderOpts(border: PptxIrTableBorder): Opts {
  const opts: Opts = { type: border.type };
  if (border.widthPoints !== undefined) opts.pt = border.widthPoints;
  if (border.color) opts.color = border.color.hex;
  return opts;
}

function toInchList(values: readonly number[]): number | number[] {
  const inches = values.map(emuToInches);
  return inches.length === 1 ? inches[0] : inches;
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

interface CellScope {
  element: PptxIrTableElement;
  rounded: RoundedPlan | undefined;
  rowIndex: number;
  colIndex: number;
  columnCount: number;
}

function emitCell(cell: PptxIrTableCell, scope: CellScope): Opts {
  const opts: Opts = {};
  const formatting = cell.formatting;

  if (formatting?.color) opts.color = formatting.color.hex;
  if (formatting?.fontSize !== undefined) opts.fontSize = formatting.fontSize;
  if (formatting?.fontFamily) opts.fontFace = formatting.fontFamily;
  if (formatting?.bold !== undefined) opts.bold = formatting.bold;
  if (formatting?.italic) opts.italic = true;
  if (formatting?.align) opts.align = formatting.align;
  if (formatting?.verticalAlign) opts.valign = formatting.verticalAlign;
  if (formatting?.insetPoints !== undefined) {
    opts.margin = formatting.insetPoints;
  }
  if (cell.colSpan !== undefined) opts.colspan = cell.colSpan;
  if (cell.rowSpan !== undefined) opts.rowspan = cell.rowSpan;

  if (scope.rounded) {
    applyRoundedCellStyling(opts, cell, scope, scope.rounded);
  } else if (cell.fill) {
    opts.fill = { color: cell.fill.hex };
  }

  return Object.keys(opts).length > 0
    ? { text: cell.text, options: opts }
    : { text: cell.text };
}

/* ------------------------------------------------------------------ *
 * Rounded corners
 * ------------------------------------------------------------------ */

interface RoundedPlan {
  radiusInches: number;
  bodyFill: string;
  headerFill: string;
  widthEmu: number;
  innerBorder: Opts;
}

/**
 * Work out whether a rounded table can be drawn, and with which colours.
 *
 * Needs at least a header row and a body row, and an absolute position: the
 * background shapes are placed at the table's own coordinates.
 */
function roundedCornerPlan(
  element: PptxIrTableElement
): RoundedPlan | undefined {
  if (element.cornerRadiusInches === undefined) return undefined;
  if (element.rows.length < 2) return undefined;

  const lastRow = element.rows[element.rows.length - 1];
  const bodyFill =
    element.fill?.hex ?? lastRow?.cells[0]?.fill?.hex ?? 'FFFFFF';
  const headerFill = element.rows[0]?.cells[0]?.fill?.hex ?? bodyFill;

  return {
    radiusInches: element.cornerRadiusInches,
    bodyFill,
    headerFill,
    widthEmu: roundedWidthEmu(element),
    innerBorder: element.border ? borderOpts(element.border) : { ...NO_BORDER },
  };
}

/**
 * Width the background shapes and the table must share.
 *
 * Derived from the column widths when they exist so the shapes line up with
 * the table exactly; otherwise the table's own width.
 */
function roundedWidthEmu(element: PptxIrTableElement): number {
  const columns = element.columnWidthsEmu;
  if (columns.length > 1) {
    return columns.reduce((sum, width) => sum + width, 0);
  }
  if (columns.length === 1) {
    return columns[0] * (element.rows[0]?.cells.length ?? 1);
  }
  return element.transform.autoWidth
    ? Math.round(5 * 914400)
    : element.transform.widthEmu;
}

/**
 * Corner cells go transparent so the rounded shapes behind show through;
 * every other cell stays opaque so no seam appears between them.
 */
function applyRoundedCellStyling(
  opts: Opts,
  cell: PptxIrTableCell,
  scope: CellScope,
  rounded: RoundedPlan
): void {
  const isHeader = scope.rowIndex === 0;
  const isLastRow = scope.rowIndex === scope.element.rows.length - 1;
  const isCorner =
    (isHeader || isLastRow) &&
    (scope.colIndex === 0 || scope.colIndex === scope.columnCount - 1);

  if (!isCorner) {
    opts.fill = {
      color:
        cell.fill?.hex ?? (isHeader ? rounded.headerFill : rounded.bodyFill),
    };
  }
  opts.border = roundedCellBorders(scope, rounded);
}

/**
 * Per-cell borders for a rounded table: no outer edges (the shapes draw them)
 * and no seam between the header row and the body.
 */
function roundedCellBorders(scope: CellScope, rounded: RoundedPlan): Opts[] {
  const { rowIndex, colIndex, columnCount, element } = scope;
  const isTop = rowIndex === 0;
  const isBottom = rowIndex === element.rows.length - 1;
  const isLeft = colIndex === 0;
  const isRight = colIndex === columnCount - 1;
  const inner = rounded.innerBorder;
  const none: Opts = { ...NO_BORDER };

  return [
    isTop || rowIndex === 1 ? none : inner,
    isRight ? none : inner,
    isBottom || rowIndex === 0 ? none : inner,
    isLeft ? none : inner,
  ];
}

/**
 * Draw the rounded background: a rounded header block with a flat patch over
 * its lower corners, and a rounded body block with a flat patch over its upper
 * corners, so only the outer four corners stay round.
 */
function emitRoundedBackground(
  slide: PptxGenJS.Slide,
  element: PptxIrTableElement,
  rounded: RoundedPlan,
  pptx: PptxGenJS
): void {
  const xInches = emuToInches(element.transform.xEmu);
  const yInches = emuToInches(element.transform.yEmu);
  const widthInches = emuToInches(rounded.widthEmu);

  const rowHeights = element.rowHeightsEmu;
  const headerInches =
    rowHeights.length > 0 ? emuToInches(rowHeights[0]) : 0.45;
  const totalInches =
    rowHeights.length > 1
      ? emuToInches(rowHeights.reduce((sum, h) => sum + h, 0))
      : rowHeights.length === 1
        ? emuToInches(rowHeights[0]) * element.rows.length
        : element.transform.autoHeight
          ? 2
          : emuToInches(element.transform.heightEmu);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: xInches,
    y: yInches,
    w: widthInches,
    h: headerInches,
    fill: { color: rounded.headerFill },
    rectRadius: rounded.radiusInches,
    line: { ...NO_LINE },
  } as never);
  slide.addShape(pptx.ShapeType.rect, {
    x: xInches,
    y: yInches + headerInches - rounded.radiusInches,
    w: widthInches,
    h: rounded.radiusInches,
    fill: { color: rounded.headerFill },
    line: { ...NO_LINE },
  } as never);

  const bodyY = yInches + headerInches;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: xInches,
    y: bodyY,
    w: widthInches,
    h: totalInches - headerInches,
    fill: { color: rounded.bodyFill },
    rectRadius: rounded.radiusInches,
    line: { ...NO_LINE },
  } as never);
  slide.addShape(pptx.ShapeType.rect, {
    x: xInches,
    y: bodyY,
    w: widthInches,
    h: rounded.radiusInches,
    fill: { color: rounded.bodyFill },
    line: { ...NO_LINE },
  } as never);
}

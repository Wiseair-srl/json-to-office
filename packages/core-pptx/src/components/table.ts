/**
 * Table Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig } from '../types';
import { resolveColor } from '../utils/color';

/**
 * Characters that PowerPoint may render as color emoji.
 * Appending VS15 (U+FE0E) forces text-mode rendering.
 */
const EMOJI_PRONE_CHARS = /[✓✔✗✘☐☑☒★☆●○■□▶◀▲▼⚡⚠❌❓❗]/gu;

function applyTextVariationSelector(text: string): string {
  return text.replace(EMOJI_PRONE_CHARS, (ch) => ch + '\uFE0E');
}

interface TableCell {
  text: string;
  color?: string;
  fill?: string;
  fontSize?: number;
  fontFace?: string;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  valign?: string;
  colspan?: number;
  rowspan?: number;
  margin?: number | number[];
}

interface TableComponentProps {
  rows: (string | TableCell)[][];
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  colW?: number | number[];
  rowH?: number | number[];
  border?: { type?: string; pt?: number; color?: string };
  fill?: string;
  fontSize?: number;
  fontFace?: string;
  color?: string;
  align?: string;
  valign?: string;
  autoPage?: boolean;
  autoPageRepeatHeader?: boolean;
  margin?: number | number[];
  borderRadius?: number;
}

export function renderTableComponent(
  slide: PptxGenJS.Slide,
  props: TableComponentProps,
  theme: PptxThemeConfig,
  pptx?: PptxGenJS
): void {
  // Pre-compute fills and width for borderRadius feature
  let bgFill: string | undefined;
  let headerFill: string | undefined;
  let borderRadiusTableW: number | undefined;
  if (props.borderRadius && pptx && props.rows.length >= 2) {
    const lastRow = props.rows[props.rows.length - 1];
    const lastCell = lastRow?.[0];
    bgFill = props.fill
      ? resolveColor(props.fill, theme)
      : (typeof lastCell === 'object' && lastCell.fill)
        ? resolveColor(lastCell.fill, theme)
        : 'FFFFFF';
    const firstCell = props.rows[0]?.[0];
    headerFill = (typeof firstCell === 'object' && firstCell.fill)
      ? resolveColor(firstCell.fill, theme)
      : bgFill;
    // Derive width from colW (actual cell widths) so shapes match the table exactly
    borderRadiusTableW = Array.isArray(props.colW)
      ? props.colW.reduce((sum, w) => sum + w, 0)
      : typeof props.colW === 'number'
        ? props.colW * (props.rows[0]?.length ?? 1) // assumes uniform column count
        : typeof props.w === 'number' ? props.w : 5;
  }

  // Pre-compute inner border for per-cell border assignment
  const innerBorder = props.border
    ? {
      type: props.border.type ?? 'solid',
      pt: props.border.pt ?? 1,
      color: resolveColor(props.border.color ?? '000000', theme),
    }
    : undefined;

  // Helper: build per-cell border array when borderRadius is active
  const buildBorderRadiusBorders = (rowIndex: number, colIndex: number, colCount: number) => {
    const isTop = rowIndex === 0;
    const isBottom = rowIndex === props.rows.length - 1;
    const isLeft = colIndex === 0;
    const isRight = colIndex === colCount - 1;
    const zeroBorder = { type: 'none', pt: 0 };
    const hInner = innerBorder ?? zeroBorder;
    return [
      (isTop || rowIndex === 1) ? zeroBorder : hInner,   // top: outer + header-body seam
      isRight ? zeroBorder : hInner,                       // right
      (isBottom || rowIndex === 0) ? zeroBorder : hInner,  // bottom: outer + header-body seam
      isLeft ? zeroBorder : hInner,                        // left
    ];
  };

  // Convert rows to pptxgenjs format
  const lastRowIdx = props.rows.length - 1;
  const tableRows = props.rows.map((row, rowIndex) =>
    row.map((cell, colIndex) => {
      const lastColIdx = row.length - 1;
      // Corner cells: first/last col of header or last row — transparent
      // so background roundRect shapes show rounded corners through them.
      // All other cells: opaque fill to prevent seam artifacts.
      const isCorner = bgFill &&
        (rowIndex === 0 || rowIndex === lastRowIdx) &&
        (colIndex === 0 || colIndex === lastColIdx);

      if (typeof cell === 'string') {
        if (!bgFill) return { text: applyTextVariationSelector(cell) };
        const isHeader = rowIndex === 0;
        const opts: Record<string, unknown> = {
          border: buildBorderRadiusBorders(rowIndex, colIndex, row.length),
        };
        if (!isCorner) opts.fill = { color: isHeader ? headerFill : bgFill };
        return { text: applyTextVariationSelector(cell), options: opts };
      }
      const cellOpts: Record<string, unknown> = {};
      if (cell.color) cellOpts.color = resolveColor(cell.color, theme);
      if (bgFill) {
        const isHeader = rowIndex === 0;
        if (!isCorner) {
          const resolvedFill = cell.fill ? resolveColor(cell.fill, theme) : (isHeader ? headerFill : bgFill);
          cellOpts.fill = { color: resolvedFill };
        }
        cellOpts.border = buildBorderRadiusBorders(rowIndex, colIndex, row.length);
      } else if (cell.fill) {
        cellOpts.fill = { color: resolveColor(cell.fill, theme) };
      }
      if (cell.fontSize) cellOpts.fontSize = cell.fontSize;
      if (cell.fontFace) cellOpts.fontFace = cell.fontFace;
      if (cell.bold) cellOpts.bold = true;
      if (cell.italic) cellOpts.italic = true;
      if (cell.align) cellOpts.align = cell.align;
      if (cell.valign) cellOpts.valign = cell.valign;
      if (cell.colspan) cellOpts.colspan = cell.colspan;
      if (cell.rowspan) cellOpts.rowspan = cell.rowspan;
      if (cell.margin !== undefined) cellOpts.margin = cell.margin;

      return { text: applyTextVariationSelector(cell.text), options: cellOpts };
    })
  );

  const opts: Record<string, unknown> = {};

  // Position
  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  // Column/row sizing
  if (props.colW !== undefined) opts.colW = props.colW;
  if (props.rowH !== undefined) opts.rowH = props.rowH;

  // Border — skip table-level border when borderRadius is active (per-cell borders handle it)
  if (props.border && !bgFill) {
    opts.border = {
      type: props.border.type ?? 'solid',
      pt: props.border.pt ?? 1,
      color: resolveColor(props.border.color ?? '000000', theme),
    };
  }

  // Fill
  if (props.fill) opts.fill = { color: resolveColor(props.fill, theme) };

  // Font defaults
  opts.fontSize = props.fontSize ?? theme.defaults.fontSize;
  opts.fontFace = props.fontFace ?? theme.fonts.body;
  if (props.color) opts.color = resolveColor(props.color, theme);

  // Alignment
  if (props.align) opts.align = props.align;
  opts.valign = props.valign ?? 'middle';

  // Auto-paging
  if (props.autoPage) opts.autoPage = true;
  if (props.autoPageRepeatHeader) {
    opts.autoPageRepeatHeader = true;
    opts.autoPageHeaderRows = 1;
  }

  // Margin
  if (props.margin !== undefined) opts.margin = props.margin;

  // Background roundRect shapes — placed BEFORE the table.
  // Corner cells are transparent so these shapes show through at the corners.
  // Non-corner cells are opaque to prevent seam artifacts.
  if (props.borderRadius && pptx && typeof props.x === 'number' && typeof props.y === 'number') {
    let tableH: number = (props.h as number) ?? 2;
    if (typeof props.rowH === 'number') {
      tableH = props.rowH * props.rows.length;
    } else if (Array.isArray(props.rowH)) {
      tableH = props.rowH.reduce((sum, h) => sum + h, 0);
    }
    const headerH = typeof props.rowH === 'number'
      ? props.rowH
      : Array.isArray(props.rowH)
        ? props.rowH[0]
        : 0.45;
    const tableW = borderRadiusTableW!;
    // Suppress shape outlines completely
    const noLine = { type: 'none' };

    // Header roundRect (rounded top corners)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: props.x, y: props.y, w: tableW, h: headerH,
      fill: { color: headerFill }, rectRadius: props.borderRadius, line: noLine,
    } as any);
    // Header flat rect — covers the rounded bottom corners of header
    slide.addShape(pptx.ShapeType.rect, {
      x: props.x,
      y: (props.y as number) + headerH - props.borderRadius,
      w: tableW, h: props.borderRadius,
      fill: { color: headerFill }, line: noLine,
    } as any);

    // Body roundRect (rounded bottom corners)
    const bodyY = (props.y as number) + headerH;
    const bodyH = tableH - headerH;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: props.x, y: bodyY, w: tableW, h: bodyH,
      fill: { color: bgFill }, rectRadius: props.borderRadius, line: noLine,
    } as any);
    // Body flat rect — covers the rounded top corners of body
    slide.addShape(pptx.ShapeType.rect, {
      x: props.x, y: bodyY, w: tableW, h: props.borderRadius,
      fill: { color: bgFill }, line: noLine,
    } as any);
  }

  // When borderRadius is active, override opts.w to match colW sum
  // and suppress any table-level border/outline
  if (bgFill && borderRadiusTableW !== undefined) {
    opts.w = borderRadiusTableW;
    opts.border = [{ type: 'none' }, { type: 'none' }, { type: 'none' }, { type: 'none' }];
  }

  slide.addTable(tableRows as any, opts as any);
}

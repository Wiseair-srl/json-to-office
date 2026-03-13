/**
 * Table Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig } from '../types';
import { resolveColor } from '../utils/color';

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
}

export function renderTableComponent(
  slide: PptxGenJS.Slide,
  props: TableComponentProps,
  theme: PptxThemeConfig
): void {
  // Convert rows to pptxgenjs format
  const tableRows = props.rows.map((row) =>
    row.map((cell) => {
      if (typeof cell === 'string') {
        return { text: cell };
      }
      const cellOpts: Record<string, unknown> = {};
      if (cell.color) cellOpts.color = resolveColor(cell.color, theme);
      if (cell.fill) cellOpts.fill = { color: resolveColor(cell.fill, theme) };
      if (cell.fontSize) cellOpts.fontSize = cell.fontSize;
      if (cell.fontFace) cellOpts.fontFace = cell.fontFace;
      if (cell.bold) cellOpts.bold = true;
      if (cell.italic) cellOpts.italic = true;
      if (cell.align) cellOpts.align = cell.align;
      if (cell.valign) cellOpts.valign = cell.valign;
      if (cell.colspan) cellOpts.colspan = cell.colspan;
      if (cell.rowspan) cellOpts.rowspan = cell.rowspan;
      if (cell.margin !== undefined) cellOpts.margin = cell.margin;

      return { text: cell.text, options: cellOpts };
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

  // Border
  if (props.border) {
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
  if (props.valign) opts.valign = props.valign;

  // Auto-paging
  if (props.autoPage) opts.autoPage = true;
  if (props.autoPageRepeatHeader) {
    opts.autoPageRepeatHeader = true;
    opts.autoPageHeaderRows = 1;
  }

  // Margin
  if (props.margin !== undefined) opts.margin = props.margin;

  slide.addTable(tableRows as any, opts as any);
}

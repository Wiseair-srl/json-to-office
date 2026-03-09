/**
 * Grid Layout Resolution
 * Converts grid coordinates to absolute x/y/w/h positions
 */

import type { GridConfig, GridPosition, PptxComponentInput } from '../types';

export const DEFAULT_GRID_CONFIG: Required<{
  columns: number;
  rows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  gutter: { column: number; row: number };
}> = {
  columns: 12,
  rows: 6,
  margin: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
  gutter: { column: 0.2, row: 0.2 },
};

function resolveMargin(margin: GridConfig['margin']) {
  if (margin == null) return DEFAULT_GRID_CONFIG.margin;
  if (typeof margin === 'number') return { top: margin, right: margin, bottom: margin, left: margin };
  return margin;
}

function resolveGutter(gutter: GridConfig['gutter']) {
  if (gutter == null) return DEFAULT_GRID_CONFIG.gutter;
  if (typeof gutter === 'number') return { column: gutter, row: gutter };
  return gutter;
}

export function resolveGridPosition(
  gridPos: GridPosition,
  gridConfig: GridConfig | undefined,
  slideWidth: number,
  slideHeight: number
): { x: number; y: number; w: number; h: number } {
  const cols = gridConfig?.columns ?? DEFAULT_GRID_CONFIG.columns;
  const rows = gridConfig?.rows ?? DEFAULT_GRID_CONFIG.rows;
  const margin = resolveMargin(gridConfig?.margin);
  const gutter = resolveGutter(gridConfig?.gutter);

  const col = Math.max(0, Math.min(gridPos.column, cols - 1));
  const row = Math.max(0, Math.min(gridPos.row, rows - 1));
  const colSpan = Math.max(1, Math.min(gridPos.columnSpan ?? 1, cols - col));
  const rowSpan = Math.max(1, Math.min(gridPos.rowSpan ?? 1, rows - row));

  if (gridPos.column !== col || gridPos.row !== row) {
    console.warn(
      `Grid position clamped: column ${gridPos.column}→${col}, row ${gridPos.row}→${row} (grid: ${cols}×${rows})`
    );
  }

  const availableW = slideWidth - margin.left - margin.right;
  const availableH = slideHeight - margin.top - margin.bottom;
  const trackW = (availableW - (cols - 1) * gutter.column) / cols;
  const trackH = (availableH - (rows - 1) * gutter.row) / rows;

  const x = margin.left + col * (trackW + gutter.column);
  const y = margin.top + row * (trackH + gutter.row);
  const w = colSpan * trackW + (colSpan - 1) * gutter.column;
  const h = rowSpan * trackH + (rowSpan - 1) * gutter.row;

  return { x, y, w, h };
}

export function resolveComponentGridPosition(
  component: PptxComponentInput,
  gridConfig: GridConfig | undefined,
  slideWidth: number,
  slideHeight: number
): PptxComponentInput {
  const gridPos = component.props.grid as GridPosition | undefined;
  if (!gridPos) return component;

  const resolved = resolveGridPosition(gridPos, gridConfig, slideWidth, slideHeight);

  const { grid: _grid, ...restProps } = component.props; // eslint-disable-line no-unused-vars, @typescript-eslint/no-unused-vars
  const newProps = { ...restProps };

  // Grid sets x/y/w/h, but explicit values on the element override individually
  if (newProps.x == null) newProps.x = resolved.x;
  if (newProps.y == null) newProps.y = resolved.y;
  if (newProps.w == null) newProps.w = resolved.w;
  if (newProps.h == null) newProps.h = resolved.h;

  return { ...component, props: newProps };
}

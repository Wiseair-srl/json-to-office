/**
 * Grid Layout Resolution
 * Converts grid coordinates to absolute x/y/w/h positions
 */

import type { GridConfig, GridPosition, PptxComponentInput, PipelineWarning } from '../types';
import { warn, W } from '../utils/warn';

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

/**
 * Merge a master-level grid override on top of the presentation grid.
 * Master fields take precedence; nested margin/gutter objects are shallow-merged.
 * Both sides are normalized to object form before merging so that a shorthand
 * base (e.g. margin: 0.5) combined with a partial override (e.g. { top: 1.1 })
 * doesn't lose the other sides.
 */
export function mergeGridConfigs(
  base: GridConfig | undefined,
  override: GridConfig | undefined
): GridConfig | undefined {
  if (!override) return base;
  if (!base) return override;

  const merged: GridConfig = {
    columns: override.columns ?? base.columns,
    rows: override.rows ?? base.rows,
  };

  // Merge margin — normalize both to object form first
  if (override.margin !== undefined) {
    if (typeof override.margin === 'number') {
      merged.margin = override.margin;
    } else {
      merged.margin = { ...resolveMargin(base.margin), ...override.margin };
    }
  } else {
    merged.margin = base.margin;
  }

  // Merge gutter — same normalization
  if (override.gutter !== undefined) {
    if (typeof override.gutter === 'number') {
      merged.gutter = override.gutter;
    } else {
      merged.gutter = { ...resolveGutter(base.gutter), ...override.gutter };
    }
  } else {
    merged.gutter = base.gutter;
  }

  return merged;
}

export function resolveGridPosition(
  gridPos: GridPosition,
  gridConfig: GridConfig | undefined,
  slideWidth: number,
  slideHeight: number,
  warnings?: PipelineWarning[]
): { x: number; y: number; w: number; h: number } {
  const cols = Math.max(1, gridConfig?.columns ?? DEFAULT_GRID_CONFIG.columns);
  const rows = Math.max(1, gridConfig?.rows ?? DEFAULT_GRID_CONFIG.rows);
  const margin = resolveMargin(gridConfig?.margin);
  const gutter = resolveGutter(gridConfig?.gutter);

  const col = Math.max(0, Math.min(gridPos.column, cols - 1));
  const row = Math.max(0, Math.min(gridPos.row, rows - 1));
  const colSpan = Math.max(1, Math.min(gridPos.columnSpan ?? 1, cols - col));
  const rowSpan = Math.max(1, Math.min(gridPos.rowSpan ?? 1, rows - row));

  if (gridPos.column !== col || gridPos.row !== row) {
    warn(warnings, W.GRID_POSITION_CLAMPED,
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
  slideHeight: number,
  warnings?: PipelineWarning[]
): PptxComponentInput {
  const gridPos = component.props.grid as GridPosition | undefined;
  if (!gridPos) return component;

  const resolved = resolveGridPosition(gridPos, gridConfig, slideWidth, slideHeight, warnings);

  const { grid: _grid, ...restProps } = component.props; // eslint-disable-line no-unused-vars, @typescript-eslint/no-unused-vars
  const newProps = { ...restProps };

  // When explicit values use percentage strings, convert grid-resolved inches
  // to percentages too so pptxgenjs receives consistent units per element.
  const hasPercentX = typeof newProps.x === 'string' || typeof newProps.w === 'string';
  const hasPercentY = typeof newProps.y === 'string' || typeof newProps.h === 'string';

  const toPercX = (v: number) => `${+((v / slideWidth) * 100).toFixed(2)}%`;
  const toPercY = (v: number) => `${+((v / slideHeight) * 100).toFixed(2)}%`;

  // Grid sets x/y/w/h, but explicit values on the element override individually
  if (newProps.x == null) newProps.x = hasPercentX ? toPercX(resolved.x) : resolved.x;
  if (newProps.y == null) newProps.y = hasPercentY ? toPercY(resolved.y) : resolved.y;
  if (newProps.w == null) newProps.w = hasPercentX ? toPercX(resolved.w) : resolved.w;
  if (newProps.h == null) newProps.h = hasPercentY ? toPercY(resolved.h) : resolved.h;

  return { ...component, props: newProps };
}

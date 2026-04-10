/**
 * Columns Component
 * Standard component for rendering content in columns layout
 */

import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  VerticalAlign,
  TableLayoutType,
} from 'docx';
import {
  ComponentDefinition,
  RenderContext,
  isColumnsComponent,
  isTextBoxComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { renderComponent } from '../core/render';
import {
  getAvailableWidthTwips,
  relativeLengthToTwips,
} from '../utils/widthUtils';
import { NONE_BORDERS } from '../styles/utils/borderUtils';

/**
 * Render columns component
 */
export async function renderColumnsComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!isColumnsComponent(component)) return [];

  // Check if parent is a text-box component
  if (context.parent && isTextBoxComponent(context.parent)) {
    // Render as table-based columns when inside a text-box
    return await renderColumnsAsTable(component, theme, themeName, context);
  }

  // Standard section-based rendering (existing behavior)
  // Props are pre-resolved by resolveComponentTree
  const elements: (Paragraph | Table)[] = [];

  if (component.children) {
    for (const child of component.children) {
      const childElements = await renderComponent(
        child,
        theme,
        themeName,
        context
      );
      elements.push(...childElements);
    }
  }

  return elements;
}

/**
 * Render columns as a multi-column table (for use inside text-boxes)
 */
async function renderColumnsAsTable(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: RenderContext
): Promise<Table[]> {
  const cfg = (component as any).props || {};
  const columns = cfg.columns || [];

  // Normalize columns configuration
  let columnConfigs: Array<{ width?: number | string; gap?: number | string }> =
    [];
  if (typeof columns === 'number') {
    // Equal-width columns
    columnConfigs = Array(columns).fill({ width: 'auto' });
  } else if (Array.isArray(columns)) {
    columnConfigs = columns;
  } else {
    // Invalid config, return empty
    return [];
  }

  const columnCount = columnConfigs.length;
  if (columnCount === 0) return [];

  // Calculate column widths
  const availableWidthTwips = getAvailableWidthTwips(theme, themeName);
  const columnWidths: number[] = [];
  const columnGaps: number[] = [];
  let totalDefinedWidth = 0;
  let totalGaps = 0;
  const autoWidthIndexes: number[] = [];

  for (let i = 0; i < columnCount; i++) {
    const col = columnConfigs[i];

    // Calculate width
    if (col.width === undefined || col.width === 'auto') {
      autoWidthIndexes.push(i);
      columnWidths.push(0); // Placeholder
    } else {
      const widthTwips = relativeLengthToTwips(col.width, availableWidthTwips);
      columnWidths.push(widthTwips);
      totalDefinedWidth += widthTwips;
    }

    // Calculate gap (space after this column)
    if (i < columnCount - 1) {
      const gapTwips =
        col.gap !== undefined
          ? relativeLengthToTwips(col.gap, availableWidthTwips)
          : cfg.gap !== undefined
            ? relativeLengthToTwips(cfg.gap, availableWidthTwips)
            : 720; // Default: 0.5 inch
      columnGaps.push(gapTwips);
      totalGaps += gapTwips;
    } else {
      columnGaps.push(0); // No gap after last column
    }
  }

  // Distribute remaining width among auto-width columns
  const remainingWidth = Math.max(
    0,
    availableWidthTwips - totalDefinedWidth - totalGaps
  );
  if (autoWidthIndexes.length > 0) {
    const autoColumnWidth = Math.floor(
      remainingWidth / autoWidthIndexes.length
    );
    for (const idx of autoWidthIndexes) {
      columnWidths[idx] = autoColumnWidth;
    }
  }

  // Distribute child components across columns
  const childComponents = (component as any).children || [];
  const columnContents: ComponentDefinition[][] = Array(columnCount)
    .fill(null)
    .map(() => []);

  // Simple distribution: round-robin
  for (let i = 0; i < childComponents.length; i++) {
    const colIndex = i % columnCount;
    columnContents[colIndex].push(childComponents[i]);
  }

  // Render each column's content
  const cells: TableCell[] = [];
  for (let i = 0; i < columnCount; i++) {
    const columnElements: (Paragraph | Table)[] = [];

    for (const child of columnContents[i]) {
      const rendered = await renderComponent(child, theme, themeName, context);
      columnElements.push(...rendered);
    }

    // If column is empty, add empty paragraph
    if (columnElements.length === 0) {
      columnElements.push(new Paragraph({}));
    }

    cells.push(
      new TableCell({
        children: columnElements,
        width: { size: columnWidths[i], type: WidthType.DXA },
        margins: {
          top: 0,
          right: columnGaps[i] / 2,
          bottom: 0,
          left: i > 0 ? columnGaps[i - 1] / 2 : 0,
        },
        verticalAlign: VerticalAlign.TOP,
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: '000000' },
          right: { style: BorderStyle.NONE, size: 0, color: '000000' },
          bottom: { style: BorderStyle.NONE, size: 0, color: '000000' },
          left: { style: BorderStyle.NONE, size: 0, color: '000000' },
        },
      })
    );
  }

  const row = new TableRow({ children: cells });
  const table = new Table({
    rows: [row],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED, // Lock column widths
    borders: NONE_BORDERS,
  });

  return [table];
}

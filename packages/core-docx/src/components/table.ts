/**
 * Table Component
 * Standard component for rendering tables in documents
 */

import { Table } from 'docx';
import { ComponentDefinition, isTableComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createTable } from '../core/content';

type CellContent = string | ComponentDefinition;

type HorizontalAlignment = 'left' | 'center' | 'right' | 'justify';

type VerticalAlignment = 'top' | 'middle' | 'bottom';

type FontConfig = {
  family?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type BorderColor =
  | string
  | {
      bottom?: string;
      top?: string;
      right?: string;
      left?: string;
    };

type BorderSize =
  | number
  | {
      bottom?: number;
      top?: number;
      right?: number;
      left?: number;
    };

type Padding =
  | number
  | {
      bottom?: number;
      top?: number;
      right?: number;
      left?: number;
    };

type CellDefaults = {
  color?: string;
  backgroundColor?: string;
  horizontalAlignment?: HorizontalAlignment;
  verticalAlignment?: VerticalAlignment;
  font?: FontConfig;
  borderColor?: BorderColor;
  borderSize?: BorderSize;
  padding?: Padding;
  height?: number;
};

type TableConfig = {
  borderColor?: BorderColor;
  borderSize?: BorderSize;
  cellDefaults?: CellDefaults;
  headerCellDefaults?: CellDefaults;
  width?: number;
  columns: {
    width?: number;
    cellDefaults?: CellDefaults;
    header?: CellDefaults & {
      content?: CellContent;
    };
    cells?: (CellDefaults & {
      content?: CellContent;
    })[];
  }[];
  keepInOnePage?: boolean;
  keepNext?: boolean;
  repeatHeaderOnPageBreak?: boolean;
};

/**
 * Render table component
 * Supports new column-based format with cell defaults and legacy headers/rows format
 */
export async function renderTableComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Promise<Table[]> {
  if (!isTableComponent(component)) return [];

  const rawConfig = component.props as any;
  const result: Table[] = [];

  // Check if this is the old format (has headers and rows properties)
  if (rawConfig.headers && rawConfig.rows) {
    // Convert old format to new format
    const headers = rawConfig.headers as string[];
    const rows = rawConfig.rows as string[][];

    const defaultCellDefaults: CellDefaults = {
      color: '000000',
      backgroundColor: 'FFFFFF',
      horizontalAlignment: 'left',
      verticalAlignment: 'top',
      font: {
        family: 'Arial',
        size: 11,
        bold: false,
        italic: false,
        underline: false,
      },
      borderColor: '000000',
      borderSize: 1,
    };

    const config: TableConfig = {
      borderColor: '000000',
      borderSize: 1,
      cellDefaults: defaultCellDefaults,
      width: 100,
      columns: headers.map((header, colIndex) => ({
        cellDefaults: { ...defaultCellDefaults },
        header: {
          ...defaultCellDefaults,
          content: header,
        },
        cells: rows.map((row) => ({
          ...defaultCellDefaults,
          content: row[colIndex] || '',
        })),
      })),
    };

    result.push(await createTable(config.columns, config, theme, themeName));

    return result;
  }

  // New column-based format
  const config = rawConfig as TableConfig;

  result.push(await createTable(config.columns, config, theme, themeName));

  return result;
}

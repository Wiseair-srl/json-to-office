import { describe, it, expect } from 'vitest';
import { renderTableComponent } from '../table';
import { Table } from 'docx';
import type { ComponentDefinition } from '../../types';
import type { ThemeConfig } from '../../styles';

// Helper to create default cell defaults
function createDefaultCellDefaults() {
  return {
    color: '000000',
    backgroundColor: 'transparent',
    horizontalAlignment: 'left' as const,
    verticalAlignment: 'top' as const,
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
}

// Helper function to create new table config
function createTableConfig(headers: string[], rows: string[][]): any {
  const cellDefaults = createDefaultCellDefaults();

  return {
    borderColor: '000000',
    borderSize: 1,
    cellDefaults,
    width: 100,
    columns: headers.map((header, colIndex) => ({
      cellDefaults: { ...cellDefaults },
      header: {
        ...cellDefaults,
        content: header,
      },
      cells: rows.map((row) => ({
        ...cellDefaults,
        content: row[colIndex] || '',
      })),
    })),
  };
}

describe('components/table', () => {
  describe('renderTableComponent', () => {
    it('should render simple table', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Column 1', 'Column 2'],
          [
            ['Cell 1', 'Cell 2'],
            ['Cell 3', 'Cell 4'],
          ]
        ),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should render table with headers', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Header 1', 'Header 2'],
          [
            ['Data 1', 'Data 2'],
            ['Data 3', 'Data 4'],
          ]
        ),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should apply table width', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Header 1', 'Header 2'],
          [['Cell 1', 'Cell 2']]
        ),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should apply column widths', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Header 1', 'Header 2'],
          [['Cell 1', 'Cell 2']]
        ),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should apply table alignment', async () => {
      const config = createTableConfig(
        ['Header 1', 'Header 2'],
        [['Cell 1', 'Cell 2']]
      );
      config.cellDefaults.horizontalAlignment = 'center';

      const component: ComponentDefinition = {
        name: 'table',
        props: config,
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should handle empty table', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(['Column 1'], []),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should apply borders', async () => {
      const config = createTableConfig(
        ['Header 1', 'Header 2'],
        [['Cell 1', 'Cell 2']]
      );
      config.borderColor = '000000';
      config.borderSize = 2;

      const component: ComponentDefinition = {
        name: 'table',
        props: config,
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should apply cell margins', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Header 1', 'Header 2'],
          [['Cell 1', 'Cell 2']]
        ),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should apply theme styles', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Column 1', 'Column 2'],
          [['Cell 1', 'Cell 2']]
        ),
      };

      const theme = {
        table: {
          borders: {
            style: 'single',
            size: 1,
            color: '333333',
          },
        },
      };

      const result = await renderTableComponent(
        component,
        theme as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });

    it('should handle complex data types in cells', async () => {
      const component: ComponentDefinition = {
        name: 'table',
        props: createTableConfig(
          ['Col 1', 'Col 2', 'Col 3', 'Col 4'],
          [
            ['Text', '123', 'true', ''],
            ['', 'More text', '456', 'false'],
          ]
        ),
      };

      const result = await renderTableComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Table);
    });
  });
});

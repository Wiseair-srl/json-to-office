/**
 * The shapes a `table` has to accept.
 *
 * The corpus pins what each produces down to the byte; what is left to say
 * here is that every shape compiles to one table with the grid it asked for,
 * including the degenerate ones — a table with no rows, a row shorter than its
 * column, a cell holding an empty string.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrTable } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

/** The defaults the flat table shape has always been rendered with. */
function cellDefaults() {
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

function tableConfig(
  headers: string[],
  rows: string[][]
): Record<string, unknown> {
  const defaults = cellDefaults();
  return {
    borderColor: '000000',
    borderSize: 1,
    cellDefaults: defaults,
    width: 100,
    columns: headers.map((header, colIndex) => ({
      cellDefaults: { ...defaults },
      header: { ...defaults, content: header },
      cells: rows.map((row) => ({ ...defaults, content: row[colIndex] || '' })),
    })),
  };
}

async function compileTable(
  props: Record<string, unknown>
): Promise<DocxIrTable> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: {},
    children: [{ name: 'table', props }],
  } as unknown as ReportComponentDefinition);

  const [block] = compiled.ir.sections[0].children;
  expect(block.kind).toBe('table');
  return block as DocxIrTable;
}

describe('components/table', () => {
  it('compiles a header row plus one body row', async () => {
    const table = await compileTable(
      tableConfig(['Header 1', 'Header 2'], [['Cell 1', 'Cell 2']])
    );

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[0].cells).toHaveLength(2);
  });

  it('compiles a table with a header and no body rows', async () => {
    const table = await compileTable(tableConfig(['Column 1'], []));

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].isHeader).toBe(true);
  });

  it('splits an unstated width evenly across the columns', async () => {
    const table = await compileTable(
      tableConfig(['A', 'B', 'C', 'D'], [['1', '2', '3', '4']])
    );

    expect(table.width).toEqual({ kind: 'percent', value: 100 });
    expect(table.columnGrid.unit).toBe('percent');
    expect(table.columnGrid.values).toEqual([25, 25, 25, 25]);
  });

  it('measures the grid in twips once any column states a width', async () => {
    const config = tableConfig(['A', 'B'], [['1', '2']]) as {
      columns: Array<Record<string, unknown>>;
    };
    config.columns[0].width = 144; // 2 inches, in points

    const table = await compileTable(
      config as unknown as Record<string, unknown>
    );

    expect(table.columnGrid.unit).toBe('twips');
    expect(table.columnGrid.values[0]).toBe(2880);
    expect(table.width.kind).toBe('twips');
  });

  it('keeps the grid rectangular when a row is shorter than its column', async () => {
    const table = await compileTable(
      tableConfig(
        ['Col 1', 'Col 2', 'Col 3', 'Col 4'],
        [
          ['Text', '123', 'true', ''],
          ['', 'More text', '456', 'false'],
        ]
      )
    );

    expect(table.rows).toHaveLength(3);
    for (const row of table.rows) expect(row.cells).toHaveLength(4);
  });

  it('lets a cell border beat the column, and the column beat the table', async () => {
    const table = await compileTable({
      borderColor: '#111111',
      borderSize: 1,
      columns: [
        {
          cellDefaults: { borderColor: '#222222', borderSize: 2 },
          header: { content: 'H' },
          cells: [
            { content: 'own', borderColor: '#333333', borderSize: 3 },
            { content: 'column' },
          ],
        },
      ],
    });

    // Points to eighths of a point, which is the unit `w:sz` counts in.
    expect(table.rows[1].cells[0].borders?.top).toEqual({
      style: 'single',
      sizeEighthPoints: 24,
      color: { hex: '333333' },
    });
    // The column's border shows on a side the cell above does not contest.
    expect(table.rows[2].cells[0].borders?.bottom).toEqual({
      style: 'single',
      sizeEighthPoints: 16,
      color: { hex: '222222' },
    });
    // The shared edge is adjudicated: the first cell's heavier bottom wins it
    // (ECMA-376 §17.4.66 — wider first) and is mirrored onto this cell's top.
    expect(table.rows[2].cells[0].borders?.top).toEqual({
      style: 'single',
      sizeEighthPoints: 24,
      color: { hex: '333333' },
    });
  });

  it('takes a cell alignment over a column default, and that over the table', async () => {
    const table = await compileTable({
      cellDefaults: { horizontalAlignment: 'right' },
      columns: [
        {
          cellDefaults: { horizontalAlignment: 'center' },
          header: { content: 'H' },
          cells: [
            { content: 'own', horizontalAlignment: 'left' },
            { content: 'column' },
          ],
        },
        {
          header: { content: 'H2' },
          cells: [{ content: 'table' }, { content: 'table' }],
        },
      ],
    });

    const alignmentOf = (row: number, column: number) => {
      const [paragraph] = table.rows[row].cells[column].children;
      return paragraph.kind === 'paragraph'
        ? paragraph.formatting?.alignment
        : undefined;
    };

    expect(alignmentOf(1, 0)).toBe('left');
    expect(alignmentOf(2, 0)).toBe('center');
    expect(alignmentOf(1, 1)).toBe('right');
  });

  it('turns padding into cell margins, in twips', async () => {
    const table = await compileTable({
      cellDefaults: { padding: { top: 6, right: 6, bottom: 6, left: 6 } },
      columns: [{ header: { content: 'H' }, cells: [{ content: 'C' }] }],
    });

    expect(table.rows[1].cells[0].margins).toEqual({
      topTwips: 120,
      rightTwips: 120,
      bottomTwips: 120,
      leftTwips: 120,
    });
  });
});

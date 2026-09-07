/**
 * The grid a `columns` table states (#343).
 *
 * A `columns` inside a group compiles to a fixed-layout table, and
 * LibreOffice sizes such a table from its grid, so the grid must be there,
 * whole, and never wider than the measure.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { ReportComponentDefinition } from '../../types';
import type { DocxIrBlock, DocxIrTable } from '../types';
import { minimalTheme } from '../../index';
import { getAvailableWidthTwips } from '../../utils/widthUtils';

async function columnsTable(
  props: Record<string, unknown>
): Promise<DocxIrTable> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        children: [
          { name: 'paragraph', props: { text: 'Before.' } },
          {
            name: 'group',
            children: [
              {
                name: 'columns',
                props,
                children: [
                  { name: 'paragraph', props: { text: 'a' } },
                  { name: 'paragraph', props: { text: 'b' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ReportComponentDefinition);
  const table = (compiled.ir.sections[0].children as DocxIrBlock[]).find(
    (block) => block.kind === 'table'
  );
  if (!table || table.kind !== 'table') throw new Error('no columns table');
  return table;
}

const measure = getAvailableWidthTwips(minimalTheme as never, 'minimal');
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe('the grid of a nested columns table', () => {
  it('states whole-twip cells that sum to the measure, gap included', async () => {
    const table = await columnsTable({ columns: 2, gap: '3%' });
    const grid = table.columnGrid.values;
    expect(grid).toHaveLength(2);
    for (const cell of grid) expect(Number.isInteger(cell)).toBe(true);
    // Auto widths floor their share, so the sum sits within a twip per
    // column of the measure; a grid past the measure is the defect.
    expect(sum(grid)).toBeLessThanOrEqual(measure);
    expect(sum(grid)).toBeGreaterThanOrEqual(measure - grid.length);
    expect(table.rows[0].cells.map((cell) => cell.widthTwips)).toEqual(grid);
  });

  it('scales stated widths that fill the measure plus a gap back to the measure', async () => {
    const table = await columnsTable({
      columns: [{ width: '50%' }, { width: '50%' }],
      gap: 240,
    });
    const grid = table.columnGrid.values;
    expect(sum(grid)).toBe(measure);
    expect(grid[0]).toBe(grid[1]);
  });

  it('is single-column around the table, not a newspaper section', async () => {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [
            { name: 'paragraph', props: { text: 'Before.' } },
            {
              name: 'group',
              children: [
                {
                  name: 'columns',
                  props: { columns: 2 },
                  children: [{ name: 'paragraph', props: { text: 'a' } }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ReportComponentDefinition);
    expect(compiled.ir.sections).toHaveLength(1);
    expect(compiled.ir.sections[0].properties.columns?.count ?? 1).toBe(1);
  });
});

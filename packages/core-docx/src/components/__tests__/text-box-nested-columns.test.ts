/**
 * Columns nested inside a text box.
 *
 * A text box is a one-cell table, and a `columns` inside one becomes a table of
 * its own within that cell — there is no section to give it, so the columns
 * have to be cells. This pins the shape that produces, including the case that
 * catches the mistake: a text box that also floats.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrTable } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

const p = (text: string) => ({ name: 'paragraph', props: { text } });

/** The outer text-box table, and the columns table inside its single cell. */
async function nested(
  textBoxProps: Record<string, unknown>,
  children: unknown[]
): Promise<{ box: DocxIrTable; columns: DocxIrTable }> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'text-box', props: textBoxProps, children }],
  } as unknown as ReportComponentDefinition);

  const [outer] = compiled.ir.sections[0].children;
  expect(outer.kind).toBe('table');
  const box = outer as DocxIrTable;

  const inner = box.rows[0].cells[0].children.find(
    (block) => block.kind === 'table'
  );
  expect(inner).toBeDefined();
  return { box, columns: inner as DocxIrTable };
}

const twoColumns = (props: Record<string, unknown> = { columns: 2 }) => ({
  name: 'columns',
  props,
  children: [p('Left column'), p('Right column')],
});

describe('text-box with nested columns', () => {
  it('puts a columns table inside the text box cell', async () => {
    const { box, columns } = await nested(
      { style: { padding: { top: 6, right: 6, bottom: 6, left: 6 } } },
      [twoColumns()]
    );

    expect(box.rows).toHaveLength(1);
    expect(box.rows[0].cells).toHaveLength(1);
    expect(columns.rows[0].cells).toHaveLength(2);
  });

  it('keeps the columns inside a floating text box', async () => {
    const { box, columns } = await nested(
      {
        floating: {
          horizontalPosition: { relative: 'margin', align: 'right' },
          verticalPosition: { relative: 'page', align: 'top' },
          width: 2880,
          height: 1800,
        },
      },
      [
        p('Header text'),
        twoColumns({ columns: [{ width: '50%' }, { width: '50%' }] }),
      ]
    );

    // The box floats; the columns inside it do not float independently.
    expect(box.floating).toBeDefined();
    expect(columns.floating).toBeUndefined();
    expect(columns.rows[0].cells).toHaveLength(2);
  });

  it('compiles a three-column layout', async () => {
    const { columns } = await nested({}, [
      {
        name: 'columns',
        props: { columns: 3 },
        children: [p('One'), p('Two'), p('Three')],
      },
    ]);

    expect(columns.rows[0].cells).toHaveLength(3);
  });

  it('keeps content around the columns in the same cell', async () => {
    const { box } = await nested({}, [
      { name: 'heading', props: { level: 2, text: 'Title' } },
      twoColumns(),
      p('After the columns'),
    ]);

    const kinds = box.rows[0].cells[0].children.map((block) => block.kind);
    expect(kinds).toEqual(['paragraph', 'table', 'paragraph']);
  });

  it('takes percentage widths, resolved against the text column', async () => {
    const { columns } = await nested({}, [
      twoColumns({ columns: [{ width: '30%', gap: 12 }, { width: '70%' }] }),
    ]);

    const [narrow, wide] = columns.rows[0].cells.map(
      (cell) => cell.widthTwips!
    );
    expect(narrow).toBeGreaterThan(0);
    // Roughly 30:70, allowing for the gap taken out of the measure.
    expect(wide / narrow).toBeGreaterThan(2);
    expect(wide / narrow).toBeLessThan(2.7);
  });
});

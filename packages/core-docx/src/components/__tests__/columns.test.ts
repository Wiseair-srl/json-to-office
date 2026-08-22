/**
 * What a `columns` component does, which depends entirely on where it sits.
 *
 * At the top level it is a page layout: the layout stage turns it into its own
 * OOXML section with a column setting, and its children flow through the
 * columns as one stream. Inside a text box there is no section to give, so the
 * columns become table cells and the children are dealt across them.
 *
 * Both readings are covered here, because the difference between them is the
 * one thing about this component that is easy to get wrong.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIR, DocxIrTable } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

async function compile(children: unknown[]): Promise<DocxIR> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as unknown as ReportComponentDefinition);
  return compiled.ir;
}

const p = (text: string) => ({ name: 'paragraph', props: { text } });

const textOf = (ir: DocxIR, section: number): string[] =>
  ir.sections[section].children.flatMap((block) =>
    block.kind === 'paragraph'
      ? [
          block.children
            .map((child) => (child.kind === 'text' ? child.text : ''))
            .join(''),
        ]
      : []
  );

/** The columns of a text box's nested table, as the text in each cell. */
function cellTexts(table: DocxIrTable): string[][] {
  return table.rows[0].cells.map((cell) =>
    cell.children.flatMap((block) =>
      block.kind === 'paragraph'
        ? [
            block.children
              .map((child) => (child.kind === 'text' ? child.text : ''))
              .join(''),
          ]
        : []
    )
  );
}

async function textBoxColumns(
  props: Record<string, unknown>,
  children: unknown[]
): Promise<DocxIrTable> {
  const ir = await compile([
    {
      name: 'text-box',
      props: {},
      children: [{ name: 'columns', props, children }],
    },
  ]);

  const [outer] = ir.sections[0].children;
  expect(outer.kind).toBe('table');
  const inner = (outer as DocxIrTable).rows[0].cells[0].children[0];
  expect(inner.kind).toBe('table');
  return inner as DocxIrTable;
}

describe('components/columns at the top level', () => {
  it('becomes its own section with the column count it asked for', async () => {
    const ir = await compile([
      p('Before'),
      { name: 'columns', props: { columns: 2 }, children: [p('A'), p('B')] },
      p('After'),
    ]);

    // Before, the columns themselves, after: three sections, because a column
    // setting can only change at a section boundary.
    expect(ir.sections).toHaveLength(3);
    expect(ir.sections[1].properties.columns?.count).toBe(2);
    expect(textOf(ir, 1)).toEqual(['A', 'B']);
  });

  it('flows its children as one stream, not one per column', async () => {
    const ir = await compile([
      {
        name: 'columns',
        props: { columns: 2 },
        children: [p('One'), p('Two'), p('Three')],
      },
    ]);

    expect(textOf(ir, 0)).toEqual(['One', 'Two', 'Three']);
  });

  it('carries mixed component types through', async () => {
    const ir = await compile([
      {
        name: 'columns',
        props: { columns: 2 },
        children: [
          { name: 'heading', props: { level: 2, text: 'Title' } },
          p('Body'),
          { name: 'list', props: { items: ['One'] } },
        ],
      },
    ]);

    expect(textOf(ir, 0)).toEqual(['Title', 'Body', 'One']);
  });

  it('still opens a section for a columns component with no children', async () => {
    // The column setting is a property of the page, not of the content: an
    // empty two-column block is a two-column page with nothing on it.
    const ir = await compile([
      { name: 'columns', props: { columns: 2 }, children: [] },
    ]);

    expect(ir.sections).toHaveLength(1);
    expect(ir.sections[0].children).toEqual([]);
  });

  it('takes explicit widths and gaps', async () => {
    const ir = await compile([
      {
        name: 'columns',
        props: { columns: [{ width: 144 }, { width: 144 }], gap: 36 },
        children: [p('A'), p('B')],
      },
    ]);

    const { columns } = ir.sections[0].properties;
    expect(columns?.count).toBe(2);
    // Points to twips; explicit widths turn equal distribution off.
    expect(columns?.widths?.[0].widthTwips).toBe(2880);
    expect(columns?.equalWidth).toBe(false);
  });
});

describe('components/columns inside a text box', () => {
  it('becomes a cell per column, dealing children round-robin', async () => {
    const table = await textBoxColumns({ columns: 2 }, [
      p('One'),
      p('Two'),
      p('Three'),
    ]);

    expect(cellTexts(table)).toEqual([['One', 'Three'], ['Two']]);
  });

  it('gives a column with nothing dealt to it an empty paragraph', async () => {
    const table = await textBoxColumns({ columns: 3 }, [p('Only one')]);

    expect(table.rows[0].cells).toHaveLength(3);
    expect(cellTexts(table)).toEqual([['Only one'], [''], ['']]);
  });

  it('splits the gap between the two cells either side of it', async () => {
    // Points, like every other authored length here: 36pt is half an inch.
    const table = await textBoxColumns({ columns: 2, gap: 36 }, [
      p('A'),
      p('B'),
    ]);

    const [first, second] = table.rows[0].cells;
    expect(first.margins?.rightTwips).toBe(360);
    expect(second.margins?.leftTwips).toBe(360);
    // Nothing sits to the left of the first column, or right of the last.
    expect(first.margins?.leftTwips).toBe(0);
    expect(second.margins?.rightTwips).toBe(0);
  });

  it('shares what the stated columns leave over between the rest', async () => {
    const table = await textBoxColumns(
      { columns: [{ width: 144 }, {}, {}], gap: 0 },
      [p('A'), p('B'), p('C')]
    );

    const widths = table.rows[0].cells.map((cell) => cell.widthTwips!);
    expect(widths[0]).toBe(2880);
    expect(widths[1]).toBe(widths[2]);
  });
});

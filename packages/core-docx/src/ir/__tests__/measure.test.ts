/**
 * The measure: the width everything is sized against (`ir/measure.ts`).
 *
 * `__tests__/table-grid.test.ts` asserts the grid both backends write for a
 * table in the body and in a text box, and `__tests__/media-measure.test.ts`
 * what they write for an image or a shape in one. What is left is the rest of
 * the rule: a table's own percentage width, one column of a multi-column
 * section, page chrome, a text box that states its width in pixels, the
 * overflow warning, a gutter the theme states, and every kind of drawing a
 * text box can hold.
 */

import { describe, expect, it } from 'vitest';
import type { GenerationWarning } from '@json-to-office/shared';
import { PNG_4X2 } from '../../__tests__/fixtures/corpus-blocks';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { ReportComponentDefinition } from '../../types';
import { textWidthTwips } from '../measure';
import type {
  DocxIrBlock,
  DocxIrInline,
  DocxIrSection,
  DocxIrTable,
} from '../types';
import { inchesToEmu, pixelsToEmu, twipsToPixels } from '../units';

async function sections(
  section: Record<string, unknown>,
  options: {
    warnings?: GenerationWarning[];
    themeOverrides?: Record<string, unknown>;
  } = {}
): Promise<DocxIrSection[]> {
  const compiled = await compileDocumentToIr(
    {
      name: 'docx',
      props: {
        theme: 'minimal',
        ...(options.themeOverrides
          ? { themeOverrides: options.themeOverrides }
          : {}),
      },
      children: [{ name: 'section', ...section }],
    } as unknown as ReportComponentDefinition,
    { warnings: options.warnings ?? [] }
  );
  return compiled.ir.sections;
}

const tablesIn = (blocks: readonly DocxIrBlock[]): DocxIrTable[] =>
  blocks.filter((block): block is DocxIrTable => block.kind === 'table');

const table = (props: Record<string, unknown> = {}) => ({
  name: 'table',
  props: {
    ...props,
    columns: ['A', 'B', 'C'].map((header) => ({
      header: { content: header },
      cells: [{ content: header.toLowerCase() }],
    })),
  },
});

const paragraph = (text: string) => ({ name: 'paragraph', props: { text } });

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** Columns that state their widths, points or percentages. */
const stated = (widths: Array<number | string>) => ({
  name: 'table',
  props: {
    columns: widths.map((width, index) => ({
      width,
      header: { content: `H${index}` },
      cells: [{ content: `c${index}` }],
    })),
  },
});

describe('a table grid in twips', () => {
  it("takes the table's own percentage of the text width", async () => {
    const [section] = await sections({ children: [table({ width: 60 })] });
    const [only] = tablesIn(section.children);

    expect(only.width).toEqual({ kind: 'percent', value: 60 });
    expect(only.columnGrid.unit).toBe('twips');
    expect(sum(only.columnGrid.values)).toBe(
      Math.round(textWidthTwips(section.properties.page) * 0.6)
    );
  });

  it('measures a table in a multi-column section against its narrowest column', async () => {
    const all = await sections({
      children: [
        {
          name: 'columns',
          props: { columns: [{ width: '30%', gap: '5%' }, {}] },
          children: [
            table(),
            { name: 'paragraph', props: { text: 'Beside.' } },
          ],
        },
      ],
    });
    const section = all.find((s) => (s.properties.columns?.count ?? 1) > 1)!;
    const [only] = tablesIn(section.children);
    const columns = section.properties.columns!.widths!.map(
      (column) => column.widthTwips
    );

    expect(new Set(columns).size).toBe(2);
    expect(sum(only.columnGrid.values)).toBe(Math.min(...columns));
  });

  it('measures a header table against the whole text width, columns or not', async () => {
    const all = await sections({
      props: { header: [table()] },
      children: [
        {
          name: 'columns',
          props: { columns: [{ width: '30%' }, {}] },
          children: [{ name: 'paragraph', props: { text: 'Body.' } }],
        },
      ],
    });
    const section = all.find((s) => (s.properties.columns?.count ?? 1) > 1)!;
    const [header] = tablesIn(section.headers!.default!.children);

    expect(sum(header.columnGrid.values)).toBe(
      textWidthTwips(section.properties.page)
    );
  });

  it('sizes a text box stated in pixels to its own width', async () => {
    const [section] = await sections({
      children: [
        {
          name: 'text-box',
          props: {
            width: 300,
            floating: {
              horizontalPosition: { relative: 'margin', align: 'right' },
              verticalPosition: { relative: 'paragraph', offset: 0 },
            },
          },
          children: [table()],
        },
      ],
    });
    const [box] = tablesIn(section.children);
    const [nested] = tablesIn(box.rows[0].cells[0].children);

    // 300px at 96 DPI; the box states no padding, so its cell is all content.
    expect(box.columnGrid).toEqual({ unit: 'twips', values: [4500] });
    expect(sum(nested.columnGrid.values)).toBe(4500);
  });

  it('leaves a grid stated in twips as it was', async () => {
    const [section] = await sections({
      children: [
        {
          name: 'table',
          props: {
            columns: [
              { width: 144, header: { content: 'A' }, cells: [] },
              { width: 72, header: { content: 'B' }, cells: [] },
            ],
          },
        },
      ],
    });
    const [only] = tablesIn(section.children);

    expect(only.columnGrid).toEqual({ unit: 'twips', values: [2880, 1440] });
  });
});

describe('a table that states its widths', () => {
  it("takes its percentages of a multi-column section's narrowest column", async () => {
    const all = await sections({
      children: [
        {
          name: 'columns',
          props: { columns: [{ width: '30%', gap: '5%' }, {}] },
          children: [stated(['40%', '60%']), paragraph('Beside.')],
        },
      ],
    });
    const section = all.find((s) => (s.properties.columns?.count ?? 1) > 1)!;
    const [only] = tablesIn(section.children);
    const column = Math.min(
      ...section.properties.columns!.widths!.map((c) => c.widthTwips)
    );

    expect(only.width).toEqual({ kind: 'twips', value: column });
    expect(only.columnGrid.values).toEqual([
      Math.round(column * 0.4),
      Math.round(column * 0.6),
    ]);
  });

  it('warns when its widths overflow the box it is in, not the page', async () => {
    // 400pt fits the 425pt measure but not a box padded 72pt a side.
    const table = stated([200, 200]);
    const atTop: GenerationWarning[] = [];
    await sections({ children: [table] }, { warnings: atTop });
    const inBox: GenerationWarning[] = [];
    const [section] = await sections(
      {
        children: [
          {
            name: 'text-box',
            props: { style: { padding: { left: 72, right: 72 } } },
            children: [table],
          },
        ],
      },
      { warnings: inBox }
    );
    const content = textWidthTwips(section.properties.page) - 2 * 1440;

    const overflow = (warnings: GenerationWarning[]) =>
      warnings.filter((w) => /exceeds available table width/.test(w.message));
    expect(overflow(atTop)).toEqual([]);
    expect(overflow(inBox)).toHaveLength(1);
    expect(overflow(inBox)[0].message).toContain(`(${content} twips)`);
  });
});

describe('a gutter the theme states', () => {
  it('reaches the page and comes off the measure', async () => {
    const [section] = await sections(
      { children: [table()] },
      { themeOverrides: { spacing: { canvas: { a4: { gutterIn: 0.5 } } } } }
    );
    const [only] = tablesIn(section.children);
    const { page } = section.properties;

    expect(page.margins.gutterTwips).toBe(720);
    expect(sum(only.columnGrid.values)).toBe(
      page.widthTwips - page.margins.leftTwips - page.margins.rightTwips - 720
    );
  });
});

describe('what a text box holds is set against the box', () => {
  /** A box padded 72pt a side: two inches narrower than the text column. */
  async function inBox(child: Record<string, unknown>) {
    const [section] = await sections({
      children: [
        {
          name: 'text-box',
          props: { style: { padding: { left: 72, right: 72 } } },
          children: [child],
        },
      ],
    });
    const [box] = tablesIn(section.children);
    const [first] = box.rows[0].cells[0].children;
    if (first.kind !== 'paragraph') throw new Error('not a paragraph');
    return {
      content: textWidthTwips(section.properties.page) - 2 * 1440,
      page: section.properties.page.widthTwips,
      drawing: first.children[0] as DocxIrInline & { widthEmu?: number },
    };
  }

  const pixelsEmu = (twips: number) =>
    pixelsToEmu(Math.round(twipsToPixels(twips)));

  it('fills it with an image that states no width', async () => {
    const { content, drawing } = await inBox({
      name: 'image',
      props: { base64: PNG_4X2 },
    });

    expect(drawing.kind).toBe('image');
    expect(drawing.widthEmu).toBe(pixelsEmu(content));
  });

  it("still takes the page's width when an image asks for it", async () => {
    const { page, drawing } = await inBox({
      name: 'image',
      props: { base64: PNG_4X2, width: '50%', widthRelativeTo: 'page' },
    });

    expect(drawing.widthEmu).toBe(
      pixelsToEmu(Math.round(twipsToPixels(page) * 0.5))
    );
  });

  it("gives a native visual's percentage width the box", async () => {
    const { content, drawing } = await inBox({
      name: 'visual',
      props: {
        renderMode: 'native',
        width: '100%',
        canvas: { width: 4, height: 2 },
        elements: [
          { name: 'shape', props: { type: 'rect', x: 0, y: 0, w: 1, h: 1 } },
        ],
      },
    });

    expect(drawing.kind).toBe('drawingGroup');
    expect(drawing.widthEmu).toBe(pixelsEmu(content));
  });

  it('gives a native chart that states no width the box', async () => {
    const { content, drawing } = await inBox({
      name: 'chart',
      props: {
        type: 'bar',
        data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }],
      },
    });

    expect(drawing.kind).toBe('chart');
    expect(drawing.widthEmu).toBe(inchesToEmu(content / 1440));
  });

  it("gives a shape's percentage width the box that holds it", async () => {
    const { content, drawing } = await inBox({
      name: 'text-box',
      props: { renderAs: 'shape', width: '50%', height: 100 },
      children: [paragraph('Inside.')],
    });

    expect(drawing.kind).toBe('shape');
    expect((drawing as { widthPx?: number }).widthPx).toBe(
      Math.round((content * 0.5) / 15)
    );
  });
});

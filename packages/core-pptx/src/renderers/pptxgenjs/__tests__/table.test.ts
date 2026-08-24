import PptxGenJS from 'pptxgenjs';
import { describe, expect, it, vi } from 'vitest';
import { compileDocumentToIr } from '../../../core/generateFromIr';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../../types';
import type { PptxIrTableElement } from '../../../ir/types';
import { emitTable } from '../table';

const theme: PptxThemeConfig = {
  name: 'table-test',
  colors: {
    primary: '#0066cc',
    secondary: '#ED7D31',
    accent: '#70AD47',
    background: '#FFFFFF',
    text: '#000000',
  },
  fonts: { heading: 'Geist', body: 'Inter' },
  defaults: { fontSize: 12, fontColor: '#000000' },
};
type EmittedCell = { text: string; options?: Record<string, unknown> };

async function emitted(props: Record<string, unknown>) {
  const document = {
    name: 'pptx',
    props: { theme },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'table', props: { rows: [['a']], ...props } }],
      },
    ],
  } as PresentationComponentDefinition;
  const { ir } = await compileDocumentToIr(document);
  const table = ir.slides[0].elements[0] as PptxIrTableElement;
  const addTable = vi.fn();
  const addShape = vi.fn();
  emitTable(
    { addTable, addShape } as unknown as PptxGenJS.Slide,
    table,
    new PptxGenJS()
  );
  const [rows, options] = addTable.mock.calls[0] as [
    EmittedCell[][],
    Record<string, unknown>,
  ];
  return { rows, options, shapes: addShape.mock.calls };
}

describe('PptxGenJS table adapter', () => {
  it('maps defaults and explicit cell overrides', async () => {
    const result = await emitted({
      fontFace: 'Inter',
      fontWeight: 700,
      rows: [['inherits'], [{ text: 'regular', bold: false }]],
    });
    expect(result.options).toMatchObject({ fontFace: 'Inter', bold: true });
    expect(result.rows[0][0].options).toBeUndefined();
    expect(result.rows[1][0].options).toMatchObject({ bold: false });

    const weighted = await emitted({
      fontFace: 'Inter',
      fontWeight: 700,
      rows: [[{ text: 'light', fontWeight: 300 }]],
    });
    expect(weighted.rows[0][0].options).toMatchObject({
      fontFace: 'Inter Light',
      bold: false,
    });
  });

  it('passes compiled emoji text into cells', async () => {
    const { rows } = await emitted({ rows: [['✓ done']] });
    expect(rows[0][0].text).toBe('✓\uFE0E done');
  });

  it('draws rounded background blocks and exposes corner cells', async () => {
    const result = await emitted({
      x: 1,
      y: 2,
      colW: [2, 3],
      rowH: [0.5, 0.4, 0.4],
      borderRadius: 0.2,
      rows: [
        [
          { text: 'H1', fill: 'primary' },
          { text: 'H2', fill: 'primary' },
        ],
        ['a', 'b'],
        [{ text: 'c', fill: 'background' }, 'd'],
      ],
    });
    expect(result.shapes).toHaveLength(4);
    expect(result.shapes[0]).toEqual([
      'roundRect',
      expect.objectContaining({
        x: 1,
        y: 2,
        w: 5,
        h: 0.5,
        fill: { color: '0066CC' },
        rectRadius: 0.2,
      }),
    ]);
    expect(result.rows[0][0].options?.fill).toBeUndefined();
    expect(result.rows[1][0].options?.fill).toEqual({ color: 'FFFFFF' });
    expect(result.options.border).toEqual([
      { type: 'none' },
      { type: 'none' },
      { type: 'none' },
      { type: 'none' },
    ]);
  });

  it('removes rounded-table outer borders and the header seam', async () => {
    const { rows } = await emitted({
      x: 1,
      y: 2,
      colW: [2, 3],
      rowH: [0.5, 0.4, 0.4],
      borderRadius: 0.2,
      border: { type: 'solid', pt: 1, color: '000000' },
      rows: [
        ['H1', 'H2'],
        ['a', 'b'],
        ['c', 'd'],
      ],
    });
    const none = { type: 'none', pt: 0 };
    const inner = { type: 'solid', pt: 1, color: '000000' };
    expect(rows[0][0].options?.border).toEqual([none, inner, none, none]);
    expect(rows[1][0].options?.border).toEqual([none, inner, inner, none]);
    expect(rows[1][1].options?.border).toEqual([none, none, inner, inner]);
    expect(rows[2][1].options?.border).toEqual([inner, none, none, inner]);
  });

  it('keeps ordinary table borders', async () => {
    const { options } = await emitted({
      border: { type: 'dash', pt: 2, color: 'primary' },
    });
    expect(options.border).toEqual({ type: 'dash', pt: 2, color: '0066CC' });
  });
});

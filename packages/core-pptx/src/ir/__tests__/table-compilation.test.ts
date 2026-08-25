import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../types';
import { EMU_PER_INCH, type PptxIrTableElement } from '../types';
import { assertValidPptxIr } from '../validation';

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

async function compileTable(
  props: Record<string, unknown>
): Promise<PptxIrTableElement> {
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
  assertValidPptxIr(ir);
  return ir.slides[0].elements[0] as PptxIrTableElement;
}

describe('table formatting compiles to IR', () => {
  it('resolves table font weights', async () => {
    expect(
      (await compileTable({ fontFace: 'Inter', fontWeight: 300 })).defaults
    ).toMatchObject({ fontFamily: 'Inter Light' });
    expect((await compileTable({ fontWeight: 500 })).defaults).toMatchObject({
      fontFamily: 'Inter Medium',
    });
    expect(
      (await compileTable({ fontFace: 'Inter', fontWeight: 700 })).defaults
    ).toMatchObject({ fontFamily: 'Inter', bold: true });
    expect((await compileTable({ fontFace: 'Inter' })).defaults).toMatchObject({
      fontFamily: 'Inter',
    });
  });

  it('aliases a cell weight off the un-synthesized family', async () => {
    // The cell must not inherit "Inter Light" as its base, or its own weight
    // would stack a second suffix onto an already-synthesized name.
    const table = await compileTable({
      fontFace: 'Inter',
      fontWeight: 300,
      rows: [[{ text: 'a', fontWeight: 600 }, { text: 'b', bold: true }, 'c']],
    });
    expect(table.defaults.fontFamily).toBe('Inter Light');
    expect(table.rows[0].cells[0].formatting?.fontFamily).toBe(
      'Inter SemiBold'
    );
    expect(table.rows[0].cells[1].formatting).toMatchObject({
      fontFamily: 'Inter',
      bold: true,
    });
    // The plain-string cell states nothing of its own and inherits the alias.
    expect(table.rows[0].cells[2].formatting).toBeUndefined();
  });

  it('does not alias a bold:false cell onto a bold sub-family', async () => {
    const table = await compileTable({
      fontFace: 'Inter',
      fontWeight: 700,
      rows: [[{ text: 'plain', bold: false }]],
    });
    expect(table.rows[0].cells[0].formatting?.fontFamily).not.toBe(
      'Inter Bold'
    );
    expect(table.rows[0].cells[0].formatting?.bold).toBe(false);
  });

  it('keeps cell overrides separate from table defaults', async () => {
    const table = await compileTable({
      fontFace: 'Inter',
      fontSize: 16,
      fontWeight: 700,
      color: 'text',
      fill: 'background',
      rows: [
        ['inherits'],
        [
          {
            text: 'overrides',
            fontWeight: 300,
            fontSize: 20,
            color: 'primary',
            fill: 'accent',
            bold: false,
          },
        ],
      ],
    });
    expect(table.defaults).toMatchObject({
      fontFamily: 'Inter',
      fontSize: 16,
      bold: true,
      color: { hex: '000000' },
    });
    expect(table.fill).toEqual({ hex: 'FFFFFF' });
    expect(table.rows[0].cells[0].formatting).toBeUndefined();
    expect(table.rows[1].cells[0]).toMatchObject({
      formatting: {
        fontFamily: 'Inter Light',
        fontSize: 20,
        bold: false,
        color: { hex: '0066CC' },
      },
      fill: { hex: '70AD47' },
    });
  });

  it('defaults size and vertical alignment from the theme', async () => {
    const table = await compileTable({ rows: [['a']] });
    expect(table.defaults.fontSize).toBe(12);
    expect(table.defaults.verticalAlign).toBe('middle');
  });

  it('records all cell-only formatting and spans', async () => {
    const cell = (
      await compileTable({
        rows: [
          [
            {
              text: 'Header',
              color: 'FFFFFF',
              fill: 'primary',
              fontSize: 10,
              fontFace: 'Georgia',
              italic: true,
              align: 'right',
              valign: 'bottom',
              margin: [1, 2, 3, 4],
              colspan: 2,
              rowspan: 3,
            },
          ],
        ],
      })
    ).rows[0].cells[0];
    expect(cell.formatting).toEqual({
      color: { hex: 'FFFFFF' },
      fontSize: 10,
      fontFamily: 'Georgia',
      italic: true,
      align: 'right',
      verticalAlign: 'bottom',
      insetPoints: [1, 2, 3, 4],
    });
    expect(cell.fill).toEqual({ hex: '0066CC' });
    expect(cell.colSpan).toBe(2);
    expect(cell.rowSpan).toBe(3);
  });
});

describe('table content compiles to IR', () => {
  it('forces text presentation for emoji-prone characters', async () => {
    const table = await compileTable({
      rows: [
        ['✓ done', '★ starred'],
        [{ text: '⚠ warning' }, 'plain text'],
      ],
    });
    expect(table.rows[0].cells[0].text).toBe('✓\uFE0E done');
    expect(table.rows[0].cells[1].text).toBe('★\uFE0E starred');
    expect(table.rows[1].cells[0].text).toBe('⚠\uFE0E warning');
    expect(table.rows[1].cells[1].text).toBe('plain text');
  });

  it('records rounded-table geometry without adapter technique', async () => {
    const table = await compileTable({
      x: 1,
      y: 2,
      colW: [2, 3],
      rowH: [0.5, 0.4],
      borderRadius: 0.2,
      rows: [['a', 'b']],
    });
    expect(table.cornerRadiusInches).toBe(0.2);
    expect(table.columnWidthsEmu).toEqual([2 * EMU_PER_INCH, 3 * EMU_PER_INCH]);
  });

  it('records an ordinary table border', async () => {
    const table = await compileTable({
      border: { type: 'dash', pt: 2, color: 'primary' },
    });
    expect(table.cornerRadiusInches).toBeUndefined();
    expect(table.border).toEqual({
      type: 'dash',
      widthPoints: 2,
      color: { hex: '0066CC' },
    });
  });
});

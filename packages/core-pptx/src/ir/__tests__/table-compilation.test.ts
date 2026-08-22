/**
 * Table compilation, ported from the deleted `components/__tests__/table.test.ts`.
 *
 * The old test drove the PptxGenJS writer directly and read both halves of the
 * `addTable(rows, opts)` call, so every case mixed two concerns. They are split
 * here: resolution (weight aliasing, the cascade, the emoji variation selector)
 * is asserted on the IR the compiler produces, and the option-bag shape the
 * cascade depends on — table-level `bold` reaching silent cells, a cell writing
 * `bold: false` through, a plain cell carrying no `options` at all — is
 * asserted on the PptxGenJS adapter, which is the only layer that still knows
 * about that cascade.
 */

import { describe, expect, it, vi } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { emitTable } from '../../renderers/pptxgenjs/table';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../types';
import { EMU_PER_INCH, type PptxIrTableElement } from '../types';
import { emuToInches } from '../units';
import { assertValidPptxIr } from '../validation';

/** The mock theme the deleted test used, widened to a schema-valid theme. */
const THEME: PptxThemeConfig = {
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

type TableProps = Record<string, unknown>;

async function compileTable(props: TableProps): Promise<PptxIrTableElement> {
  const document = {
    name: 'pptx',
    props: { theme: THEME },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'table', props: { rows: [['a']], ...props } }],
      },
    ],
  } as unknown as PresentationComponentDefinition;

  const { ir } = await compileDocumentToIr(document);
  assertValidPptxIr(ir);

  const element = ir.slides[0].elements[0];
  if (element.kind !== 'table') {
    throw new Error(`expected a table element, got "${element.kind}"`);
  }
  return element;
}

interface EmittedCell {
  text: string;
  options?: Record<string, unknown>;
}

interface EmittedTable {
  rows: EmittedCell[][];
  opts: Record<string, unknown>;
  shapes: Array<[string, Record<string, unknown>]>;
}

/** Build the IR for a table and run it through the PptxGenJS adapter. */
async function addTable(props: TableProps): Promise<EmittedTable> {
  const element = await compileTable(props);
  const addTableMock = vi.fn();
  const addShapeMock = vi.fn();
  const slide = {
    addTable: addTableMock,
    addShape: addShapeMock,
  } as unknown as PptxGenJS.Slide;

  emitTable(slide, element, new PptxGenJS());

  const [rows, opts] = addTableMock.mock.calls[0] as [
    EmittedCell[][],
    Record<string, unknown>,
  ];
  return {
    rows,
    opts,
    shapes: addShapeMock.mock.calls as Array<[string, Record<string, unknown>]>,
  };
}

/**
 * A PPTX table cell carries no numeric weight either, so a table-level
 * `fontWeight` resolves the same way a run does: sub-family alias for
 * non-RIBBI, bold toggle for 700. The compiler decides that; pptxgenjs then
 * cascades the resulting `fontFace`/`bold` into every cell that sets neither.
 */
describe('table-level fontWeight', () => {
  it('aliases the default face to the sub-family for a non-RIBBI weight', async () => {
    const element = await compileTable({ fontFace: 'Inter', fontWeight: 300 });

    expect(element.defaults.fontFamily).toBe('Inter Light');
    expect(element.defaults.bold).toBeUndefined();

    const { opts } = await addTable({ fontFace: 'Inter', fontWeight: 300 });
    expect(opts.fontFace).toBe('Inter Light');
    expect(opts.bold).toBeUndefined();
  });

  it('falls back to the theme body font when no face is given', async () => {
    const element = await compileTable({ fontWeight: 500 });

    expect(element.defaults.fontFamily).toBe('Inter Medium');
    expect((await addTable({ fontWeight: 500 })).opts.fontFace).toBe(
      'Inter Medium'
    );
  });

  it('keeps the canonical family and sets bold at 700', async () => {
    const element = await compileTable({ fontFace: 'Inter', fontWeight: 700 });

    expect(element.defaults.fontFamily).toBe('Inter');
    expect(element.defaults.bold).toBe(true);

    const { opts } = await addTable({ fontFace: 'Inter', fontWeight: 700 });
    expect(opts.fontFace).toBe('Inter');
    expect(opts.bold).toBe(true);
  });

  it('leaves the face untouched when no weight is given', async () => {
    const element = await compileTable({ fontFace: 'Inter' });

    expect(element.defaults.fontFamily).toBe('Inter');
    expect(element.defaults.bold).toBeUndefined();

    const { opts } = await addTable({ fontFace: 'Inter' });
    expect(opts.fontFace).toBe('Inter');
    expect(opts.bold).toBeUndefined();
  });

  it('aliases a cell weight off the un-synthesized table family', async () => {
    // The cell must not inherit "Inter Light" as its base, or its own weight
    // would stack a second suffix onto an already-synthesized name.
    const props = {
      fontFace: 'Inter',
      fontWeight: 300,
      rows: [[{ text: 'a', fontWeight: 600 }, { text: 'b', bold: true }, 'c']],
    };
    const element = await compileTable(props);
    const cells = element.rows[0].cells;

    expect(cells[0].formatting?.fontFamily).toBe('Inter SemiBold');
    expect(cells[1].formatting).toMatchObject({
      fontFamily: 'Inter',
      bold: true,
    });
    // The plain-string cell states nothing of its own and inherits the alias.
    expect(cells[2].formatting).toBeUndefined();
    expect(element.defaults.fontFamily).toBe('Inter Light');

    const { rows, opts } = await addTable(props);
    expect(rows[0][0].options?.fontFace).toBe('Inter SemiBold');
    expect(rows[0][1].options).toMatchObject({
      fontFace: 'Inter',
      bold: true,
    });
    // A cell with nothing to say is emitted without an options bag at all.
    expect(rows[0][2].options).toBeUndefined();
    expect(opts.fontFace).toBe('Inter Light');
  });
});

describe('a cell can opt out of an inherited table weight', () => {
  it('writes bold: false through so the table-level bold does not cascade', async () => {
    // pptxgenjs cascades table-level `bold` into any cell that sets none, so
    // a cell that says `bold: false` has to emit the false explicitly or it
    // silently renders bold anyway.
    const props = {
      fontFace: 'Inter',
      fontWeight: 700,
      rows: [[{ text: 'plain', bold: false }]],
    };

    expect((await compileTable(props)).rows[0].cells[0].formatting?.bold).toBe(
      false
    );
    expect((await addTable(props)).rows[0][0].options?.bold).toBe(false);
  });

  it('still leaves a cell that expresses no opinion to inherit', async () => {
    const props = {
      fontFace: 'Inter',
      fontWeight: 700,
      rows: [[{ text: 'inherits' }]],
    };
    const element = await compileTable(props);

    expect(element.defaults.bold).toBe(true);
    expect(element.rows[0].cells[0].formatting).toBeUndefined();

    const { rows, opts } = await addTable(props);
    expect(opts.bold).toBe(true);
    expect(rows[0][0].options).toBeUndefined();
  });

  it('does not alias a bold:false cell onto a bold sub-family', async () => {
    const props = {
      fontFace: 'Inter',
      fontWeight: 700,
      rows: [[{ text: 'plain', bold: false }]],
    };

    // The cell must not pick up a synthesized bold face either.
    expect(
      (await compileTable(props)).rows[0].cells[0].formatting?.fontFamily
    ).not.toBe('Inter Bold');
    expect((await addTable(props)).rows[0][0].options?.fontFace).not.toBe(
      'Inter Bold'
    );
  });
});

/**
 * The cascade itself: what the table states lands in `defaults`, and a cell
 * carries only what it overrides. The old writer merged the two into one
 * option bag per call; the IR keeps them apart and the adapter re-splits them
 * the same way, so both halves are asserted.
 */
describe('cell formatting cascade', () => {
  it('puts table-level formatting in defaults, not in every cell', async () => {
    const props = {
      fontSize: 14,
      fontFace: 'Georgia',
      color: 'primary',
      align: 'center',
      valign: 'top',
      margin: 6,
      rows: [['A', 'B']],
    };
    const element = await compileTable(props);

    expect(element.defaults).toEqual({
      fontFamily: 'Georgia',
      fontSize: 14,
      color: { hex: '0066CC' },
      align: 'center',
      verticalAlign: 'top',
      insetPoints: 6,
    });
    expect(element.rows[0].cells.map((cell) => cell.formatting)).toEqual([
      undefined,
      undefined,
    ]);

    const { opts, rows } = await addTable(props);
    expect(opts).toMatchObject({
      fontSize: 14,
      fontFace: 'Georgia',
      color: '0066CC',
      align: 'center',
      valign: 'top',
      margin: 6,
    });
    expect(rows[0][0].options).toBeUndefined();
  });

  it('defaults the size to the theme and the vertical alignment to middle', async () => {
    const element = await compileTable({});

    expect(element.defaults.fontSize).toBe(12);
    expect(element.defaults.fontFamily).toBe('Inter');
    expect(element.defaults.verticalAlign).toBe('middle');
    expect(element.defaults.align).toBeUndefined();
    expect(element.defaults.color).toBeUndefined();
  });

  it('records only the properties a cell overrides', async () => {
    const props = {
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
    };
    const cell = (await compileTable(props)).rows[0].cells[0];

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

    expect((await addTable(props)).rows[0][0].options).toEqual({
      color: 'FFFFFF',
      fontSize: 10,
      fontFace: 'Georgia',
      italic: true,
      align: 'right',
      valign: 'bottom',
      margin: [1, 2, 3, 4],
      colspan: 2,
      rowspan: 3,
      fill: { color: '0066CC' },
    });
  });

  it('resolves a theme colour token on the table and on a cell', async () => {
    const element = await compileTable({
      color: 'text',
      rows: [[{ text: 'a', color: 'primary', fill: 'background' }]],
    });

    expect(element.defaults.color).toEqual({ hex: '000000' });
    expect(element.rows[0].cells[0].formatting?.color).toEqual({
      hex: '0066CC',
    });
    expect(element.rows[0].cells[0].fill).toEqual({ hex: 'FFFFFF' });
  });
});

/**
 * VS15 used to be appended by the writer; it is a property of how the format
 * is rendered rather than of any one backend, so the compiler applies it and
 * the IR carries the already-suffixed text.
 */
describe('emoji variation selector', () => {
  it('forces text presentation on emoji-prone characters in a string cell', async () => {
    const element = await compileTable({ rows: [['✓ done', '★ starred']] });

    expect(element.rows[0].cells[0].text).toBe('✓\uFE0E done');
    expect(element.rows[0].cells[1].text).toBe('★\uFE0E starred');
  });

  it('forces text presentation in an object cell too', async () => {
    const element = await compileTable({
      rows: [[{ text: '⚠ warning', bold: true }]],
    });

    expect(element.rows[0].cells[0].text).toBe('⚠\uFE0E warning');
  });

  it('suffixes every occurrence and leaves ordinary text alone', async () => {
    const element = await compileTable({ rows: [['✓ a ✓ b', 'plain text']] });

    expect(element.rows[0].cells[0].text).toBe('✓\uFE0E a ✓\uFE0E b');
    expect(element.rows[0].cells[1].text).toBe('plain text');
  });

  it('carries the suffixed text through to the emitted cell', async () => {
    const { rows } = await addTable({ rows: [['✓ done']] });
    expect(rows[0][0].text).toBe('✓\uFE0E done');
  });
});

/**
 * OOXML tables have no corner radius. The IR records the request in inches;
 * realising it with background shapes and transparent corner cells is the
 * PptxGenJS adapter's technique, so that half is asserted on the emitted calls.
 */
describe('borderRadius background shapes', () => {
  const roundedProps = {
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
  };

  it('records the radius in inches on the IR and nothing about the technique', async () => {
    const element = await compileTable(roundedProps);

    expect(element.cornerRadiusInches).toBe(0.2);
    expect(element.columnWidthsEmu).toEqual([
      2 * EMU_PER_INCH,
      3 * EMU_PER_INCH,
    ]);
  });

  it('draws a rounded header block and a rounded body block behind the table', async () => {
    const { shapes } = await addTable(roundedProps);

    expect(shapes).toHaveLength(4);
    const [header, headerPatch, body, bodyPatch] = shapes;

    expect(header[0]).toBe('roundRect');
    expect(header[1]).toMatchObject({
      x: 1,
      y: 2,
      w: 5,
      h: 0.5,
      fill: { color: '0066CC' },
      rectRadius: 0.2,
      line: { type: 'none' },
    });
    // Flat patch over the header's lower corners, so only the outer four
    // corners stay round.
    expect(headerPatch[0]).toBe('rect');
    expect(headerPatch[1]).toMatchObject({
      x: 1,
      y: 2 + 0.5 - 0.2,
      w: 5,
      h: 0.2,
      fill: { color: '0066CC' },
    });

    expect(body[0]).toBe('roundRect');
    expect(body[1]).toMatchObject({
      x: 1,
      y: 2.5,
      w: 5,
      h: 1.3 - 0.5,
      fill: { color: 'FFFFFF' },
      rectRadius: 0.2,
    });
    expect(bodyPatch[0]).toBe('rect');
    expect(bodyPatch[1]).toMatchObject({ x: 1, y: 2.5, w: 5, h: 0.2 });
  });

  it('leaves the corner cells transparent and fills every other cell', async () => {
    const { rows } = await addTable(roundedProps);

    // Header corners and last-row corners show the shapes through. They still
    // carry an options bag (the borders), so an absent `fill` is a real
    // opt-out rather than a cell that was emitted bare.
    expect(rows[0][0].options).toHaveProperty('border');
    expect(rows[0][0].options?.fill).toBeUndefined();
    expect(rows[0][1].options?.fill).toBeUndefined();
    expect(rows[2][0].options?.fill).toBeUndefined();
    expect(rows[2][1].options?.fill).toBeUndefined();
    // Middle-row cells stay opaque so no seam shows between them.
    expect(rows[1][0].options?.fill).toEqual({ color: 'FFFFFF' });
    expect(rows[1][1].options?.fill).toEqual({ color: 'FFFFFF' });
  });

  it('suppresses the table outline and sizes the table to the column sum', async () => {
    const { opts } = await addTable(roundedProps);

    expect(opts.border).toEqual([
      { type: 'none' },
      { type: 'none' },
      { type: 'none' },
      { type: 'none' },
    ]);
    expect(emuToInches(opts.w as number)).toBe(5);
  });

  it('drops the outer edges and the header seam from the per-cell borders', async () => {
    const { rows } = await addTable({
      ...roundedProps,
      border: { type: 'solid', pt: 1, color: '000000' },
    });
    const none = { type: 'none', pt: 0 };
    const inner = { type: 'solid', pt: 1, color: '000000' };

    // [top, right, bottom, left]: the header row has no top, no bottom (the
    // seam) and no outer side; the middle row keeps its inner edges.
    expect(rows[0][0].options?.border).toEqual([none, inner, none, none]);
    expect(rows[1][0].options?.border).toEqual([none, inner, inner, none]);
    expect(rows[1][1].options?.border).toEqual([none, none, inner, inner]);
    expect(rows[2][1].options?.border).toEqual([inner, none, none, inner]);
  });

  it('keeps the table-level border when no radius is asked for', async () => {
    const element = await compileTable({
      border: { type: 'dash', pt: 2, color: 'primary' },
    });

    expect(element.cornerRadiusInches).toBeUndefined();
    expect(element.border).toEqual({
      type: 'dash',
      widthPoints: 2,
      color: { hex: '0066CC' },
    });
    expect(
      (await addTable({ border: { type: 'dash', pt: 2, color: 'primary' } }))
        .opts.border
    ).toEqual({ type: 'dash', pt: 2, color: '0066CC' });
  });
});

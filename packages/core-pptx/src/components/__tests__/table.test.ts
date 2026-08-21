import { describe, it, expect, vi } from 'vitest';
import { renderTableComponent } from '../table';

function mockSlide() {
  return { addTable: vi.fn(), addShape: vi.fn() } as any;
}

const theme = {
  colors: { primary: '#0066cc', text: '#000000', background: '#FFFFFF' },
  fonts: { heading: 'Geist', body: 'Inter' },
  defaults: { fontSize: 12, fontColor: 'text' },
} as any;

function addTable(props: any) {
  const slide = mockSlide();
  renderTableComponent(
    slide,
    { rows: [['a']], ...props },
    theme,
    undefined,
    []
  );
  const [rows, opts] = slide.addTable.mock.calls[0];
  return { rows, opts };
}

/**
 * A PPTX table cell carries no numeric weight either, so a table-level
 * `fontWeight` resolves the same way a run does: sub-family alias for
 * non-RIBBI, bold toggle for 700. pptxgenjs cascades table-level `fontFace`
 * and `bold` into every cell that sets neither.
 */
describe('renderTableComponent table-level fontWeight', () => {
  it('aliases the default face to the sub-family for a non-RIBBI weight', () => {
    const { opts } = addTable({ fontFace: 'Inter', fontWeight: 300 });

    expect(opts.fontFace).toBe('Inter Light');
    expect(opts.bold).toBeUndefined();
  });

  it('falls back to the theme body font when no face is given', () => {
    const { opts } = addTable({ fontWeight: 500 });

    expect(opts.fontFace).toBe('Inter Medium');
  });

  it('keeps the canonical family and sets bold at 700', () => {
    const { opts } = addTable({ fontFace: 'Inter', fontWeight: 700 });

    expect(opts.fontFace).toBe('Inter');
    expect(opts.bold).toBe(true);
  });

  it('leaves the face untouched when no weight is given', () => {
    const { opts } = addTable({ fontFace: 'Inter' });

    expect(opts.fontFace).toBe('Inter');
    expect(opts.bold).toBeUndefined();
  });

  it('aliases a cell weight off the un-synthesized table family', () => {
    // The cell must not inherit "Inter Light" as its base, or its own weight
    // would stack a second suffix onto an already-synthesized name.
    const { rows, opts } = addTable({
      fontFace: 'Inter',
      fontWeight: 300,
      rows: [[{ text: 'a', fontWeight: 600 }, { text: 'b', bold: true }, 'c']],
    });

    expect(rows[0][0].options.fontFace).toBe('Inter SemiBold');
    expect(rows[0][1].options).toMatchObject({ fontFace: 'Inter', bold: true });
    // The plain-string cell has no options of its own and inherits the alias.
    expect(rows[0][2].options).toBeUndefined();
    expect(opts.fontFace).toBe('Inter Light');
  });
});

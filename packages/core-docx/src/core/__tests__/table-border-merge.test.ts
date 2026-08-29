/**
 * Border merge semantics: a stated side owns its edge.
 *
 * Two rules, pinned end to end because both renderers emit whatever the table
 * model resolves (see `tableModel.ts`):
 *
 * - A side named in a per-side `borderColor`/`borderSize` object on the cell
 *   or its column is explicit: it survives `hideBorders`, which only silences
 *   inherited table-level borders. A scalar `borderColor`/`borderSize` is a
 *   restyling knob, not a claim on any side.
 * - No contested interior edge leaves the model. When two facing cell sides
 *   disagree, the winner — explicit beats inherited, equals fall to OOXML's
 *   weight rules (ECMA-376 §17.4.66) — is mirrored onto both cells. Word and
 *   LibreOffice resolve conflicts differently (a stated red divider used to
 *   render in Word and vanish in a LibreOffice preview of the same bytes), so
 *   the only portable output is one with no conflict left to resolve.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../generator';

type Side = { val: string; color: string; sz: string };
type CellBorders = Record<'top' | 'left' | 'bottom' | 'right', Side>;

async function cellBorders(
  props: Record<string, unknown>
): Promise<CellBorders[]> {
  const buffer = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'table', props }],
  } as never);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');

  return [...xml.matchAll(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/g)].map(
    (cell) => {
      const borders = {} as CellBorders;
      for (const side of [
        ...cell[1].matchAll(
          /<w:(top|left|bottom|right)\s+w:val="([^"]*)"\s+w:color="([^"]*)"\s+w:sz="([^"]*)"/g
        ),
      ]) {
        borders[side[1] as keyof CellBorders] = {
          val: side[2],
          color: side[3],
          sz: side[4],
        };
      }
      return borders;
    }
  );
}

/** The vermilion-annual-report pattern, without its both-sides workaround. */
const GRID = {
  borderColor: 'C7C8CA',
  borderSize: 0.5,
  hideBorders: { left: true, right: true, top: true },
};

describe('table border merge', () => {
  it('mirrors a named side onto the neighbouring half of its edge', async () => {
    // Header cells 0-2, body row cells 3-5. The named red sides win their
    // shared edges outright; nothing is left for a consumer to resolve.
    const cells = await cellBorders({
      ...GRID,
      columns: [
        {
          header: { content: 'Metric', borderColor: { bottom: 'EF4130' } },
          cells: [{ content: 'Revenue', borderColor: { right: 'EF4130' } }],
        },
        { header: { content: 'FY24' }, cells: [{ content: '10' }] },
        { header: { content: 'FY25' }, cells: [{ content: '30' }] },
      ],
    });

    const red = { val: 'single', color: 'EF4130', sz: '4' };
    expect(cells[0].bottom).toEqual(red);
    expect(cells[3].top).toEqual(red); // mirrored from the header's bottom
    expect(cells[3].right).toEqual(red);
    expect(cells[4].left).toEqual(red); // mirrored from the neighbour's right
    // The unnamed grid stays the table's grey.
    expect(cells[4].bottom).toEqual({
      val: 'single',
      color: 'C7C8CA',
      sz: '4',
    });
  });

  it('lets a named side beat hideBorders, and keeps scalars as knobs', async () => {
    const cells = await cellBorders({
      ...GRID,
      columns: [
        {
          header: { content: 'A' },
          // Scalar size and colour restyle the visible sides only: the hidden
          // left stays hidden even though a scalar touches every side.
          cells: [{ content: 'a', borderColor: '4B5563', borderSize: 1 }],
        },
        {
          header: { content: 'B' },
          // The named right side keeps its border on the very edge
          // `hideBorders` hides.
          cells: [{ content: 'b', borderColor: { right: 'EF4130' } }],
        },
      ],
    });

    expect(cells[0].top.val).toBe('none');
    expect(cells[2].left.val).toBe('none');
    expect(cells[2].bottom).toEqual({
      val: 'single',
      color: '4B5563',
      sz: '8',
    });
    expect(cells[3].right).toEqual({ val: 'single', color: 'EF4130', sz: '4' });
  });

  it('lets a named zero size silence the inherited edge', async () => {
    const cells = await cellBorders({
      borderColor: '999999',
      borderSize: 1,
      columns: [
        {
          header: { content: 'A' },
          cells: [{ content: 'a' }, { content: 'b', borderSize: { top: 0 } }],
        },
      ],
    });

    // Cell `a`'s inherited grey bottom yields to the named "no border".
    expect(cells[1].bottom.val).toBe('none');
    expect(cells[2].top.val).toBe('none');
  });

  it('resolves clashes by explicitness, then the OOXML weight rules', async () => {
    const cells = await cellBorders({
      borderColor: '999999',
      borderSize: 1,
      columns: [
        {
          header: { content: 'A' },
          cells: [
            // vs its right neighbour: equal sizes, so the darker colour
            // (336699: R+B+2G = 408 < FF9900: 561) wins the edge.
            { content: 'a', borderColor: { right: 'FF9900' } },
            // vs the cell above, whose bottom is only inherited: named wins,
            // and its named width rides along.
            {
              content: 'c',
              borderColor: { top: '999999' },
              borderSize: { top: 2 },
            },
          ],
        },
        {
          header: { content: 'B' },
          cells: [
            { content: 'b', borderColor: { left: '336699' } },
            { content: 'd' },
          ],
        },
      ],
    });

    expect(cells[2].right).toEqual({ val: 'single', color: '336699', sz: '8' });
    expect(cells[3].left).toEqual({ val: 'single', color: '336699', sz: '8' });
    expect(cells[2].bottom).toEqual({
      val: 'single',
      color: '999999',
      sz: '16',
    });
    expect(cells[4].top).toEqual({ val: 'single', color: '999999', sz: '16' });
  });

  it('resolves differing inherited halves the same way', async () => {
    // Neither side is named on a cell or column: the header's table-level
    // blue bottom against the body's grey top falls to the weight rules, and
    // blue (brightness 255) is darker than grey (801).
    const cells = await cellBorders({
      borderColor: 'C7C8CA',
      borderSize: 0.5,
      headerCellDefaults: { borderColor: { bottom: '0000FF' } },
      columns: [{ header: { content: 'A' }, cells: [{ content: 'a' }] }],
    });

    const blue = { val: 'single', color: '0000FF', sz: '4' };
    expect(cells[0].bottom).toEqual(blue);
    expect(cells[1].top).toEqual(blue);
  });

  it('keeps edges hidden when nobody names them', async () => {
    const cells = await cellBorders({
      borderColor: '999999',
      hideBorders: { insideVertical: true },
      columns: [
        { header: { content: 'A' }, cells: [{ content: 'a' }] },
        { header: { content: 'B' }, cells: [{ content: 'b' }] },
      ],
    });

    expect(cells[0].right.val).toBe('none');
    expect(cells[1].left.val).toBe('none');
    expect(cells[2].right.val).toBe('none');
    expect(cells[3].left.val).toBe('none');
  });
});

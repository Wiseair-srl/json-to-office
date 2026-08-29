/**
 * A cell's `font.lineSpacing` drives the cell paragraph's line spacing —
 * per-cell row-height control the theme's tableCell style can only set
 * table-wide. The cell's own value wins over the theme, cascades through
 * `cellDefaults`/`headerCellDefaults` like every other font field, and leaves
 * untouched cells on the theme's spacing.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../generator';

async function cellSpacings(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  const cells = xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
  return cells.map((cell) => cell.match(/<w:spacing[^/]*\/>/)?.[0] ?? '');
}

function tableDoc(props: Record<string, unknown>) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'table', props }],
  } as never;
}

describe('table cell font.lineSpacing', () => {
  it('sets exact line spacing on that cell only', async () => {
    const spacings = await cellSpacings(
      await generateBufferFromJson(
        tableDoc({
          columns: [
            {
              header: { content: 'H' },
              cells: [
                {
                  content: 'dense',
                  font: {
                    size: 9,
                    lineSpacing: { type: 'exactly', value: 30 },
                  },
                },
                { content: 'normal' },
              ],
            },
          ],
        })
      )
    );
    // [header, dense, normal]: 30pt = 600 twips, rule `exact`; the others
    // keep the theme's single spacing (240 twips, rule `auto`).
    expect(spacings[1]).toContain('w:line="600"');
    expect(spacings[1]).toContain('w:lineRule="exact"');
    for (const other of [spacings[0], spacings[2]]) {
      expect(other).toContain('w:line="240"');
      expect(other).toContain('w:lineRule="auto"');
    }
  });

  it('cascades from cellDefaults and headerCellDefaults', async () => {
    const spacings = await cellSpacings(
      await generateBufferFromJson(
        tableDoc({
          cellDefaults: {
            font: { lineSpacing: { type: 'exactly', value: 20 } },
          },
          headerCellDefaults: {
            font: { lineSpacing: { type: 'atLeast', value: 15 } },
          },
          columns: [{ header: { content: 'H' }, cells: [{ content: 'A' }] }],
        })
      )
    );
    expect(spacings[0]).toContain('w:line="300"');
    expect(spacings[0]).toContain('w:lineRule="atLeast"');
    expect(spacings[1]).toContain('w:line="400"');
    expect(spacings[1]).toContain('w:lineRule="exact"');
  });

  it('renders identically through the office-open renderer', async () => {
    const doc = tableDoc({
      columns: [
        {
          header: { content: 'H' },
          cells: [
            {
              content: 'dense',
              font: { lineSpacing: { type: 'exactly', value: 30 } },
            },
          ],
        },
      ],
    });
    const spacings = await cellSpacings(
      await generateBufferFromJson(doc, { renderer: 'office-open' })
    );
    expect(spacings[1]).toContain('w:line="600"');
    expect(spacings[1]).toContain('w:lineRule="exact"');
  });
});

/**
 * Regression: table cell `color` and `backgroundColor` resolve theme color names
 * like paragraph/heading font colors do. They used to be forwarded raw to OOXML,
 * so "primary" reached docx as a bogus hex value and crashed. See createTable in
 * core/content.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../generator';

// minimal theme: accent #2c3e50, secondary #666666
const ACCENT = '2C3E50';
const SECONDARY = '666666';

async function readDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('no word/document.xml');
  return part.async('string');
}

function tableDocument(props: Record<string, unknown>) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'table', props }],
  } as any;
}

describe('table cell colors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves theme color names in header and body cells', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(
        tableDocument({
          headerCellDefaults: { backgroundColor: 'accent', color: 'secondary' },
          cellDefaults: { backgroundColor: 'backgroundSecondary' },
          columns: [{ header: { content: 'H1' }, cells: [{ content: 'A1' }] }],
        })
      )
    );

    expect(xml).toContain(`w:fill="${ACCENT}"`);
    expect(xml).toContain(`w:val="${SECONDARY}"`);
    expect(xml).toContain('w:fill="FAFAFA"'); // backgroundSecondary
    expect(xml).not.toContain('w:fill="accent"');
  });

  it('resolves theme color names set on an individual cell', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(
        tableDocument({
          columns: [
            {
              header: { content: 'H1' },
              cells: [{ content: 'A1', backgroundColor: 'accent' }],
            },
          ],
        })
      )
    );

    expect(xml).toContain(`w:fill="${ACCENT}"`);
  });

  it('still accepts explicit hex colors', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(
        tableDocument({
          headerCellDefaults: { backgroundColor: '#ff0000', color: '#00FF00' },
          columns: [{ header: { content: 'H1' }, cells: [{ content: 'A1' }] }],
        })
      )
    );

    expect(xml).toContain('w:fill="FF0000"');
    expect(xml).toContain('w:val="00FF00"');
  });

  it('keeps "transparent" backgrounds unshaded', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(
        tableDocument({
          cellDefaults: { backgroundColor: 'transparent' },
          columns: [{ header: { content: 'H1' }, cells: [{ content: 'A1' }] }],
        })
      )
    );

    expect(xml).not.toContain('w:shd');
  });

  it('still accepts "auto"', async () => {
    // "auto" is the only non-hex value OOXML accepts, so documents using it
    // rendered fine before theme resolution existed and must keep doing so.
    const xml = await readDocumentXml(
      await generateBufferFromJson(
        tableDocument({
          columns: [
            {
              header: { content: 'H1' },
              cells: [
                { content: 'A1', backgroundColor: 'auto', color: 'auto' },
              ],
            },
          ],
        })
      )
    );

    expect(xml).toContain('w:fill="auto"');
    expect(xml).toContain('w:val="auto"');
  });

  it('drops "transparent" on the font color and warns', async () => {
    // Only backgroundColor has a transparent sentinel; w:color w:val="transparent"
    // is invalid OOXML.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await readDocumentXml(
      await generateBufferFromJson(
        tableDocument({
          columns: [
            {
              header: { content: 'H1' },
              cells: [{ content: 'A1', color: 'transparent' }],
            },
          ],
        })
      )
    );

    expect(xml).not.toContain('transparent');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('TABLE_CELL_COLOR_INVALID')
    );
  });

  it('reports an unknown color name clearly', async () => {
    // docx rejects any non-hex, non-"auto" value anyway, so passing it through
    // would only trade this message for an opaque one from inside docx.
    await expect(
      generateBufferFromJson(
        tableDocument({
          columns: [
            {
              header: { content: 'H1' },
              cells: [{ content: 'A1', color: 'notacolor' }],
            },
          ],
        })
      )
    ).rejects.toThrow(/Invalid table cell color: "notacolor"/);
  });
});

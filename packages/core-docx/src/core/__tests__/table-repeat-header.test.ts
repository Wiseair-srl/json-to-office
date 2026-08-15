/**
 * Regression: `repeatHeaderOnPageBreak` defaults to true. The renderer used to
 * forward the raw (possibly undefined) prop to docx, so header rows never
 * repeated across page breaks unless the prop was set explicitly — contradicting
 * the schema default. See createTable in core/content.ts.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../generator';

async function readDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('no word/document.xml');
  return part.async('string');
}

function tableDocument(repeatHeaderOnPageBreak?: boolean) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'table',
        props: {
          ...(repeatHeaderOnPageBreak !== undefined && {
            repeatHeaderOnPageBreak,
          }),
          columns: [
            { header: { content: 'H1' }, cells: [{ content: 'A1' }] },
            { header: { content: 'H2' }, cells: [{ content: 'B1' }] },
          ],
        },
      },
    ],
  } as any;
}

describe('table repeatHeaderOnPageBreak', () => {
  it('marks the header row as repeating when the prop is omitted', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(tableDocument())
    );
    // docx omits w:val when the flag is true
    expect(xml).toMatch(/<w:tblHeader\s*\/>/);
  });

  it('marks the header row as repeating when set to true', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(tableDocument(true))
    );
    expect(xml).toMatch(/<w:tblHeader\s*\/>/);
  });

  it('disables repetition when explicitly set to false', async () => {
    const xml = await readDocumentXml(
      await generateBufferFromJson(tableDocument(false))
    );
    expect(xml).toMatch(/<w:tblHeader w:val="false"\s*\/>/);
    expect(xml).not.toMatch(/<w:tblHeader\s*\/>/);
  });
});

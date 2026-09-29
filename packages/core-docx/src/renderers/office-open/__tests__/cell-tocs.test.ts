/**
 * A table of contents in a table cell, which the backend used to drop.
 *
 * `@office-open/docx` 0.11.0 wrote a table cell's paragraphs and tables and
 * nothing else: `stringifyCellChild` answered any other child with an empty
 * string, and the adapter put the field back with a splice after rendering.
 * 0.14 writes one in a cell as it does in the body, which the first test pins
 * against the real package; the second pins the same through the renderer.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';

const CONTENT_CONTROL = /<w:sdt>[\s\S]*?<\/w:sdt>/g;

describe('a table of contents in a table cell', () => {
  it('is written by the backend in a cell as in the body', async () => {
    const { generateDocument } = await import('@office-open/docx');
    const toc = { alias: 'Contents', headingStyleRange: '1-3' };
    const bytes = await generateDocument(
      {
        sections: [
          {
            children: [
              { toc },
              { table: { rows: [{ cells: [{ children: [{ toc }] }] }] } },
            ],
          },
        ],
      },
      { type: 'uint8array' }
    );
    const xml = new AdmZip(Buffer.from(bytes)).readAsText('word/document.xml');

    // Both are written, byte for byte the same.
    const [inBody, inCell, ...more] = xml.match(CONTENT_CONTROL) ?? [];
    expect(more).toEqual([]);
    expect(inCell).toBe(inBody);
    // And the second is inside the cell.
    expect(xml).toMatch(/<w:tc\b(?:(?!<\/w:tc>)[\s\S])*<w:sdt>/);
  });

  it('comes out as the backend writes it in the body', async () => {
    const toc = { name: 'toc', props: { title: 'Contents' } };
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        toc,
        { name: 'text-box', props: {}, children: [toc] },
        { name: 'heading', props: { level: 1, text: 'Alpha' } },
        { name: 'heading', props: { level: 2, text: 'Beta' } },
      ],
    };
    const { buffer } = await generateBufferViaIr(document as never, {
      renderer: 'office-open',
      warnings: [],
    });
    const xml = new AdmZip(buffer).readAsText('word/document.xml');
    const [inBody, inCell, ...more] = xml.match(CONTENT_CONTROL) ?? [];

    expect(more).toEqual([]);
    expect(inBody).toContain('<w:t xml:space="preserve">Beta</w:t>');
    expect(inCell).toBe(inBody);
    expect(xml).toContain(`${inCell}<w:p/></w:tc>`);
  });
});

/**
 * A table of contents in a table cell, which the backend drops and this
 * adapter puts back.
 *
 * `@office-open/docx` 0.11.0 writes a table cell's paragraphs and tables and
 * nothing else: `stringifyCellChild` answers any other child with an empty
 * string. The first test pins that against the real package — if it starts
 * writing a table of contents in a cell, it fails, and the splice can go. The
 * rest pin what the splice promises: the bytes the backend writes for the same
 * table of contents in the body, or a failed render rather than marker text
 * left in the document.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import { spliceCellTocs } from '../cellTocs';
import type { CellToc } from '../emit';

const CONTENT_CONTROL = /<w:sdt>[\s\S]*?<\/w:sdt>/g;

describe('a table of contents in a table cell', () => {
  it('is still dropped by the backend', async () => {
    const { generateDocument } = (await import('@office-open/docx')) as {
      generateDocument: (
        options: Record<string, unknown>,
        packer?: { type?: string }
      ) => Promise<Uint8Array>;
    };
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

    // The one in the body is written; the one in the cell is not.
    expect(xml.match(CONTENT_CONTROL)).toHaveLength(1);
    expect(xml).toMatch(/<\/w:sdt><w:tbl>/);
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

describe('the cell table-of-contents splice', () => {
  const toc: CellToc = {
    start: '[start]',
    end: '[end]',
    alias: 'Contents',
    options: { hyperlink: true },
  };
  const marker = (text: string): string =>
    `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const inCell = (content: string): string =>
    `<w:body><w:tbl><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl></w:body>`;
  const zipWith = (content: string, part = 'word/document.xml'): AdmZip => {
    const zip = new AdmZip();
    zip.addFile(part, Buffer.from(inCell(content)));
    return zip;
  };
  const write = (alias?: string, options?: object, entries?: string): string =>
    `<w:sdt>${JSON.stringify({ alias, options })}${entries}</w:sdt>`;

  it('writes the field in place of the markers, around what is between', () => {
    for (const part of ['word/document.xml', 'word/footer2.xml']) {
      const zip = zipWith(
        `${marker('[start]')}<w:p>entry</w:p>${marker('[end]')}<w:p/>`,
        part
      );
      spliceCellTocs(zip, [toc], write);

      expect(zip.readAsText(part)).toBe(
        inCell(
          '<w:sdt>{"alias":"Contents","options":{"hyperlink":true}}' +
            '<w:p>entry</w:p></w:sdt><w:p/>'
        )
      );
    }
  });

  it('fails rather than ship a marker without its partner', () => {
    expect(() =>
      spliceCellTocs(zipWith(marker('[start]')), [toc], write)
    ).toThrow(/lost track of a table of contents/);
  });

  it('fails rather than ship a marker it finds twice', () => {
    expect(() =>
      spliceCellTocs(
        zipWith(marker('[start]') + marker('[start]') + marker('[end]')),
        [toc],
        write
      )
    ).toThrow(/marker it did not write/);
  });

  it('fails when it finds no marker at all', () => {
    expect(() => spliceCellTocs(zipWith('<w:p/>'), [toc], write)).toThrow(
      /placed 1 table\(s\) of contents in table cells and found 0/
    );
  });
});

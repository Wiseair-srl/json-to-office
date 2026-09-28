/**
 * Drawings must end up with `wp:docPr/@id` values that are unique across the
 * package and the same on every build.
 *
 * docx 9.7.1 wrote `id="1"` on every drawing outside `document.xml`; 9.8.0
 * draws ids from one counter shared by the whole process, so they depend on
 * what was built before. `fixFloatingImageIdsInBuffer` renumbers them during
 * packaging. Nothing else asserts the outcome, which is what makes a
 * silently-failing renumber pass so dangerous: Word shows a repair prompt while
 * the whole suite stays green.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { fixFloatingImageIdsInBuffer } from '../utils/fixFloatingImageIds';
import AdmZip from 'adm-zip';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function floatingImage(offset: number) {
  return {
    name: 'image',
    props: {
      base64: PNG,
      width: 80,
      height: 80,
      floating: {
        horizontalPosition: { relative: 'page', offset: 1000 },
        verticalPosition: { relative: 'page', offset: offset },
        wrap: { type: 'none' },
      },
    },
  };
}

function docPrIds(xml: string): string[] {
  return Array.from(xml.matchAll(/<wp:docPr\b[^>]*?\sid="(\d+)"/g)).map(
    (m) => m[1]
  );
}

describe('floating image wp:docPr ids', () => {
  it('renumbers every floating image to a unique id', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        floatingImage(1000),
        floatingImage(3000),
        floatingImage(5000),
        floatingImage(7000),
      ],
    } as any);

    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    const ids = docPrIds(xml);

    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renumbers ids that are not the first attribute on wp:docPr', () => {
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<w:document>' +
          '<wp:docPr descr="a" id="1" name="Image 1"/>' +
          '<wp:docPr name="Image 2" id="1"/>' +
          '<wp:docPr id="1" name="Image 3"/>' +
          '</w:document>',
        'utf8'
      )
    );

    const xml = new AdmZip(fixFloatingImageIdsInBuffer(zip.toBuffer()))
      .getEntry('word/document.xml')!
      .getData()
      .toString('utf8');
    const ids = docPrIds(xml);

    expect(ids).toEqual(['1', '2', '3']);
    // Attribute order must survive the rewrite.
    expect(xml).toContain('<wp:docPr descr="a" id="1" name="Image 1"/>');
    expect(xml).toContain('<wp:docPr name="Image 2" id="2"/>');
  });

  it('leaves attributes whose name merely ends in "id" alone', () => {
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<wp:docPr wp14:anchorId="0A1B2C3D" id="1" name="Image 1"/>',
        'utf8'
      )
    );

    const xml = new AdmZip(fixFloatingImageIdsInBuffer(zip.toBuffer()))
      .getEntry('word/document.xml')!
      .getData()
      .toString('utf8');

    expect(xml).toBe(
      '<wp:docPr wp14:anchorId="0A1B2C3D" id="1" name="Image 1"/>'
    );
  });

  it('numbers one sequence across parts: body, headers and footers by number, notes, comments', () => {
    const zip = new AdmZip();
    const part = (name: string, count: number) =>
      zip.addFile(
        name,
        Buffer.from(
          `<w:x>${'<wp:docPr id="7" name=""/>'.repeat(count)}</w:x>`,
          'utf8'
        )
      );
    // Added out of order on purpose: the zip order must not decide the ids.
    part('word/header10.xml', 1);
    part('word/comments.xml', 1);
    part('word/footer1.xml', 1);
    part('word/header2.xml', 2);
    part('word/footnotes.xml', 1);
    part('word/document.xml', 2);
    part('word/styles.xml', 1); // not a drawing part: left alone

    const fixed = new AdmZip(fixFloatingImageIdsInBuffer(zip.toBuffer()));
    const ids = (name: string) =>
      docPrIds(fixed.getEntry(name)!.getData().toString('utf8'));

    expect(ids('word/document.xml')).toEqual(['1', '2']);
    expect(ids('word/header2.xml')).toEqual(['3', '4']);
    expect(ids('word/header10.xml')).toEqual(['5']);
    expect(ids('word/footer1.xml')).toEqual(['6']);
    expect(ids('word/footnotes.xml')).toEqual(['7']);
    expect(ids('word/comments.xml')).toEqual(['8']);
    expect(ids('word/styles.xml')).toEqual(['7']);
  });

  it('gives header and footer drawings ids of their own, whatever ran before', async () => {
    const withChrome = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {
            header: [floatingImage(500), floatingImage(900)],
            footer: [floatingImage(15000)],
          },
          children: [floatingImage(3000)],
        },
      ],
    } as any;
    const ids = async () => {
      const zip = await JSZip.loadAsync(
        await generateBufferFromJson(structuredClone(withChrome))
      );
      const read = async (name: string) =>
        docPrIds((await zip.file(name)?.async('string')) ?? '');
      return [
        ...(await read('word/document.xml')),
        ...(await read('word/header1.xml')),
        ...(await read('word/footer1.xml')),
      ];
    };

    const first = await ids();
    // Move docx's process-wide drawing counter on before building again.
    await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: Array.from({ length: 5 }, (_, i) => floatingImage(i * 1000)),
    } as any);
    const second = await ids();

    expect(first).toEqual(['1', '2', '3', '4']);
    expect(second).toEqual(first);
  }, 60_000);
});

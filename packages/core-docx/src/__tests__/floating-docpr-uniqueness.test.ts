/**
 * Floating images must end up with unique `wp:docPr/@id` values.
 *
 * docx emits `id="1"` for every floating image, so `fixFloatingImageIdsInBuffer`
 * renumbers them during packaging. Nothing else asserts the outcome, which is
 * what makes a silently-failing renumber pass so dangerous: Word shows a repair
 * prompt while the whole suite stays green.
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
});

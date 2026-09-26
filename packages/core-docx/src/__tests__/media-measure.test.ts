/**
 * A drawing in a text box, sized to the box, as the backends write it.
 *
 * An image that states no width takes the whole measure, and a percentage is
 * a share of it. Sized against the page, an image in a text box padded 72pt a
 * side came out two inches wider than the box in every reader, since a
 * drawing's `wp:extent` is an absolute size. What is asserted is that extent:
 * the box's content width, on both backends for an image and a shape, and on
 * `office-open` — the backend that draws them — for a native visual and chart.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../core/generateFromIr';
import { inchesToEmu, pixelsToEmu, twipsToPixels } from '../ir/units';
import type { DocxRendererId } from '../renderers/types';
import { PNG_4X2 } from './fixtures/corpus-blocks';

const attribute = (tag: string, name: string): string =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

/** The width of the box's content: the page's measure less 72pt a side. */
function boxContent(xml: string): number {
  const size = /<w:pgSz\b[^>]*>/.exec(xml)![0];
  const margins = /<w:pgMar\b[^>]*>/.exec(xml)![0];
  return (
    Number(attribute(size, 'w:w')) -
    Number(attribute(margins, 'w:left')) -
    Number(attribute(margins, 'w:right')) -
    Number(attribute(margins, 'w:gutter') || 0) -
    2 * 1440
  );
}

/** The width of the only drawing in the document, in EMU. */
const extentCx = (xml: string): number =>
  Number(/<wp:extent\b[^>]*\bcx="(\d+)"/.exec(xml)![1]);

async function boxed(
  child: Record<string, unknown>,
  renderer: DocxRendererId
): Promise<string> {
  const { buffer } = await generateBufferViaIr(
    {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'text-box',
              props: { style: { padding: { left: 72, right: 72 } } },
              children: [child],
            },
          ],
        },
      ],
    } as never,
    { renderer }
  );
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

describe.each<DocxRendererId>(['docxjs', 'office-open'])(
  'a drawing in a text box on %s',
  (renderer) => {
    it('fills the box with an image that states no width', async () => {
      const xml = await boxed(
        { name: 'image', props: { base64: PNG_4X2 } },
        renderer
      );

      expect(extentCx(xml)).toBe(
        pixelsToEmu(Math.round(twipsToPixels(boxContent(xml))))
      );
    });

    it("sizes a shape's percentage width against the box", async () => {
      const xml = await boxed(
        {
          name: 'text-box',
          props: { renderAs: 'shape', width: '50%', height: 100 },
          children: [{ name: 'paragraph', props: { text: 'Inside.' } }],
        },
        renderer
      );

      expect(extentCx(xml)).toBe(
        pixelsToEmu(Math.round((boxContent(xml) * 0.5) / 15))
      );
    });
  }
);

describe('a native drawing in a text box on office-open', () => {
  it("sizes a visual's percentage width against the box", async () => {
    const xml = await boxed(
      {
        name: 'visual',
        props: {
          renderMode: 'native',
          width: '100%',
          canvas: { width: 4, height: 2 },
          elements: [
            { name: 'shape', props: { type: 'rect', x: 0, y: 0, w: 1, h: 1 } },
          ],
        },
      },
      'office-open'
    );

    expect(extentCx(xml)).toBe(
      pixelsToEmu(Math.round(twipsToPixels(boxContent(xml))))
    );
  });

  it('gives a chart that states no width the box', async () => {
    const xml = await boxed(
      {
        name: 'chart',
        props: {
          type: 'bar',
          data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }],
        },
      },
      'office-open'
    );

    expect(extentCx(xml)).toBe(inchesToEmu(boxContent(xml) / 1440));
  });
});

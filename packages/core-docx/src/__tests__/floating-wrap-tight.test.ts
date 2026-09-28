/**
 * Tight wrapping on the docx.js backend.
 *
 * The authoring wrap types `around` and `through` compile to `wp:wrapTight`.
 * CT_WrapTight requires a `wrapText` side and a `wp:wrapPolygon`, and Word
 * refuses to open a package whose tight wrap lacks either. docx 9.7.1 wrote a
 * bare `<wp:wrapTight distT="0" distB="0"/>`: LibreOffice opened it, the
 * golden only pins bytes, and nothing here noticed. docx 9.8.0 writes the side
 * and a polygon over the drawing's full extent, in Word's 21600-unit polygon
 * space; this pins that shape.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferWithWarnings } from '../core/generator';
import { CORPUS } from './fixtures/corpus';

/** Word reads wrap polygon points in 21600ths of the drawing's extent. */
const POLYGON_SPACE = 21600;

/** Image 2 wraps around/left, image 3 through/right; the Word kit's case. */
const WRAP_VARIANTS = CORPUS.find(
  (c) => c.name === 'blocks/image-floating-wrap-variants'
)!.document;

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function documentXml(definition: unknown): Promise<string> {
  const { buffer } = await generateBufferWithWarnings(
    structuredClone(definition) as never,
    { renderer: 'docxjs', warnings: [] }
  );
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

const attributes = (text: string) =>
  Object.fromEntries(
    Array.from(text.matchAll(/([\w:]+)="([^"]*)"/g)).map((m) => [m[1], m[2]])
  );

/** Each `wp:wrapTight`: its attributes and whatever it contains. */
function tightWraps(xml: string) {
  return Array.from(
    xml.matchAll(/<wp:wrapTight\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wp:wrapTight>)/g)
  ).map((m) => ({ attributes: attributes(m[1]), body: m[2] ?? '' }));
}

/** The polygon's points, in order, by element name. */
function polygonPoints(body: string) {
  const polygon = /^<wp:wrapPolygon\b[^>]*>([\s\S]*)<\/wp:wrapPolygon>$/.exec(
    body
  );
  if (!polygon) return undefined;
  return Array.from(
    polygon[1].matchAll(/<(wp:start|wp:lineTo)\b([^>]*)\/>/g)
  ).map((m) => {
    const { x, y } = attributes(m[2]);
    return { name: m[1], x: Number(x), y: Number(y) };
  });
}

describe('tight wrapping on docx.js', () => {
  it('writes the authored side and a wrap polygon for around and through', async () => {
    const wraps = tightWraps(await documentXml(WRAP_VARIANTS));

    expect(wraps.map((w) => w.attributes.wrapText)).toEqual(['left', 'right']);
    for (const wrap of wraps) {
      // CT_WrapTight has wrapText, distL and distR; distT/distB are not allowed.
      expect(
        Object.keys(wrap.attributes).every((name) =>
          ['wrapText', 'distL', 'distR'].includes(name)
        )
      ).toBe(true);

      const points = polygonPoints(wrap.body);
      expect(points).toBeDefined();
      // CT_WrapPath: one start, then at least two lineTo.
      expect(points![0].name).toBe('wp:start');
      expect(points!.slice(1).every((p) => p.name === 'wp:lineTo')).toBe(true);
      expect(points!.length).toBeGreaterThanOrEqual(3);

      // The drawing's box in Word's polygon space, not EMUs or a flipped y.
      const xs = points!.map((p) => p.x);
      const ys = points!.map((p) => p.y);
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, POLYGON_SPACE]);
      expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, POLYGON_SPACE]);
    }
  });

  it('still refuses wrap.type tight stated directly', async () => {
    await expect(
      documentXml({
        name: 'docx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'image',
            props: {
              base64: PNG,
              width: 100,
              floating: { wrap: { type: 'tight' } },
            },
          },
        ],
      })
    ).rejects.toThrow("Image floating wrap.type 'tight' is not supported.");
  });
});

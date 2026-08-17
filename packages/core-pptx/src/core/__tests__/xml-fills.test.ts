import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { generateBufferFromJson } from '../generator';
import type { PresentationComponentDefinition } from '../../types';

async function slideXml(buffer: Buffer, slideNumber: number): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(`ppt/slides/slide${slideNumber}.xml`)!.async('string');
}

describe('gradient and pattern fill XML post-processing', () => {
  const document: PresentationComponentDefinition = {
    name: 'pptx',
    props: { title: 'Fill deck' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 1,
              w: 4,
              h: 2,
              fill: {
                gradient: {
                  type: 'linear',
                  angle: 45,
                  stops: [
                    { color: '0066CC', pos: 0 },
                    { color: 'FFFFFF', pos: 100, transparency: 30 },
                  ],
                },
              },
            },
          },
          {
            name: 'shape',
            props: {
              type: 'ellipse',
              x: 6,
              y: 1,
              w: 2,
              h: 2,
              fill: {
                gradient: {
                  type: 'radial',
                  focus: 'topLeft',
                  stops: [
                    { color: '112233', pos: 0 },
                    { color: '445566', pos: 100 },
                  ],
                },
              },
            },
          },
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 4,
              w: 4,
              h: 2,
              fill: {
                pattern: {
                  preset: 'ltUpDiag',
                  foreground: '336699',
                  background: 'FFFFFF',
                },
              },
            },
          },
        ],
      },
      {
        name: 'slide',
        props: {
          background: {
            gradient: {
              type: 'radial',
              focus: 'bottomRight',
              stops: [
                { color: '0066CC', pos: 0 },
                { color: '001133', pos: 100 },
              ],
            },
          },
        },
        children: [{ name: 'text', props: { text: 'On gradient' } }],
      },
    ],
  };

  it('splices gradFill and pattFill into the slide XML', async () => {
    const buffer = await generateBufferFromJson(document);
    const xml = await slideXml(buffer, 1);

    // Linear gradient: stops in 1000ths of a percent, angle in 60000ths deg.
    expect(xml).toContain(
      '<a:gradFill rotWithShape="1"><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="0066CC"></a:srgbClr></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="FFFFFF"><a:alpha val="70000"/></a:srgbClr></a:gs>' +
        '</a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>'
    );
    // Radial gradient with corner focus.
    expect(xml).toContain(
      '<a:path path="circle"><a:fillToRect l="0" t="0" r="100000" b="100000"/></a:path>'
    );
    // Pattern fill.
    expect(xml).toContain(
      '<a:pattFill prst="ltUpDiag"><a:fgClr><a:srgbClr val="336699"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
    );
    // Sentinel names never ship.
    expect(xml).not.toContain('__jto_fill_');
  });

  it('renders a slide background gradient as a full-bleed back rect', async () => {
    const buffer = await generateBufferFromJson(document);
    const xml = await slideXml(buffer, 2);

    expect(xml).toContain('<a:gradFill');
    expect(xml).toContain('<a:fillToRect l="100000" t="100000" r="0" b="0"/>');
    // Full-bleed rect: 10in x 7.5in in EMU.
    expect(xml).toContain('<a:ext cx="9144000" cy="6858000"/>');
    expect(xml).not.toContain('__jto_fill_');
  });

  it('keeps repeated generation deterministic with pending fills', async () => {
    const first = await generateBufferFromJson(document);
    const second = await generateBufferFromJson(document);
    expect(first.equals(second)).toBe(true);
  });
});

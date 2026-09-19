import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { generateBufferFromJson } from '../generator';
import type { PresentationComponentDefinition } from '../../types';

async function slideXml(buffer: Buffer, slideNumber: number): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(`ppt/slides/slide${slideNumber}.xml`)!.async('string');
}

/** The package part a slide relationship id points at. */
async function relTarget(
  buffer: Buffer,
  slideNumber: number,
  rId: string
): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(buffer);
  const rels = await zip
    .file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)!
    .async('string');
  const target = new RegExp(`Id="${rId}"[^>]*Target="\\.\\./([^"]+)"`).exec(
    rels
  )?.[1];
  return target ? `ppt/${target}` : undefined;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

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
    // Radial gradient: a picture fill, never the DrawingML path gradient
    // PowerPoint and LibreOffice draw differently.
    expect(xml).not.toContain('path="circle"');
    const embed =
      /<a:blipFill rotWithShape="1"><a:blip r:embed="(rId\d+)"\/><a:stretch><a:fillRect\/><\/a:stretch><\/a:blipFill>/.exec(
        xml
      );
    expect(embed).not.toBeNull();
    const part = await relTarget(buffer, 1, embed![1]);
    expect(part).toMatch(/^ppt\/media\/jto-gradient-\d+\.png$/);
    const png = await (await JSZip.loadAsync(buffer))
      .file(part!)!
      .async('uint8array');
    expect([...png.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
    // Pattern fill.
    expect(xml).toContain(
      '<a:pattFill prst="ltUpDiag"><a:fgClr><a:srgbClr val="336699"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
    );
    // Sentinel names never ship.
    expect(xml).not.toContain('__jto_fill_');
  });

  it('renders a radial slide background as a background picture', async () => {
    const buffer = await generateBufferFromJson(document);
    const xml = await slideXml(buffer, 2);

    const embed =
      /<p:bg><p:bgPr><a:blipFill[^>]*><a:blip r:embed="(rId\d+)"/.exec(xml);
    expect(embed).not.toBeNull();
    const part = await relTarget(buffer, 2, embed![1]);
    const png = await (await JSZip.loadAsync(buffer))
      .file(part!)!
      .async('uint8array');
    expect([...png.subarray(0, 4)]).toEqual(PNG_SIGNATURE);

    // No vector gradient and no full-bleed back rect (10in x 7.5in) remain.
    expect(xml).not.toContain('<a:gradFill');
    expect(xml).not.toContain('path="circle"');
    expect(xml).not.toContain('<a:ext cx="9144000" cy="6858000"/>');
    expect(xml).not.toContain('__jto_fill_');
  });

  it('keeps a linear slide background a vector full-bleed back rect', async () => {
    const buffer = await generateBufferFromJson({
      ...document,
      children: [
        {
          name: 'slide',
          props: {
            background: {
              gradient: {
                type: 'linear',
                angle: 90,
                stops: [
                  { color: '0066CC', pos: 0 },
                  { color: '001133', pos: 100 },
                ],
              },
            },
          },
          children: [],
        },
      ],
    });
    const xml = await slideXml(buffer, 1);

    expect(xml).toContain('<a:gradFill');
    expect(xml).toContain('<a:ext cx="9144000" cy="6858000"/>');
    expect(xml).not.toContain('<p:bg>');
  });

  it('keeps repeated generation deterministic with pending fills', async () => {
    const first = await generateBufferFromJson(document);
    const second = await generateBufferFromJson(document);
    expect(first.equals(second)).toBe(true);
  });
});

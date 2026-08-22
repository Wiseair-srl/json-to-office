/**
 * The common supported subset, through both backends.
 *
 * Identical OOXML between two different renderers is not the goal and is not
 * asserted. What is asserted is that both produce a package with the required
 * parts, the right dimensions and metadata, the same text, and the same number
 * of drawable elements — i.e. that the IR means the same thing to both.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const deck = (
  children: unknown[],
  props: Record<string, unknown> = {}
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Cross backend', author: 'JTO', ...props },
    children,
  }) as PresentationComponentDefinition;

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

interface Package {
  paths: string[];
  slideXml: string[];
  presentationXml: string;
  coreXml: string;
}

async function open(buffer: Buffer): Promise<Package> {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([path]) => path)
    .sort();

  const slidePaths = paths
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort();

  return {
    paths,
    slideXml: await Promise.all(
      slidePaths.map((path) => zip.file(path)!.async('string'))
    ),
    presentationXml: await zip.file('ppt/presentation.xml')!.async('string'),
    coreXml: await zip.file('docProps/core.xml')!.async('string'),
  };
}

async function bothBackends(
  document: PresentationComponentDefinition
): Promise<{ pptxgenjs: Package; officeOpen: Package }> {
  const [a, b] = await Promise.all([
    generateBufferViaIr(structuredClone(document) as never, {
      renderer: 'pptxgenjs',
    }),
    generateBufferViaIr(structuredClone(document) as never, {
      renderer: 'office-open',
    }),
  ]);
  return { pptxgenjs: await open(a.buffer), officeOpen: await open(b.buffer) };
}

/** Text content of a slide, in document order. */
function textOf(slideXml: string): string[] {
  return [...slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
}

function countOf(slideXml: string, tag: string): number {
  return slideXml.split(`<${tag}`).length - 1;
}

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'docProps/core.xml',
  'ppt/presentation.xml',
  'ppt/_rels/presentation.xml.rels',
  'ppt/slides/slide1.xml',
  'ppt/slides/_rels/slide1.xml.rels',
  'ppt/theme/theme1.xml',
];

describe('common subset across backends', () => {
  it('produces every required package part', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([slide([{ name: 'text', props: { text: 'Hello' } }])])
    );

    for (const part of REQUIRED_PARTS) {
      expect({
        backend: 'pptxgenjs',
        part,
        present: pptxgenjs.paths.includes(part),
      }).toEqual({ backend: 'pptxgenjs', part, present: true });
      expect({
        backend: 'office-open',
        part,
        present: officeOpen.paths.includes(part),
      }).toEqual({ backend: 'office-open', part, present: true });
    }

    // Both must ship a slide master and a layout for the slide to resolve.
    for (const pkg of [pptxgenjs, officeOpen]) {
      expect(pkg.paths.some((p) => p.startsWith('ppt/slideMasters/'))).toBe(
        true
      );
      expect(pkg.paths.some((p) => p.startsWith('ppt/slideLayouts/'))).toBe(
        true
      );
    }
  });

  it('agrees on slide count and text content', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([
          { name: 'text', props: { text: 'First' } },
          { name: 'text', props: { text: 'Second', y: 2 } },
        ]),
        slide([{ name: 'text', props: { text: 'Third' } }]),
      ])
    );

    expect(officeOpen.slideXml).toHaveLength(pptxgenjs.slideXml.length);
    expect(officeOpen.slideXml).toHaveLength(2);

    for (const [index, xml] of pptxgenjs.slideXml.entries()) {
      expect(textOf(officeOpen.slideXml[index])).toEqual(textOf(xml));
    }
  });

  it('agrees on the slide size', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([slide([{ name: 'text', props: { text: 'x' } }])], {
        slideWidth: 13.333,
        slideHeight: 7.5,
      })
    );

    const size = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/;
    const a = size.exec(pptxgenjs.presentationXml);
    const b = size.exec(officeOpen.presentationXml);

    expect(b?.[1]).toBe(a?.[1]);
    expect(b?.[2]).toBe(a?.[2]);
    expect(a?.[1]).toBe(String(Math.round(13.333 * 914400)));
  });

  it('carries the document metadata into both packages', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([slide([{ name: 'text', props: { text: 'x' } }])], {
        title: 'Quarterly review',
        author: 'Ada Lovelace',
      })
    );

    for (const pkg of [pptxgenjs, officeOpen]) {
      expect(pkg.coreXml).toContain('Quarterly review');
      expect(pkg.coreXml).toContain('Ada Lovelace');
    }
  });

  it('emits the same number of shapes for shapes and text', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([
          { name: 'text', props: { text: 'label', x: 1, y: 1, w: 3, h: 1 } },
          {
            name: 'shape',
            props: {
              type: 'ellipse',
              x: 1,
              y: 3,
              w: 2,
              h: 2,
              fill: { color: 'primary' },
            },
          },
        ]),
      ])
    );

    expect(countOf(officeOpen.slideXml[0], 'p:sp>')).toBe(
      countOf(pptxgenjs.slideXml[0], 'p:sp>')
    );
  });

  it('resolves theme colours to the same hex in both', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 1,
              w: 2,
              h: 1,
              fill: { color: 'primary' },
            },
          },
        ]),
      ])
    );

    const hex = /<a:srgbClr val="([0-9A-F]{6})"/;
    expect(hex.exec(officeOpen.slideXml[0])?.[1]).toBe(
      hex.exec(pptxgenjs.slideXml[0])?.[1]
    );
  });

  it('places geometry at the same EMU offsets', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([
          {
            name: 'shape',
            props: { type: 'rect', x: 1.5, y: 0.75, w: 3, h: 2 },
          },
        ]),
      ])
    );

    const xfrm = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/g;
    // The first match on each slide is the group transform; the second is the shape.
    const a = [...pptxgenjs.slideXml[0].matchAll(xfrm)][1];
    const b = [...officeOpen.slideXml[0].matchAll(xfrm)][1];

    expect(b.slice(1, 5)).toEqual(a.slice(1, 5));
    expect(a[1]).toBe(String(Math.round(1.5 * 914400)));
  });

  it('embeds an image in both packages', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([
          {
            name: 'image',
            props: { base64: PNG_4X2, x: 1, y: 1, w: 2, h: 1 },
          },
        ]),
      ])
    );

    for (const pkg of [pptxgenjs, officeOpen]) {
      expect(pkg.paths.some((p) => p.startsWith('ppt/media/'))).toBe(true);
      expect(countOf(pkg.slideXml[0], 'p:pic>')).toBe(1);
    }
  });

  it('renders a table with the same cell text in both', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([
          {
            name: 'table',
            props: {
              rows: [
                ['Name', 'Value'],
                ['Alpha', '1'],
              ],
              x: 1,
              y: 1,
              w: 6,
            },
          },
        ]),
      ])
    );

    expect(textOf(officeOpen.slideXml[0])).toEqual(
      textOf(pptxgenjs.slideXml[0])
    );
    for (const pkg of [pptxgenjs, officeOpen]) {
      expect(pkg.slideXml[0]).toContain('<a:tbl>');
    }
  });

  it('carries speaker notes and the hidden flag in both', async () => {
    const { pptxgenjs, officeOpen } = await bothBackends(
      deck([
        slide([{ name: 'text', props: { text: 'One' } }], {
          notes: 'Say this out loud',
        }),
        slide([{ name: 'text', props: { text: 'Two' } }], { hidden: true }),
      ])
    );

    for (const pkg of [pptxgenjs, officeOpen]) {
      expect(pkg.paths.some((p) => p.startsWith('ppt/notesSlides/'))).toBe(
        true
      );
      expect(pkg.slideXml[1]).toContain('show="0"');
    }
  });

  it('writes a hyperlink relationship in both', async () => {
    const [a, b] = await Promise.all([
      generateBufferViaIr(
        structuredClone(
          deck([
            slide([
              {
                name: 'text',
                props: {
                  text: 'Link',
                  hyperlink: { url: 'https://example.com' },
                },
              },
            ]),
          ])
        ) as never,
        { renderer: 'pptxgenjs' }
      ),
      generateBufferViaIr(
        structuredClone(
          deck([
            slide([
              {
                name: 'text',
                props: {
                  text: 'Link',
                  hyperlink: { url: 'https://example.com' },
                },
              },
            ]),
          ])
        ) as never,
        { renderer: 'office-open' }
      ),
    ]);

    for (const buffer of [a.buffer, b.buffer]) {
      const zip = await JSZip.loadAsync(buffer);
      const rels = await zip
        .file('ppt/slides/_rels/slide1.xml.rels')!
        .async('string');
      expect(rels).toContain('https://example.com');
      expect(rels).toContain('TargetMode="External"');
    }
  });
});

describe('office-open capability failures', () => {
  async function expectRejected(
    document: PresentationComponentDefinition,
    feature: string
  ): Promise<void> {
    let caught: unknown;
    try {
      await generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'office-open',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const err = caught as Error & {
      code?: string;
      features?: string[];
      paths?: string[];
      rendererId?: string;
      format?: string;
    };
    expect(err.code).toBe('UNSUPPORTED_RENDERER_FEATURE');
    expect(err.rendererId).toBe('office-open');
    expect(err.format).toBe('pptx');
    expect(err.features).toContain(feature);
    expect(err.paths?.length).toBeGreaterThan(0);
    expect(err.message).toContain(feature);
  }

  it('rejects SVG images before rendering', async () => {
    await expectRejected(
      deck([
        slide([
          {
            name: 'image',
            props: {
              svg: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"/>',
              x: 1,
              y: 1,
              w: 2,
              h: 1,
            },
          },
        ]),
      ]),
      'svg'
    );
  });

  it('rejects native charts, which would ship without their workbook', async () => {
    await expectRejected(
      deck([
        slide([
          {
            name: 'chart',
            props: {
              type: 'bar',
              data: [{ name: 'S', labels: ['a'], values: [1] }],
              x: 1,
              y: 1,
              w: 4,
              h: 3,
            },
          },
        ]),
      ]),
      'charts'
    );
  });

  it('rejects a transformed image, which the backend would silently flatten', async () => {
    await expectRejected(
      deck([
        slide([
          {
            name: 'image',
            props: { base64: PNG_4X2, x: 1, y: 1, w: 2, h: 1, rotate: 30 },
          },
        ]),
      ]),
      'image-transform'
    );
  });

  it('rejects a vertical flip', async () => {
    await expectRejected(
      deck([
        slide([
          {
            name: 'shape',
            props: { type: 'rect', x: 1, y: 1, w: 2, h: 1, flipV: true },
          },
        ]),
      ]),
      'flip-vertical'
    );
  });

  it('rejects a deck that uses templates', async () => {
    await expectRejected(
      deck(
        [slide([{ name: 'text', props: { text: 'x' } }], { template: 'base' })],
        { templates: [{ name: 'base', background: { color: 'primary' } }] }
      ),
      'masters'
    );
  });

  it('reports every unsupported feature in one error', async () => {
    let caught: unknown;
    try {
      await generateBufferViaIr(
        structuredClone(
          deck([
            slide([
              {
                name: 'chart',
                props: {
                  type: 'bar',
                  data: [{ name: 'S', labels: ['a'], values: [1] }],
                  x: 1,
                  y: 1,
                  w: 4,
                  h: 3,
                },
              },
              {
                name: 'image',
                props: {
                  svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
                  x: 1,
                  y: 5,
                  w: 1,
                  h: 1,
                },
              },
            ]),
          ])
        ) as never,
        { renderer: 'office-open' }
      );
    } catch (error) {
      caught = error;
    }

    const err = caught as Error & { features?: string[] };
    expect(err.features).toEqual(expect.arrayContaining(['charts', 'svg']));
  });

  it('renders the same document happily on the default backend', async () => {
    const { buffer } = await generateBufferViaIr(
      structuredClone(
        deck([
          slide([
            {
              name: 'chart',
              props: {
                type: 'bar',
                data: [{ name: 'S', labels: ['a'], values: [1] }],
                x: 1,
                y: 1,
                w: 4,
                h: 3,
              },
            },
          ]),
        ])
      ) as never
    );

    expect(buffer.length).toBeGreaterThan(0);
  });
});

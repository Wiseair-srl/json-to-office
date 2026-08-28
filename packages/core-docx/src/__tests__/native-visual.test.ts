/**
 * The native `visual`: a drawing group, not a picture of one.
 *
 * The point of native mode is what the file *contains* — real `wps:wsp`
 * shapes, real text runs, real pictures — and what it does not contain: a
 * rasterizer request, a PPTX, a PNG of text. Both halves are asserted here,
 * because either one silently reverting would look fine on screen and be
 * exactly the regression this exists to prevent.
 *
 * These cases stay out of the shared corpus on purpose. Every corpus case is
 * rendered by the default backend, and the default backend refuses a drawing
 * group by design — which is itself asserted below.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../core/generateFromIr';
import { flattenVisuals } from '../core/flattenVisuals';
import {
  getVisualPrepassStats,
  resetVisualPrepassStats,
} from '../core/prerasterizeVisuals';
import type { ReportComponentDefinition } from '../types';
import type { ServicesConfig } from '@json-to-office/shared';

const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const SVG_4X2 = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="#3366cc"/></svg>'
).toString('base64')}`;

/** A service that fails loudly the moment anything asks it to rasterize. */
const FORBIDDEN_SERVICE: ServicesConfig = {
  pptx: {
    render: () => {
      throw new Error('the rasterizer was called for a native visual');
    },
    renderBatch: () => {
      throw new Error('the rasterizer was called for a native visual');
    },
  },
};

function document(
  visualProps: Record<string, unknown>,
  extra: Record<string, unknown>[] = []
): ReportComponentDefinition {
  return {
    name: 'docx',
    renderer: 'office-open',
    props: {},
    children: [{ name: 'visual', props: visualProps }, ...extra] as never,
  } as unknown as ReportComponentDefinition;
}

const SHAPE_AND_TEXT = {
  renderMode: 'native',
  canvas: { width: 6, height: 3, background: { color: '#F5F7FA' } },
  elements: [
    {
      name: 'shape',
      props: {
        type: 'roundRect',
        x: 0.25,
        y: 0.25,
        w: 2,
        h: 1,
        fill: { color: '#0F172A' },
        line: { color: '#334155', width: 1.5, dashType: 'dash' },
        text: 'Inside the shape',
        fontColor: '#FFFFFF',
      },
    },
    {
      name: 'text',
      props: {
        text: 'Editable Word content',
        x: 2.5,
        y: 0.4,
        w: 3,
        h: 0.5,
        fontSize: 22,
        bold: true,
      },
    },
  ],
} as const;

async function render(
  doc: ReportComponentDefinition,
  services: ServicesConfig = FORBIDDEN_SERVICE
): Promise<Buffer> {
  const { buffer } = await generateBufferViaIr(doc, {
    renderer: 'office-open',
    deterministic: true,
    services,
  });
  return buffer;
}

async function parts(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out: Record<string, string> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    out[name] = name.startsWith('word/media/')
      ? ''
      : await file.async('string');
  }
  return out;
}

const documentXml = async (buffer: Buffer): Promise<string> =>
  (await parts(buffer))['word/document.xml']!;

const mediaParts = async (buffer: Buffer): Promise<string[]> =>
  Object.keys(await parts(buffer)).filter((name) =>
    name.startsWith('word/media/')
  );

/** Every `a:off`/`a:ext` pair inside the drawing, in document order. */
function childFrames(xml: string): string[] {
  return [
    ...xml.matchAll(
      /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g
    ),
  ].map(([, x, y, cx, cy]) => `${x},${y} ${cx}x${cy}`);
}

describe('a native visual becomes a DrawingML group', () => {
  it('emits wpg:wgp with wps:wsp children', async () => {
    const xml = await documentXml(await render(document(SHAPE_AND_TEXT)));

    expect(xml).toContain('<wpg:wgp>');
    expect(xml).toContain(
      'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"'
    );
    // Three shapes: the canvas background, the roundRect, the text box.
    expect(xml.match(/<wps:wsp>/g)).toHaveLength(3);
    expect(xml).toContain('<a:prstGeom prst="roundRect">');
  });

  it('keeps the text as text rather than pixels', async () => {
    const xml = await documentXml(await render(document(SHAPE_AND_TEXT)));

    expect(xml).toContain('Editable Word content');
    expect(xml).toContain('Inside the shape');
    // Inside a real text box, which is what makes it selectable in Word.
    expect(xml).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(xml).toContain('<w:txbxContent>');
  });

  it('adds no raster media for a shape- and text-only visual', async () => {
    expect(await mediaParts(await render(document(SHAPE_AND_TEXT)))).toEqual(
      []
    );
  });

  it('draws the canvas background behind everything else', async () => {
    const xml = await documentXml(await render(document(SHAPE_AND_TEXT)));
    const background = xml.indexOf('F5F7FA');
    const shape = xml.indexOf('roundRect');

    expect(background).toBeGreaterThan(-1);
    expect(background).toBeLessThan(shape);
  });

  it('places children in the canvas coordinate space, in array order', async () => {
    const xml = await documentXml(await render(document(SHAPE_AND_TEXT)));

    // The group's own extent and child space, then one frame per child.
    // 6x3 inches at 914400 EMU/inch; 0.25in = 228600; 2x1in = 1828800x914400.
    expect(xml).toContain(
      '<a:ext cx="5486400" cy="2743200"/><a:chOff x="0" y="0"/><a:chExt cx="5486400" cy="2743200"/>'
    );
    expect(childFrames(xml)).toEqual([
      '0,0 5486400x2743200',
      '0,0 5486400x2743200',
      '228600,228600 1828800x914400',
      '2286000,365760 2743200x457200',
    ]);
  });

  it('resolves a percentage against the canvas, and a number as inches', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 4, height: 2 },
          elements: [
            {
              name: 'shape',
              props: { type: 'rect', x: '50%', y: 1, w: '25%', h: 0.5 },
            },
          ],
        })
      )
    );

    // 50% of 4in = 2in = 1828800; 1in = 914400; 25% of 4in = 1in; 0.5in.
    expect(childFrames(xml)).toEqual([
      '0,0 3657600x1828800',
      '1828800,914400 914400x457200',
    ]);
  });

  it('carries an element-level underline colour onto every run', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 2, height: 2 },
          elements: [
            {
              name: 'text',
              props: {
                runs: [{ text: 'a' }, { text: 'b' }],
                underline: { style: 'dbl', color: '#FF0000' },
                x: 0,
                y: 0,
                w: 2,
                h: 1,
              },
            },
          ],
        })
      )
    );

    expect(xml.match(/<w:u w:val="double" w:color="FF0000"\/>/g)).toHaveLength(
      2
    );
  });

  it('states rotation in degrees and flips as attributes', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 2, height: 2 },
          elements: [
            {
              name: 'shape',
              props: {
                type: 'arrow',
                x: 0,
                y: 0,
                w: 1,
                h: 1,
                rotate: 15,
                flipH: true,
              },
            },
          ],
        })
      )
    );

    // 15 degrees in 60000ths, and the project's `arrow` under its OOXML name.
    expect(xml).toContain('<a:xfrm flipH="1" rot="900000">');
    expect(xml).toContain('prst="rightArrow"');
  });
});

describe('placement, captions and accessibility', () => {
  it('defaults to the canvas physical size, centred and inline', async () => {
    const xml = await documentXml(await render(document(SHAPE_AND_TEXT)));

    expect(xml).toContain('<wp:inline');
    expect(xml).toContain('<wp:extent cx="5486400" cy="2743200"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it('scales the placement while keeping the child coordinate space', async () => {
    const xml = await documentXml(
      await render(document({ ...SHAPE_AND_TEXT, width: 288 }))
    );

    // 288px at 96 DPI = 3in placed; the canvas is still 6x3 inside.
    expect(xml).toContain('<wp:extent cx="2743200" cy="1371600"/>');
    expect(xml).toContain('<a:chExt cx="5486400" cy="2743200"/>');
  });

  it('anchors a floating visual and drops the paragraph alignment', async () => {
    const xml = await documentXml(
      await render(
        document({
          ...SHAPE_AND_TEXT,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'right' },
            verticalPosition: { relative: 'paragraph', offset: 0 },
            wrap: { type: 'square' },
          },
        })
      )
    );

    expect(xml).toContain('<wp:anchor');
    expect(xml).toContain('<wp:wrapSquare');
    // Aligning the paragraph would move the anchor rather than the drawing, so
    // the paragraph holding an anchored group states none. (Alignment inside a
    // shape's own text is a different thing, and is still there.)
    expect(xml).toContain('<w:body><w:p><w:r><w:drawing>');
  });

  it('writes the caption as an ordinary paragraph outside the group', async () => {
    const xml = await documentXml(
      await render(
        document({ ...SHAPE_AND_TEXT, caption: 'Figure 1. **Native**' })
      )
    );

    const drawingEnd = xml.indexOf('</w:drawing>');
    expect(xml.indexOf('Native')).toBeGreaterThan(drawingEnd);
    expect(xml).toContain('Figure 1. ');
  });

  it('writes alt text onto the drawing', async () => {
    const xml = await documentXml(
      await render(document({ ...SHAPE_AND_TEXT, alt: 'A labelled diagram' }))
    );

    expect(xml).toContain('descr="A labelled diagram"');
  });

  it('honours spacing and the keep flags on the drawing paragraph', async () => {
    const xml = await documentXml(
      await render(
        document({
          ...SHAPE_AND_TEXT,
          spacing: { before: 6, after: 12 },
          keepNext: true,
          keepLines: true,
        })
      )
    );

    expect(xml).toContain('w:before="120"');
    expect(xml).toContain('w:after="240"');
    expect(xml).toContain('<w:keepNext/>');
    expect(xml).toContain('<w:keepLines/>');
  });

  it('draws nothing for a disabled element', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 2, height: 2 },
          elements: [
            { name: 'text', props: { text: 'kept' } },
            { name: 'text', props: { text: 'dropped' }, enabled: false },
          ],
        })
      )
    );

    expect(xml).toContain('kept');
    expect(xml).not.toContain('dropped');
  });
});

describe('pictures inside a group', () => {
  const withImages = {
    renderMode: 'native',
    canvas: { width: 4, height: 2 },
    elements: [
      {
        name: 'image',
        props: {
          base64: PNG_4X2,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          sizing: { type: 'cover' },
          alt: 'a swatch',
        },
      },
      { name: 'image', props: { svg: SVG_4X2, x: 1.5, y: 0, w: 1 } },
    ],
  };

  it('embeds each picture natively and resolves its relationship', async () => {
    const buffer = await render(document(withImages));
    const xml = await documentXml(buffer);

    expect(xml).toContain('<pic:pic');
    // Every blip resolves to a real relationship rather than a placeholder.
    for (const [, id] of xml.matchAll(/r:embed="([^"]+)"/g)) {
      expect(id).toMatch(/^rId\d+$/);
    }
    const media = await mediaParts(buffer);
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((name) => !name.includes('undefined'))).toBe(true);
  });

  it('keeps an SVG vector, with a raster fallback beside it', async () => {
    const buffer = await render(document(withImages));
    const xml = await documentXml(buffer);

    expect(xml).toContain('asvg:svgBlip');
    expect(await mediaParts(buffer)).toContainEqual(
      expect.stringMatching(/\.svg$/)
    );
  });

  it('crops a cover-sized image instead of distorting it', async () => {
    const xml = await documentXml(await render(document(withImages)));

    // A 4x2 image in a 1x1 box: the sides are trimmed, symmetrically.
    expect(xml).toContain('<a:srcRect l="25000" r="25000"/>');
  });

  it('fits and centres a contained image without cropping it', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 4, height: 2 },
          elements: [
            {
              name: 'image',
              props: {
                base64: PNG_4X2,
                x: 0,
                y: 0,
                w: 1,
                h: 1,
                sizing: { type: 'contain' },
              },
            },
          ],
        })
      )
    );

    expect(xml).not.toContain('<a:srcRect');
    // 4:2 fitted into a 1x1 box is 1x0.5, centred vertically at y=0.25in.
    expect(childFrames(xml)).toContain('0,228600 914400x457200');
  });

  it('takes the box from `sizing`, which outranks the element size', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 4, height: 2 },
          elements: [
            {
              name: 'image',
              props: {
                base64: PNG_4X2,
                x: 0,
                y: 0,
                sizing: { type: 'cover', w: 2, h: 2 },
              },
            },
          ],
        })
      )
    );

    // The raster path resolves the box as `sizing.w ?? props.w`; reading only
    // `props.w` here drew the image at its stored 4x2 pixels instead — a
    // ~48x smaller speck, from JSON that validates either way.
    expect(childFrames(xml)).toContain('0,0 1828800x1828800');
    expect(xml).toContain('<a:srcRect l="25000" r="25000"/>');
  });

  it('sizes an unstated axis from the image itself', async () => {
    const xml = await documentXml(
      await render(
        document({
          renderMode: 'native',
          canvas: { width: 4, height: 2 },
          elements: [
            { name: 'image', props: { base64: PNG_4X2, x: 0, y: 0, w: 1 } },
          ],
        })
      )
    );

    // 4x2 pixels is 2:1, so a 1in width implies half an inch of height.
    expect(childFrames(xml)).toContain('0,0 914400x457200');
  });
});

describe('a native visual is found wherever it is nested', () => {
  const nested = (label: string) => ({
    name: 'visual',
    props: {
      renderMode: 'native',
      canvas: { width: 2, height: 1 },
      elements: [
        { name: 'text', props: { text: label, x: 0, y: 0, w: 2, h: 0.5 } },
        { name: 'image', props: { base64: PNG_4X2, x: 0, y: 0.5, w: 0.5 } },
      ],
    },
  });

  const nestedDocument = {
    name: 'docx',
    renderer: 'office-open',
    props: {},
    children: [
      {
        name: 'section',
        props: {
          header: [nested('in a header')],
          footer: [nested('in a footer')],
        },
        children: [
          nested('in the body'),
          {
            name: 'columns',
            props: { count: 2 },
            children: [nested('in a column')],
          },
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: 'H' },
                  cells: [{ content: nested('in a cell') }],
                },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as ReportComponentDefinition;

  it('draws one in the body, a column, a table cell, a header and a footer', async () => {
    const buffer = await render(nestedDocument);
    const emitted = await parts(buffer);

    const labels: string[] = [];
    let groups = 0;
    for (const [name, xml] of Object.entries(emitted)) {
      if (!name.endsWith('.xml') || name.includes('rels')) continue;
      groups += (xml.match(/<wpg:wgp>/g) ?? []).length;
      labels.push(
        ...[...xml.matchAll(/<w:t[^>]*>(in [^<]+)<\/w:t>/g)].map(
          ([, label]) => label!
        )
      );
    }

    // Every placement draws a real group rather than a placeholder — a table
    // cell used to fall through to "[Unsupported component type: visual]".
    expect(new Set(labels)).toEqual(
      new Set([
        'in the body',
        'in a column',
        'in a cell',
        'in a header',
        'in a footer',
      ])
    );
    // Three in the body part, plus one in each of the three header and three
    // footer parts Word wants for default/first/even.
    expect(groups).toBe(9);
    expect(
      Object.keys(emitted).filter((name) => name.startsWith('word/media/'))
    ).toHaveLength(1);
  }, 60_000);

  it('resolves every picture relationship, in every part', async () => {
    const emitted = await parts(await render(nestedDocument));

    for (const [name, xml] of Object.entries(emitted)) {
      if (!name.endsWith('.xml')) continue;
      for (const [, id] of xml.matchAll(/r:embed="([^"]+)"/g)) {
        expect(id).toMatch(/^rId\d+$/);
      }
    }
  }, 60_000);
});

describe('native mode never reaches a rasterizer', () => {
  it('renders with no pptx service configured at all', async () => {
    const { buffer } = await generateBufferViaIr(document(SHAPE_AND_TEXT), {
      renderer: 'office-open',
    });

    expect(buffer.length).toBeGreaterThan(0);
  });

  it('renders with a service that throws if it is used', async () => {
    await expect(render(document(SHAPE_AND_TEXT))).resolves.toBeInstanceOf(
      Buffer
    );
  });

  it('moves no pre-pass counter', async () => {
    resetVisualPrepassStats();
    await render(document(SHAPE_AND_TEXT));

    expect(getVisualPrepassStats()).toEqual({
      documents: 0,
      collected: 0,
      unique: 0,
    });
  });

  it('is left alone by the offline flatten transform', async () => {
    const flattened = (await flattenVisuals(document(SHAPE_AND_TEXT) as never, {
      rasterize: () => {
        throw new Error('a native visual was flattened to a raster');
      },
    })) as { children: { name: string; props: Record<string, unknown> }[] };

    expect(flattened.children[0]!.name).toBe('visual');
    expect(flattened.children[0]!.props.renderMode).toBe('native');
  });
});

describe('a backend that cannot draw a group refuses the document', () => {
  it('requires the drawing-groups feature, naming the component', async () => {
    const compiled = await compileDocumentToIr(document(SHAPE_AND_TEXT));

    expect(compiled.required).toContainEqual(
      expect.objectContaining({
        feature: 'drawing-groups',
        path: 'sections[0].children[0]',
      })
    );
  });

  it('fails before any bytes exist under docxjs', async () => {
    await expect(
      generateBufferViaIr(document(SHAPE_AND_TEXT), { renderer: 'docxjs' })
    ).rejects.toThrow(/drawing-groups/);
  });
});

describe('an element that draws nothing is not a refusal', () => {
  const withEmptyText = {
    renderMode: 'native',
    canvas: { width: 4, height: 2 },
    elements: [
      { name: 'text', props: { x: 0, y: 0, w: 1, h: 1 } },
      {
        name: 'shape',
        props: {
          type: 'rect',
          x: 1,
          y: 0,
          w: 1,
          h: 1,
          fill: { color: '#00FF00' },
        },
      },
    ],
  };

  it('keeps the rest of the drawing when a text element has no content', async () => {
    const xml = await documentXml(await render(document(withEmptyText)));

    // The empty label draws nothing; the shape beside it is still there. This
    // used to delete the whole graphic — and silently, because nothing had
    // been refused.
    expect(xml).toContain('<wpg:wgp>');
    expect(xml).toContain('00FF00');
  });

  it('records no refusal for it', async () => {
    const compiled = await compileDocumentToIr(document(withEmptyText));

    expect(compiled.unsupported).toEqual([]);
    expect(
      compiled.warnings.map((warning) => warning.message).join(' ')
    ).toContain('neither "text" nor "runs"');
  });
});

describe('native mode refuses what it cannot draw', () => {
  it('names the property holding an unresolvable colour', async () => {
    const compiled = await compileDocumentToIr(
      document({
        renderMode: 'native',
        canvas: { width: 2, height: 2 },
        elements: [
          {
            name: 'shape',
            props: { type: 'rect', fill: { color: 'accent4' } },
          },
        ],
      })
    );

    expect(compiled.unsupported).toContainEqual(
      expect.objectContaining({
        name: 'visual',
        path: 'sections[0].children[0]',
        detail: 'elements[0].fill.color "accent4"',
      })
    );
  });

  it('names an unresolvable colour on an element-level underline', async () => {
    const compiled = await compileDocumentToIr(
      document({
        renderMode: 'native',
        canvas: { width: 2, height: 2 },
        elements: [
          {
            name: 'text',
            props: { text: 'x', underline: { color: 'accent4' } },
          },
        ],
      })
    );

    expect(compiled.unsupported).toContainEqual(
      expect.objectContaining({
        detail: 'elements[0].underline.color "accent4"',
      })
    );
  });

  it('names an image whose bytes could not be loaded', async () => {
    const compiled = await compileDocumentToIr(
      document({
        renderMode: 'native',
        canvas: { width: 2, height: 2 },
        elements: [
          { name: 'image', props: { path: 'does-not-exist.png', w: 1 } },
        ],
      })
    );

    expect(compiled.unsupported).toContainEqual(
      expect.objectContaining({
        detail: 'elements[0] image could not be loaded',
      })
    );
  });
});

describe('deterministic generation', () => {
  it('produces identical bytes on a second render', async () => {
    const doc = document(SHAPE_AND_TEXT);
    const [a, b] = [await render(doc), await render(doc)];

    expect(a.equals(b)).toBe(true);
  });

  it('produces identical bytes for two concurrent renders', async () => {
    const [a, b] = await Promise.all([
      render(document(SHAPE_AND_TEXT)),
      render(document(SHAPE_AND_TEXT)),
    ]);

    expect(a.equals(b)).toBe(true);
  });

  it('numbers every drawing id once, across the whole document', async () => {
    const xml = await documentXml(
      await render(
        document(SHAPE_AND_TEXT, [
          { name: 'image', props: { base64: PNG_4X2, width: 40 } },
        ])
      )
    );
    const ids = [
      ...xml.matchAll(/<(?:wp:docPr|wps:cNvPr|pic:cNvPr) id="(\d+)"/g),
    ].map(([, id]) => id);

    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

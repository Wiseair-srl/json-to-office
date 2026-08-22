import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';
import { EMU_PER_INCH } from '../types';
import type {
  PptxIrImageElement,
  PptxIrShapeElement,
  PptxIrTextBoxElement,
} from '../types';
import { assertValidPptxIr } from '../validation';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const OTHER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function deck(
  children: unknown[],
  props: Record<string, unknown> = {}
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props,
    children,
  } as PresentationComponentDefinition;
}

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

function compile(document: PresentationComponentDefinition) {
  const result = compileDocumentToIr(document);
  assertValidPptxIr(result.ir);
  return result;
}

describe('PptxIR shape and identity', () => {
  it('carries the schema version and resolved deck metadata', () => {
    const { ir } = compile(
      deck([slide([{ name: 'text', props: { text: 'Hi' } }])], {
        title: 'Deck',
        author: 'Ada',
        subject: 'Subject',
        company: 'Acme',
        language: 'en-GB',
      })
    );

    expect(ir.schemaVersion).toBe(1);
    expect(ir.metadata).toEqual({
      title: 'Deck',
      author: 'Ada',
      subject: 'Subject',
      company: 'Acme',
    });
    expect(ir.language).toBe('en-GB');
    expect(ir.rtl).toBe(false);
  });

  it('resolves the slide size to EMU', () => {
    const { ir } = compile(
      deck([slide([])], { slideWidth: 13.333, slideHeight: 7.5 })
    );

    expect(ir.size).toEqual({
      widthEmu: Math.round(13.333 * EMU_PER_INCH),
      heightEmu: Math.round(7.5 * EMU_PER_INCH),
    });
  });

  it('defaults the slide size to 10x7.5 inches', () => {
    const { ir } = compile(deck([slide([])]));
    expect(ir.size).toEqual({ widthEmu: 9144000, heightEmu: 6858000 });
  });

  it('derives element ids from position, not a counter', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'text', props: { text: 'a' } },
          { name: 'text', props: { text: 'b' } },
        ]),
        slide([{ name: 'text', props: { text: 'c' } }]),
      ])
    );

    expect(ir.slides.map((s) => s.id)).toEqual(['slide1', 'slide2']);
    expect(ir.slides[0].elements.map((e) => e.id)).toEqual(['s1.e0', 's1.e1']);
    expect(ir.slides[1].elements.map((e) => e.id)).toEqual(['s2.e0']);
  });

  it('produces identical ids across repeated compilations', () => {
    const document = deck([
      slide([
        { name: 'text', props: { text: 'a' } },
        { name: 'shape', props: { type: 'rect', x: 1, y: 1, w: 1, h: 1 } },
      ]),
    ]);

    const first = compile(structuredClone(document));
    const second = compile(structuredClone(document));

    expect(first.ir.slides[0].elements.map((e) => e.id)).toEqual(
      second.ir.slides[0].elements.map((e) => e.id)
    );
  });

  it('records an IR path on every element', () => {
    const { ir } = compile(
      deck([slide([{ name: 'text', props: { text: 'a' } }])])
    );
    expect(ir.slides[0].elements[0].path).toBe('slides[0].elements[0]');
  });

  it('drops disabled slides and keeps ordering stable', () => {
    const { ir } = compile(
      deck([
        slide([{ name: 'text', props: { text: 'one' } }]),
        { ...(slide([]) as object), enabled: false },
        slide([{ name: 'text', props: { text: 'three' } }]),
      ])
    );

    expect(ir.slides).toHaveLength(2);
    expect(ir.slides.map((s) => s.id)).toEqual(['slide1', 'slide2']);
  });

  it('holds no functions or renderer instances', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'text', props: { text: 'a' } },
          { name: 'image', props: { base64: PNG_1PX, x: 0, y: 0, w: 1, h: 1 } },
        ]),
      ])
    );

    const seen = new Set<unknown>();
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'function') {
        throw new Error(`function found at ${path}`);
      }
      if (value === null || typeof value !== 'object') return;
      if (value instanceof Uint8Array) return;
      if (seen.has(value)) return;
      seen.add(value);
      expect(
        Object.getPrototypeOf(value) === Object.prototype ||
          Array.isArray(value)
      ).toBe(true);
      for (const [key, child] of Object.entries(value)) {
        walk(child, `${path}.${key}`);
      }
    };

    expect(() => walk(ir, 'ir')).not.toThrow();
  });
});

describe('PptxIR unit resolution', () => {
  it('converts inch positions to EMU', () => {
    const { ir } = compile(
      deck([
        slide([
          {
            name: 'shape',
            props: { type: 'rect', x: 1, y: 0.5, w: 2, h: 1.25 },
          },
        ]),
      ])
    );

    expect(ir.slides[0].elements[0].transform).toMatchObject({
      xEmu: 914400,
      yEmu: 457200,
      widthEmu: 1828800,
      heightEmu: 1143000,
    });
  });

  it('resolves percentage positions against the slide extent in EMU', () => {
    const { ir } = compile(
      deck(
        [
          slide([
            {
              name: 'shape',
              props: { type: 'rect', x: '10%', y: '50%', w: '25%', h: '20%' },
            },
          ]),
        ],
        { slideWidth: 10, slideHeight: 7.5 }
      )
    );

    expect(ir.slides[0].elements[0].transform).toMatchObject({
      xEmu: 914400,
      yEmu: 3429000,
      widthEmu: 2286000,
      heightEmu: 1371600,
    });
  });

  it('treats a value of 100 or more as EMU, matching the authoring contract', () => {
    const { ir } = compile(
      deck([
        slide([
          {
            name: 'shape',
            props: { type: 'rect', x: 914400, y: 0, w: 1, h: 1 },
          },
        ]),
      ])
    );

    expect(ir.slides[0].elements[0].transform.xEmu).toBe(914400);
  });

  it('resolves grid cells to explicit EMU transforms', () => {
    const { ir } = compile(
      deck(
        [
          slide([
            {
              name: 'shape',
              props: {
                type: 'rect',
                grid: { column: 0, row: 0, columnSpan: 12, rowSpan: 6 },
              },
            },
          ]),
        ],
        { grid: { columns: 12, rows: 6, margin: 0.5, gutter: 0 } }
      )
    );

    // Full span of a 10x7.5 slide inset by a 0.5in margin on every side.
    expect(ir.slides[0].elements[0].transform).toMatchObject({
      xEmu: 457200,
      yEmu: 457200,
      widthEmu: 8229600,
      heightEmu: 5943600,
    });
    expect(
      (ir.slides[0].elements[0] as PptxIrShapeElement).transform
    ).not.toHaveProperty('grid');
  });

  it('keeps font sizes in points and geometry in EMU', () => {
    const { ir } = compile(
      deck([
        slide([{ name: 'text', props: { text: 'x', fontSize: 24, y: 1 } }]),
      ])
    );

    const element = ir.slides[0].elements[0] as PptxIrTextBoxElement;
    expect(element.runs[0].fontSize).toBe(24);
    expect(element.transform.yEmu).toBe(914400);
  });
});

describe('PptxIR value resolution', () => {
  it('resolves theme colour tokens to bare uppercase hex', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'text', props: { text: 'x', color: 'primary' } },
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 1,
              w: 1,
              h: 1,
              fill: { color: '#abc' },
            },
          },
        ]),
      ])
    );

    const text = ir.slides[0].elements[0] as PptxIrTextBoxElement;
    expect(text.runs[0].color.hex).toMatch(/^[0-9A-F]{6}$/);

    const shape = ir.slides[0].elements[1] as PptxIrShapeElement;
    expect(shape.fill).toEqual({
      kind: 'solid',
      color: { hex: 'AABBCC' },
    });
  });

  it('resolves the theme palette to hex', () => {
    const { ir } = compile(deck([slide([])]));
    for (const value of Object.values(ir.theme.palette)) {
      expect(value).toMatch(/^[0-9A-F]{6}$/);
    }
  });

  it('flattens the font cascade onto every run', () => {
    const { ir } = compile(
      deck([
        slide([
          {
            name: 'text',
            props: {
              fontSize: 16,
              fontFace: 'Georgia',
              color: '112233',
              runs: [{ text: 'inherits' }, { text: 'overrides', fontSize: 30 }],
            },
          },
        ]),
      ])
    );

    const element = ir.slides[0].elements[0] as PptxIrTextBoxElement;
    expect(element.runs[0]).toMatchObject({
      fontFamily: 'Georgia',
      fontSize: 16,
      color: { hex: '112233' },
    });
    expect(element.runs[1]).toMatchObject({
      fontFamily: 'Georgia',
      fontSize: 30,
      color: { hex: '112233' },
    });
  });

  it('applies weight aliasing once, from the base family', () => {
    const { ir } = compile(
      deck([
        slide([
          {
            name: 'text',
            props: {
              fontFace: 'Inter',
              fontWeight: 300,
              runs: [{ text: 'a' }, { text: 'b', fontWeight: 500 }],
            },
          },
        ]),
      ])
    );

    const element = ir.slides[0].elements[0] as PptxIrTextBoxElement;
    expect(element.runs[0].fontFamily).toBe('Inter Light');
    expect(element.runs[1].fontFamily).toBe('Inter Medium');
  });

  it('substitutes page-number placeholders per slide', () => {
    const { ir } = compile(
      deck(
        [
          slide([
            { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
          ]),
          slide([
            { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
          ]),
        ],
        { pageNumberFormat: '9' }
      )
    );

    const textOf = (index: number) =>
      (ir.slides[index].elements[0] as PptxIrTextBoxElement).runs[0].text;
    expect(textOf(0)).toBe('1/2');
    expect(textOf(1)).toBe('2/2');
  });

  it('rebases slide hyperlinks onto generated numbering', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'text', props: { text: 'link', hyperlink: { slide: 3 } } },
        ]),
        { ...(slide([]) as object), enabled: false },
        slide([{ name: 'text', props: { text: 'target' } }]),
      ])
    );

    const element = ir.slides[0].elements[0] as PptxIrTextBoxElement;
    expect(element.hyperlink).toEqual({ kind: 'slide', slideIndex: 2 });
  });

  it('drops an unresolvable slide hyperlink with a warning', () => {
    const { ir, warnings } = compile(
      deck([
        slide([
          { name: 'text', props: { text: 'link', hyperlink: { slide: 9 } } },
        ]),
      ])
    );

    const element = ir.slides[0].elements[0] as PptxIrTextBoxElement;
    expect(element.hyperlink).toBeUndefined();
    expect(warnings.map((w) => w.code)).toContain('HYPERLINK_SLIDE_UNRESOLVED');
  });

  it('compiles a gradient background into a full-bleed shape behind content', () => {
    const { ir } = compile(
      deck([
        slide([{ name: 'text', props: { text: 'over' } }], {
          background: {
            gradient: {
              type: 'linear',
              angle: 90,
              stops: [
                { color: 'primary', pos: 0 },
                { color: 'accent', pos: 100 },
              ],
            },
          },
        }),
      ])
    );

    const first = ir.slides[0].elements[0] as PptxIrShapeElement;
    expect(ir.slides[0].background).toBeUndefined();
    expect(first.kind).toBe('shape');
    expect(first.transform).toMatchObject({
      xEmu: 0,
      yEmu: 0,
      widthEmu: ir.size.widthEmu,
      heightEmu: ir.size.heightEmu,
    });
    expect(first.fill).toMatchObject({
      kind: 'gradient',
      gradient: { type: 'linear', angleDegrees: 90 },
    });
  });
});

describe('PptxIR resources', () => {
  it('deduplicates identical inline images by content hash', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'image', props: { base64: PNG_1PX, x: 0, y: 0, w: 1, h: 1 } },
          { name: 'image', props: { base64: PNG_1PX, x: 2, y: 0, w: 1, h: 1 } },
        ]),
      ])
    );

    expect(ir.resources).toHaveLength(1);
    const ids = ir.slides[0].elements.map(
      (e) => (e as PptxIrImageElement).resourceId
    );
    expect(ids).toEqual(['res1', 'res1']);
  });

  it('keeps distinct images apart', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'image', props: { base64: PNG_1PX, x: 0, y: 0, w: 1, h: 1 } },
          {
            name: 'image',
            props: { base64: OTHER_PNG, x: 2, y: 0, w: 1, h: 1 },
          },
        ]),
      ])
    );

    expect(ir.resources.map((r) => r.id)).toEqual(['res1', 'res2']);
  });

  it('stores inline bytes with a content hash and media type', () => {
    const { ir } = compile(
      deck([
        slide([
          { name: 'image', props: { base64: PNG_1PX, x: 0, y: 0, w: 1, h: 1 } },
        ]),
      ])
    );

    const [resource] = ir.resources;
    expect(resource.mediaType).toBe('image/png');
    expect(resource.origin.kind).toBe('inline');
    if (resource.origin.kind !== 'inline') throw new Error('expected inline');
    expect(resource.origin.bytes).toBeInstanceOf(Uint8Array);
    expect(resource.origin.byteLength).toBe(resource.origin.bytes.byteLength);
    expect(resource.origin.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('wraps raw SVG markup as an inline svg resource', () => {
    const { ir, required } = compile(
      deck([
        slide([
          {
            name: 'image',
            props: {
              svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
              x: 0,
              y: 0,
              w: 1,
              h: 1,
            },
          },
        ]),
      ])
    );

    expect(ir.resources[0].mediaType).toBe('image/svg+xml');
    expect(required.map((r) => r.feature)).toContain('svg');
  });
});

describe('PptxIR feature requirements', () => {
  const featuresFor = (document: PresentationComponentDefinition) =>
    new Set(compile(document).required.map((r) => r.feature));

  it('records text and rich-text separately', () => {
    expect(
      featuresFor(deck([slide([{ name: 'text', props: { text: 'x' } }])]))
    ).toContain('text');

    expect(
      featuresFor(
        deck([
          slide([
            { name: 'text', props: { runs: [{ text: 'a' }, { text: 'b' }] } },
          ]),
        ])
      )
    ).toContain('rich-text');
  });

  it('records the fill kind actually used', () => {
    expect(
      featuresFor(
        deck([
          slide([
            {
              name: 'shape',
              props: {
                type: 'rect',
                x: 1,
                y: 1,
                w: 1,
                h: 1,
                fill: {
                  gradient: {
                    type: 'linear',
                    stops: [
                      { color: '000000', pos: 0 },
                      { color: 'FFFFFF', pos: 100 },
                    ],
                  },
                },
              },
            },
          ]),
        ])
      )
    ).toContain('gradient-fills');

    expect(
      featuresFor(
        deck([
          slide([
            {
              name: 'shape',
              props: {
                type: 'rect',
                x: 1,
                y: 1,
                w: 1,
                h: 1,
                fill: {
                  pattern: {
                    preset: 'pct50',
                    foreground: '000000',
                    background: 'FFFFFF',
                  },
                },
              },
            },
          ]),
        ])
      )
    ).toContain('pattern-fills');
  });

  it('records notes, hidden slides and backgrounds', () => {
    const features = featuresFor(
      deck([
        slide([{ name: 'text', props: { text: 'x' } }], {
          notes: 'hello',
          hidden: true,
          background: { color: 'primary' },
        }),
      ])
    );

    expect(features).toContain('speaker-notes');
    expect(features).toContain('hidden-slides');
    expect(features).toContain('backgrounds');
  });

  it('records each requirement with the IR path that needs it', () => {
    const { required } = compile(
      deck([slide([{ name: 'text', props: { text: 'x' } }])])
    );
    const textRequirement = required.find((r) => r.feature === 'text');
    expect(textRequirement?.path).toBe('slides[0].elements[0]');
  });

  it('does not require features the document never uses', () => {
    const features = featuresFor(
      deck([slide([{ name: 'text', props: { text: 'x' } }])])
    );
    expect(features.has('charts')).toBe(false);
    expect(features.has('tables')).toBe(false);
    expect(features.has('gradient-fills')).toBe(false);
  });
});

describe('PptxIR uncompiled components', () => {
  it('reports a component it cannot lower instead of dropping it', () => {
    const { unsupported } = compileDocumentToIr(
      deck([
        slide([
          {
            name: 'highcharts',
            props: {
              options: { chart: { width: 960, height: 720 }, series: [] },
              x: 1,
              y: 1,
              w: 4,
              h: 3,
            },
          },
        ]),
      ])
    );

    expect(unsupported).toEqual([
      { name: 'highcharts', path: 'slides[0].elements[0]' },
    ]);
  });

  it('lowers tables rather than reporting them', () => {
    const { unsupported, ir } = compileDocumentToIr(
      deck([
        slide([
          {
            name: 'table',
            props: { rows: [['a', 'b']], x: 1, y: 1, w: 4, h: 1 },
          },
        ]),
      ])
    );

    expect(unsupported).toEqual([]);
    expect(ir.slides[0].elements[0].kind).toBe('table');
  });
});

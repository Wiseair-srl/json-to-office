import { describe, it, expect } from 'vitest';
import { validatePresentationDocument } from '../validation/unified';

const slide = (children: any[], props: Record<string, unknown> = {}) => ({
  name: 'slide',
  props,
  children,
});

const deck = (slides: any[], props: Record<string, unknown> = {}) => ({
  name: 'pptx',
  props: { title: 'Test deck', ...props },
  children: slides,
});

describe('text runs validation', () => {
  it('accepts a text component with rich runs instead of text', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'text',
            props: {
              runs: [
                { text: '27', fontSize: 27, bold: true, color: 'primary' },
                { text: ' pts', fontSize: 18, italic: true, breakLine: true },
                { text: 'x2', superscript: true, charSpacing: 1.5 },
              ],
              x: 1,
              y: 1,
              w: 4,
              h: 1,
            },
          },
        ]),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a text component with both text and runs', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          { name: 'text', props: { text: 'Hello', runs: [{ text: 'Hi' }] } },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/props',
        code: 'mutually_exclusive',
        message: expect.stringMatching(/either "text" or "runs"/),
      })
    );
  });

  it('rejects a text component with neither text nor runs', () => {
    const result = validatePresentationDocument(
      deck([slide([{ name: 'text', props: { x: 1, y: 1 } }])])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/props',
        code: 'required_property',
      })
    );
  });

  it('does not require content on placeholder defaults stubs', () => {
    const result = validatePresentationDocument(
      deck(
        [
          slide([], {
            template: 'base',
            placeholders: {
              title: { name: 'text', props: { text: 'Actual content' } },
            },
          }),
        ],
        {
          templates: [
            {
              name: 'base',
              placeholders: [
                {
                  name: 'title',
                  x: 1,
                  y: 1,
                  defaults: {
                    name: 'text',
                    props: { fontSize: 20, color: 'primary' },
                  },
                },
              ],
            },
          ],
        }
      )
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid run shape with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'text',
            props: { runs: [{ text: 'ok' }, { text: 42 }] },
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/runs/1')
      )
    ).toBe(true);
  });
});

describe('shape gradient/pattern fill validation', () => {
  it('accepts gradient fills on shapes', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              fill: {
                gradient: {
                  type: 'linear',
                  angle: 45,
                  stops: [
                    { color: 'primary', pos: 0 },
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
        ]),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts pattern fills on shapes', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              fill: {
                pattern: {
                  preset: 'ltUpDiag',
                  foreground: 'primary',
                  background: 'FFFFFF',
                },
              },
            },
          },
        ]),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects an out-of-range gradient stop position with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              fill: {
                gradient: {
                  type: 'linear',
                  stops: [
                    { color: '112233', pos: 150 },
                    { color: '445566', pos: 100 },
                  ],
                },
              },
            },
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith(
          '/children/0/children/0/props/fill/gradient/stops/0/pos'
        )
      )
    ).toBe(true);
  });

  it('rejects a single-stop gradient with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              fill: {
                gradient: {
                  type: 'linear',
                  stops: [{ color: '112233', pos: 0 }],
                },
              },
            },
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/fill/gradient/stops')
      )
    ).toBe(true);
  });

  it('rejects an unknown pattern preset with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              fill: {
                pattern: {
                  preset: 'polkaDots',
                  foreground: '112233',
                  background: 'FFFFFF',
                },
              },
            },
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/fill/pattern')
      )
    ).toBe(true);
  });
});

describe('slide background gradient validation', () => {
  it('accepts a background gradient on slides', () => {
    const result = validatePresentationDocument(
      deck([
        slide([], {
          background: {
            gradient: {
              type: 'radial',
              focus: 'bottomRight',
              stops: [
                { color: 'primary', pos: 0 },
                { color: '000000', pos: 100 },
              ],
            },
          },
        }),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid gradient type with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([
        slide([], {
          background: {
            gradient: {
              type: 'conic',
              stops: [
                { color: '112233', pos: 0 },
                { color: '445566', pos: 100 },
              ],
            },
          },
        }),
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/props/background/gradient')
      )
    ).toBe(true);
  });
});

describe('shape angleRange and flip validation', () => {
  it('accepts angleRange, flipH, and flipV on arc-style shapes', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'pie',
              angleRange: [-90, 180],
              flipH: true,
              flipV: false,
            },
          },
          { name: 'shape', props: { type: 'arc', angleRange: [0, 270] } },
          { name: 'shape', props: { type: 'blockArc' } },
          { name: 'shape', props: { type: 'chord' } },
        ]),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a one-element angleRange with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([
        slide([{ name: 'shape', props: { type: 'pie', angleRange: [90] } }]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/angleRange')
      )
    ).toBe(true);
  });

  it('rejects a non-boolean flipH with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([slide([{ name: 'shape', props: { type: 'rect', flipH: 'yes' } }])])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/flipH')
      )
    ).toBe(true);
  });
});

describe('chart styling passthrough validation', () => {
  const chart = (extra: Record<string, unknown>) => ({
    name: 'chart',
    props: {
      type: 'bar',
      data: [{ name: 'S', labels: ['a'], values: [1] }],
      ...extra,
    },
  });

  it('accepts the new chart styling props', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          chart({
            dataBorder: { pt: 0.75, color: 'background' },
            catGridLine: { style: 'none' },
            valGridLine: { style: 'dash', size: 0.5, color: 'accent' },
            catAxisLabelFontFace: 'Inter',
            valAxisLabelFontFace: 'Inter',
            lineDataSymbolSize: 8,
            barOverlapPct: -10,
          }),
        ]),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a weight companion on every chart font-face prop', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          chart({
            titleFontFace: 'Inter',
            titleFontWeight: 300,
            legendFontFace: 'Inter',
            legendFontWeight: 500,
            catAxisLabelFontFace: 'Inter',
            catAxisLabelFontWeight: 600,
            valAxisLabelFontFace: 'Inter',
            valAxisLabelFontWeight: 700,
            dataLabelFontFace: 'Inter',
            dataLabelFontWeight: 900,
          }),
        ]),
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a chart font weight outside 100–900', () => {
    const result = validatePresentationDocument(
      deck([slide([chart({ dataLabelFontWeight: 1000 })])])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/dataLabelFontWeight')
      )
    ).toBe(true);
  });

  it('rejects an invalid gridline style with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([slide([chart({ valGridLine: { style: 'wavy' } })])])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/valGridLine')
      )
    ).toBe(true);
  });

  it('rejects a dataBorder missing its color with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([slide([chart({ dataBorder: { pt: 1 } })])])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/dataBorder')
      )
    ).toBe(true);
  });

  it('rejects an out-of-range barOverlapPct with a pointer path', () => {
    const result = validatePresentationDocument(
      deck([slide([chart({ barOverlapPct: 250 })])])
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.path.startsWith('/children/0/children/0/props/barOverlapPct')
      )
    ).toBe(true);
  });
});

describe('allowUnknownFields keeps the new props', () => {
  it('still validates new props while stripping unknown ones', () => {
    const result = validatePresentationDocument(
      deck([
        slide([
          {
            name: 'text',
            props: { runs: [{ text: 'Hello' }], someFutureProp: true },
          },
          {
            name: 'shape',
            props: { type: 'rect', flipH: true, someFutureProp: 1 },
          },
        ]),
      ]),
      { allowUnknownFields: true }
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

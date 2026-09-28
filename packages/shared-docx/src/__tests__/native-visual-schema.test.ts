/**
 * The `visual` component's two authoring surfaces, and the line between them.
 *
 * A visual can be a rasterized pptx slide or a native Word drawing group, and
 * both renderers draw either. That makes three things worth pinning here: the
 * exported schema offers both variants to an editor under either renderer,
 * the runtime accepts a native visual under either, and native mode is
 * *strict* — an element or a property it would ignore is refused, with a
 * path, rather than silently doing nothing.
 *
 * The last of those is the load-bearing one. Native mode exists to keep text
 * and shapes real; a document that validates and then ships without the chart
 * it asked for would be worse than one that never validated.
 */

import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { validate } from '../validation/unified';
import {
  VisualPropsSchema,
  VisualNativePropsSchema,
  VisualRasterPropsSchema,
  isNativeVisualProps,
  NATIVE_RENDER_MODE,
} from '../schemas/components/visual';
import {
  collectDocxRendererErrors,
  docxPropsSchemaForRenderer,
} from '../schemas/renderer';
import { unionBranches } from '@json-to-office/shared';

const NATIVE_CANVAS = { width: 6.5, height: 3 };

function document(
  visualProps: Record<string, unknown>,
  renderer?: 'docxjs' | 'office-open'
): Record<string, unknown> {
  return {
    name: 'docx',
    ...(renderer ? { renderer } : {}),
    props: {},
    children: [
      {
        name: 'section',
        props: {},
        children: [{ name: 'visual', props: visualProps }],
      },
    ],
  };
}

const nativeProps = (
  elements: Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  renderMode: NATIVE_RENDER_MODE,
  canvas: NATIVE_CANVAS,
  elements,
  ...extra,
});

/** Errors reported for a document, as `code path` pairs. */
function errorsOf(doc: Record<string, unknown>): string[] {
  const result = validate.jsonDocument(JSON.stringify(doc));
  return (result.errors ?? []).map((error) => `${error.code} ${error.path}`);
}

describe('renderer profiles for `visual`', () => {
  it.each(['docxjs', 'office-open'] as const)(
    'offers both shapes to `%s`',
    (renderer) => {
      const profiled = docxPropsSchemaForRenderer(
        'visual',
        VisualPropsSchema,
        renderer
      );

      expect(unionBranches(profiled as never)).toHaveLength(2);
      expect(Value.Check(profiled, nativeProps())).toBe(true);
      expect(
        Value.Check(profiled, { canvas: { width: 4, height: 3 }, dpi: 200 })
      ).toBe(true);
    }
  );
});

describe('the raster/native discriminator', () => {
  it('treats an omitted renderMode as raster, so old documents are unchanged', () => {
    const props = { canvas: { width: 4, height: 3 } };
    expect(Value.Check(VisualRasterPropsSchema, props)).toBe(true);
    expect(isNativeVisualProps(props as never)).toBe(false);
    expect(errorsOf(document(props))).toEqual([]);
  });

  it('accepts an explicit raster renderMode', () => {
    expect(
      errorsOf(
        document({ renderMode: 'raster', canvas: { width: 4, height: 3 } })
      )
    ).toEqual([]);
  });

  it('recognises native props', () => {
    expect(isNativeVisualProps(nativeProps() as never)).toBe(true);
    expect(Value.Check(VisualNativePropsSchema, nativeProps())).toBe(true);
  });
});

describe('native mode on either renderer', () => {
  it.each([undefined, 'docxjs', 'office-open'] as const)(
    'is accepted under %s',
    (renderer) => {
      expect(
        errorsOf(
          document(
            nativeProps([
              {
                name: 'shape',
                props: {
                  type: 'roundRect',
                  x: 0.25,
                  y: 0.25,
                  w: 2,
                  h: 1,
                  fill: { color: '#0F172A' },
                },
              },
              {
                name: 'text',
                props: { text: 'Editable Word content', x: 2.5, fontSize: 22 },
              },
              { name: 'image', props: { path: 'logo.png', w: 1 } },
            ]),
            renderer
          )
        )
      ).toEqual([]);
    }
  );

  it('leaves a raster visual alone under either renderer', () => {
    const raster = { canvas: { width: 4, height: 3 }, dpi: 200 };
    expect(errorsOf(document(raster, 'docxjs'))).toEqual([]);
    expect(errorsOf(document(raster, 'office-open'))).toEqual([]);
  });

  it("leaves a raster visual's own slide elements to the slide", () => {
    // A pptx `chart` element inside a raster visual is part of the slide, not
    // the docx `chart` component, so no docx renderer rule applies to it.
    const raster = {
      canvas: { width: 4, height: 3 },
      elements: [{ name: 'chart', props: { type: 'bar' } }],
    };
    expect(collectDocxRendererErrors(document(raster, 'docxjs'))).toEqual([]);
  });
});

describe.each(['office-open', 'docxjs'] as const)(
  'native mode is strict about what it can draw, on %s',
  (renderer) => {
    it.each(['table', 'highcharts', 'chart'])(
      'refuses a %s element, naming the element',
      (name) => {
        const errors = validate.jsonDocument(
          JSON.stringify(document(nativeProps([{ name, props: {} }]), renderer))
        ).errors;

        expect(errors).toContainEqual(
          expect.objectContaining({
            path: '/children/0/children/0/props/elements/0/name',
            code: 'unsupported_renderer_feature',
          })
        );
        expect(errors?.[errors.length - 1]?.message).toContain(name);
      }
    );

    it('refuses rasterization properties that would do nothing', () => {
      for (const [key, value] of [
        ['dpi', 200],
        ['serverUrl', 'http://localhost:7802'],
      ] as const) {
        expect(
          errorsOf(document(nativeProps([], { [key]: value }), renderer))
        ).toContain(`42 /children/0/children/0/props/${key}`);
      }
    });

    it('refuses a pptx theme on the canvas, which docx cannot resolve', () => {
      expect(
        Value.Check(VisualNativePropsSchema, {
          renderMode: 'native',
          canvas: { ...NATIVE_CANVAS, theme: 'dark' },
        })
      ).toBe(false);
    });

    it.each([
      ['text', { text: 'x', bullet: true }],
      ['text', { text: 'x', lineSpacing: 1.5 }],
      ['text', { text: 'x', style: 'title' }],
      ['shape', { type: 'rect', fill: { gradient: { stops: [] } } }],
      ['shape', { type: 'rect', shadow: { type: 'outer' } }],
      ['shape', { type: 'rect', rectRadius: 0.1 }],
      ['image', { path: 'a.png', rounding: true }],
      ['image', { path: 'a.png', hyperlink: { url: 'https://x.test' } }],
    ] as const)(
      'refuses a raster-only %s property rather than ignoring it',
      (name, props) => {
        expect(
          errorsOf(document(nativeProps([{ name, props }]), renderer))
        ).not.toEqual([]);
      }
    );

    it('still accepts every property native mode does draw', () => {
      expect(
        errorsOf(
          document(
            nativeProps([
              {
                name: 'text',
                props: {
                  runs: [
                    { text: 'Bold', bold: true },
                    {
                      text: 'and struck',
                      strike: true,
                      underline: { style: 'dbl', color: '#FF0000' },
                      breakLine: true,
                    },
                  ],
                  x: '10%',
                  y: 0.4,
                  w: '50%',
                  h: 0.5,
                  fontFace: 'Inter',
                  fontSize: 14,
                  color: 'primary',
                  italic: true,
                  align: 'center',
                  valign: 'middle',
                  margin: [2, 4, 2, 4],
                  fill: { color: '#FFFFFF', transparency: 20 },
                  rotate: 90,
                },
              },
              {
                name: 'shape',
                props: {
                  type: 'lightning',
                  x: 1,
                  y: 1,
                  w: 1,
                  h: 1,
                  fill: { color: 'accent' },
                  line: { color: '#334155', width: 1.5, dashType: 'dashDot' },
                  text: [{ text: 'Segment', bold: true, breakLine: true }],
                  fontColor: '#FFFFFF',
                  align: 'right',
                  valign: 'bottom',
                  flipH: true,
                  flipV: true,
                  rotate: -15,
                },
              },
              {
                name: 'image',
                props: {
                  base64: 'data:image/png;base64,AAAA',
                  x: 0,
                  y: 0,
                  w: 1,
                  h: 1,
                  sizing: { type: 'cover', w: 1, h: 1 },
                  rotate: 30,
                  alt: 'A logo',
                },
              },
            ]),
            renderer
          )
        )
      ).toEqual([]);
    });

    it('refuses a negative size, however it is spelled', () => {
      for (const w of [-1.5, '-50%']) {
        expect(
          errorsOf(
            document(
              nativeProps([{ name: 'shape', props: { type: 'rect', w } }]),
              renderer
            )
          )
        ).not.toEqual([]);
      }
    });

    it('still allows a negative position, which is a real placement', () => {
      // An element may legitimately start off the top-left of the canvas; only
      // its size cannot be negative.
      expect(
        errorsOf(
          document(
            nativeProps([
              {
                name: 'shape',
                props: { type: 'rect', x: '-10%', y: -0.5, w: 1, h: 1 },
              },
            ]),
            renderer
          )
        )
      ).toEqual([]);
    });

    it('reports a bad element property against the element, not the whole visual', () => {
      const errors = validate.jsonDocument(
        JSON.stringify(
          document(
            nativeProps([
              { name: 'text', props: { text: 'ok' } },
              { name: 'text', props: { text: 'x', bullet: true } },
            ]),
            renderer
          )
        )
      ).errors;

      expect(errors?.some((e) => e.path.includes('/elements/1'))).toBe(true);
    });
  }
);

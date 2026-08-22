/**
 * Shape behaviour, ported from the deleted `components/__tests__/shape.test.ts`.
 *
 * The old writer did resolution and PptxGenJS bookkeeping in one function, so
 * its tests asserted both at once. Here the two are separated: geometry names,
 * colours, warnings and passthrough props are compiler concerns and are
 * asserted on the IR; the sentinel-fill workaround and the option-bag shape are
 * PptxGenJS concerns and are asserted on the emitted opts (and, once,
 * end-to-end on slide XML).
 */

import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {
  compileDocumentToIr,
  generateBufferViaIr,
  type IrGenerationOptions,
} from '../../core/generateFromIr';
import { emitShape, type EmitContext } from '../../renderers/pptxgenjs/emit';
import type { PendingXmlFill } from '../../renderers/pptxgenjs/fills';
import type { PresentationComponentDefinition } from '../../types';
import type { PptxIrElement, PptxIrShapeElement } from '../types';
import { assertValidPptxIr } from '../validation';

/** The theme the deleted test used, as an inline document theme. */
const theme = {
  name: 'test',
  colors: {
    primary: '#0066cc',
    secondary: '#6c757d',
    accent: '#17a2b8',
    background: '#FFFFFF',
    text: '#000000',
  },
  fonts: { heading: 'Arial', body: 'Arial' },
  defaults: { fontSize: 18, fontColor: '#000000' },
};

function deck(
  shapeProps: Array<Record<string, unknown>>
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { theme, slideWidth: 10, slideHeight: 7.5 },
    children: [
      {
        name: 'slide',
        props: {},
        children: shapeProps.map((props) => ({ name: 'shape', props })),
      },
    ],
  } as unknown as PresentationComponentDefinition;
}

function compileShapes(
  shapeProps: Array<Record<string, unknown>>,
  options?: IrGenerationOptions
) {
  const result = compileDocumentToIr(deck(shapeProps), options);
  assertValidPptxIr(result.ir);
  return {
    shapes: result.ir.slides[0].elements.map((element, index) =>
      asShape(element, index)
    ),
    warnings: result.warnings,
  };
}

function asShape(element: PptxIrElement, index: number): PptxIrShapeElement {
  if (element.kind !== 'shape') {
    throw new Error(
      `expected a shape at index ${index}, got "${element.kind}"`
    );
  }
  return element;
}

/** One PptxGenJS instance is enough: only its `ShapeType` table is read. */
const pptx = new PptxGenJS();

interface EmitResult {
  addShape: ReturnType<typeof vi.fn>;
  addText: ReturnType<typeof vi.fn>;
  /** The option bag, whichever call carried it. */
  opts: Record<string, unknown>;
}

/** Emit one compiled shape against a recording slide. */
function emit(
  shape: PptxIrShapeElement,
  pendingFills?: PendingXmlFill[]
): EmitResult {
  const addShape = vi.fn();
  const addText = vi.fn();
  const ctx: EmitContext = {
    pptx,
    resources: new Map(),
    ...(pendingFills ? { pendingFills } : {}),
  };
  emitShape({ addShape, addText } as unknown as PptxGenJS.Slide, shape, ctx);
  const call = addShape.mock.calls[0] ?? addText.mock.calls[0];
  return {
    addShape,
    addText,
    opts: (call?.[1] ?? {}) as Record<string, unknown>,
  };
}

/** Compile one shape and emit it — the old `shapeOpts` helper, in two layers. */
function shapeOpts(
  props: Record<string, unknown>,
  pendingFills?: PendingXmlFill[],
  options?: IrGenerationOptions
): Record<string, unknown> {
  const { shapes } = compileShapes([props], options);
  return emit(shapes[0], pendingFills).opts;
}

describe('shape gradient fill', () => {
  it('resolves gradient stops, angle and transparency into the IR', () => {
    const { shapes, warnings } = compileShapes([
      {
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
    ]);

    expect(shapes[0].fill).toEqual({
      kind: 'gradient',
      gradient: {
        type: 'linear',
        angleDegrees: 45,
        stops: [
          { position: 0, color: { hex: '0066CC' } },
          { position: 100, color: { hex: 'FFFFFF', transparency: 30 } },
        ],
      },
    });
    expect(warnings).toEqual([]);
  });

  it('registers a pending gradient fill and renders a tagged sentinel', () => {
    const pendingFills: PendingXmlFill[] = [];
    const opts = shapeOpts(
      {
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
      pendingFills
    );

    expect(pendingFills).toHaveLength(1);
    expect(pendingFills[0].objectName).toBe('__jto_fill_0__');
    expect(pendingFills[0].xml).toBe(
      '<a:gradFill rotWithShape="1"><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="0066CC"></a:srgbClr></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="FFFFFF"><a:alpha val="70000"/></a:srgbClr></a:gs>' +
        '</a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>'
    );
    expect(opts.objectName).toBe('__jto_fill_0__');
    // Sentinel solid fill: first stop color, so a failed splice stays visible.
    // Hex is uppercase now because the IR normalises every colour on the way in.
    expect(opts.fill).toEqual({ color: '0066CC' });
  });

  it('builds radial gradients with a corner-focus fillToRect', () => {
    const pendingFills: PendingXmlFill[] = [];
    shapeOpts(
      {
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
      pendingFills
    );

    expect(pendingFills[0].xml).toContain(
      '<a:path path="circle"><a:fillToRect l="0" t="0" r="100000" b="100000"/></a:path>'
    );
    expect(pendingFills[0].xml).not.toContain('<a:lin');
  });

  it('falls back to a solid sentinel fill without a pending-fill registry', () => {
    // The old writer also pushed an ADVANCED_FILL_FALLBACK warning here. That
    // warning belonged to a renderer that could not reach the pipeline's
    // warning list any other way; the adapter has no warning channel at all, so
    // the observable contract is now just the fallback itself — sentinel colour
    // kept, no sentinel name written, nothing registered for splicing.
    const opts = shapeOpts({
      type: 'rect',
      fill: {
        gradient: {
          type: 'linear',
          stops: [
            { color: 'primary', pos: 0 },
            { color: 'FFFFFF', pos: 100 },
          ],
        },
      },
    });

    expect(opts.objectName).toBeUndefined();
    expect(opts.fill).toEqual({ color: '0066CC' });
  });

  it('warns with ADVANCED_FILL_FALLBACK and drops a gradient with no stops', () => {
    // Schema-invalid on purpose: the authoring schema requires two stops, so
    // this only reaches the compiler with validation off.
    const { shapes, warnings } = compileShapes(
      [{ type: 'rect', fill: { gradient: { type: 'linear', stops: [] } } }],
      { validation: { enabled: false } }
    );

    expect(shapes[0].fill).toBeUndefined();
    expect(warnings.map((w) => w.code)).toEqual(['ADVANCED_FILL_FALLBACK']);
  });

  it('warns with ADVANCED_FILL_FALLBACK and prefers the gradient over a pattern', () => {
    const { shapes, warnings } = compileShapes([
      {
        type: 'rect',
        fill: {
          gradient: {
            type: 'linear',
            stops: [
              { color: '112233', pos: 0 },
              { color: '445566', pos: 100 },
            ],
          },
          pattern: {
            preset: 'ltUpDiag',
            foreground: 'primary',
            background: 'FFFFFF',
          },
        },
      },
    ]);

    expect(shapes[0].fill).toMatchObject({ kind: 'gradient' });
    expect(warnings.map((w) => w.code)).toEqual(['ADVANCED_FILL_FALLBACK']);
    expect(warnings[0].component).toBe('shape');
  });
});

describe('shape pattern fill', () => {
  it('resolves pattern colours into the IR', () => {
    const { shapes, warnings } = compileShapes([
      {
        type: 'rect',
        fill: {
          pattern: {
            preset: 'ltUpDiag',
            foreground: 'primary',
            background: 'FFFFFF',
          },
        },
      },
    ]);

    expect(shapes[0].fill).toEqual({
      kind: 'pattern',
      preset: 'ltUpDiag',
      foreground: { hex: '0066CC' },
      background: { hex: 'FFFFFF' },
    });
    expect(warnings).toEqual([]);
  });

  it('registers a pending pattern fill with resolved colors', () => {
    const pendingFills: PendingXmlFill[] = [];
    const opts = shapeOpts(
      {
        type: 'rect',
        fill: {
          pattern: {
            preset: 'ltUpDiag',
            foreground: 'primary',
            background: 'FFFFFF',
          },
        },
      },
      pendingFills
    );

    expect(pendingFills).toHaveLength(1);
    expect(pendingFills[0].xml).toBe(
      '<a:pattFill prst="ltUpDiag"><a:fgClr><a:srgbClr val="0066CC"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
    );
    expect(opts.objectName).toBe('__jto_fill_0__');
    expect(opts.fill).toEqual({ color: '0066CC' });
  });

  it('warns and falls back to solid foreground on an unknown preset', () => {
    // `polkaDots` is not an OOXML preset, so the document is schema-invalid.
    const options: IrGenerationOptions = { validation: { enabled: false } };
    const props = {
      type: 'rect',
      fill: {
        pattern: {
          preset: 'polkaDots',
          foreground: 'primary',
          background: 'FFFFFF',
        },
      },
    };
    const { shapes, warnings } = compileShapes([props], options);

    expect(warnings.some((w) => w.code === 'UNKNOWN_PATTERN_PRESET')).toBe(
      true
    );
    // The warning promises the foreground; without this the shape silently
    // took the pptxgenjs default instead.
    expect(shapes[0].fill).toEqual({
      kind: 'solid',
      color: { hex: '0066CC' },
    });

    const pendingFills: PendingXmlFill[] = [];
    const opts = shapeOpts(props, pendingFills, options);
    expect(pendingFills).toHaveLength(0);
    expect(opts.objectName).toBeUndefined();
    expect(opts.fill).toEqual({ color: '0066CC' });
  });

  it('prefers an explicit fill.color over the foreground fallback', () => {
    const opts = shapeOpts(
      {
        type: 'rect',
        fill: {
          color: 'accent',
          pattern: {
            preset: 'polkaDots',
            foreground: 'primary',
            background: 'FFFFFF',
          },
        },
      },
      undefined,
      { validation: { enabled: false } }
    );

    expect(opts.fill).toEqual({ color: '17A2B8' });
  });

  it('numbers sentinel names sequentially across a generation', () => {
    const gradient = {
      type: 'linear',
      stops: [
        { color: '112233', pos: 0 },
        { color: '445566', pos: 100 },
      ],
    };
    const { shapes } = compileShapes([
      { type: 'rect', fill: { gradient } },
      { type: 'rect', fill: { gradient } },
    ]);

    // One sink per render, shared by every element in it — the numbering is a
    // property of the sink, not of module state.
    const pendingFills: PendingXmlFill[] = [];
    const first = emit(shapes[0], pendingFills).opts;
    const second = emit(shapes[1], pendingFills).opts;

    expect(pendingFills.map((f) => f.objectName)).toEqual([
      '__jto_fill_0__',
      '__jto_fill_1__',
    ]);
    expect([first.objectName, second.objectName]).toEqual([
      '__jto_fill_0__',
      '__jto_fill_1__',
    ]);
  });

  it('splices both pending fills into the slide XML and drops the sentinels', async () => {
    const gradient = {
      type: 'linear',
      stops: [
        { color: 'primary', pos: 0 },
        { color: 'FFFFFF', pos: 100 },
      ],
    };
    const { buffer } = await generateBufferViaIr(
      deck([
        { type: 'rect', x: 1, y: 1, w: 2, h: 2, fill: { gradient } },
        {
          type: 'rect',
          x: 4,
          y: 1,
          w: 2,
          h: 2,
          fill: {
            pattern: {
              preset: 'ltUpDiag',
              foreground: 'accent',
              background: 'FFFFFF',
            },
          },
        },
      ])
    );

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(xml).toContain('<a:gradFill rotWithShape="1">');
    expect(xml).toContain('<a:pattFill prst="ltUpDiag">');
    expect(xml).not.toContain('__jto_fill_');
    expect(xml).toContain('name="Fill 1"');
    expect(xml).toContain('name="Fill 2"');
  });
});

describe('shape geometry', () => {
  it('maps known geometry names straight through', () => {
    const { shapes } = compileShapes([
      { type: 'rect' },
      { type: 'ellipse' },
      { type: 'star5' },
    ]);

    expect(shapes.map((s) => s.geometry)).toEqual(['rect', 'ellipse', 'star5']);
  });

  it('aliases the authoring names PptxGenJS spells differently', () => {
    const { shapes } = compileShapes([
      { type: 'arrow' },
      { type: 'lightning' },
    ]);

    expect(shapes.map((s) => s.geometry)).toEqual([
      'rightArrow',
      'lightningBolt',
    ]);
    expect(emit(shapes[0]).addShape).toHaveBeenCalledWith(
      'rightArrow',
      expect.any(Object)
    );
    expect(emit(shapes[1]).addShape).toHaveBeenCalledWith(
      'lightningBolt',
      expect.any(Object)
    );
  });

  it('renders arc-family shape types', () => {
    // Arc-family geometry is outside the IR's known set, so it travels as a
    // `{ custom }` name; the adapter still resolves it to a PptxGenJS preset.
    for (const type of ['arc', 'pie', 'blockArc', 'chord']) {
      const { shapes } = compileShapes([{ type }]);
      expect(shapes[0].geometry).toEqual({ custom: type });
      expect(emit(shapes[0]).addShape).toHaveBeenCalledWith(
        type,
        expect.any(Object)
      );
    }
  });

  it('carries an unrecognised geometry name to a precise adapter error', () => {
    // The old writer warned UNKNOWN_SHAPE and dropped the shape. The IR keeps
    // the authored name instead — a backend with a wider preset set can honour
    // it — and the PptxGenJS adapter fails loudly rather than silently.
    const { shapes } = compileShapes([{ type: 'sprocket' }], {
      validation: { enabled: false },
    });

    expect(shapes[0].geometry).toEqual({ custom: 'sprocket' });
    expect(() => emit(shapes[0])).toThrow(/sprocket/);
  });
});

describe('shape angleRange and flips', () => {
  it('passes angleRange, flipH, and flipV straight through', () => {
    const props = {
      type: 'pie',
      angleRange: [-90, 180],
      flipH: true,
      flipV: true,
      fill: { color: 'accent' },
    };
    const { shapes } = compileShapes([props]);

    expect(shapes[0].angleRangeDegrees).toEqual([-90, 180]);
    expect(shapes[0].transform).toMatchObject({
      flipHorizontal: true,
      flipVertical: true,
    });

    expect(emit(shapes[0]).opts).toMatchObject({
      angleRange: [-90, 180],
      flipH: true,
      flipV: true,
      fill: { color: '17A2B8' },
    });
  });

  it('leaves the passthrough opts unset when absent', () => {
    const { shapes } = compileShapes([
      { type: 'rect', fill: { color: 'primary' } },
    ]);

    expect(shapes[0].angleRangeDegrees).toBeUndefined();
    expect(shapes[0].transform.flipHorizontal).toBeUndefined();
    expect(shapes[0].transform.flipVertical).toBeUndefined();

    const opts = emit(shapes[0]).opts;
    expect(opts.angleRange).toBeUndefined();
    expect(opts.flipH).toBeUndefined();
    expect(opts.flipV).toBeUndefined();
  });
});

describe('shape solid fill and line', () => {
  it('resolves a solid fill with transparency', () => {
    const { shapes } = compileShapes([
      { type: 'rect', fill: { color: 'accent', transparency: 40 } },
    ]);

    expect(shapes[0].fill).toEqual({
      kind: 'solid',
      color: { hex: '17A2B8', transparency: 40 },
    });
    expect(emit(shapes[0]).opts.fill).toEqual({
      color: '17A2B8',
      transparency: 40,
    });
  });

  it('resolves line colour, width and dash type', () => {
    const { shapes } = compileShapes([
      {
        type: 'rect',
        line: { color: 'primary', width: 2.5, dashType: 'dash' },
      },
    ]);

    expect(shapes[0].line).toEqual({
      color: { hex: '0066CC' },
      widthPoints: 2.5,
      dash: 'dash',
    });
    expect(emit(shapes[0]).opts.line).toEqual({
      color: '0066CC',
      width: 2.5,
      dashType: 'dash',
    });
  });

  it('leaves fill and line absent when unstated', () => {
    const { shapes } = compileShapes([{ type: 'rect' }]);

    expect(shapes[0].fill).toBeUndefined();
    expect(shapes[0].line).toBeUndefined();
    const opts = emit(shapes[0]).opts;
    expect(opts.fill).toBeUndefined();
    expect(opts.line).toBeUndefined();
  });
});

describe('shape text segments', () => {
  it('cascades shape font props onto each segment run', () => {
    const { shapes } = compileShapes([
      {
        type: 'rect',
        fontSize: 20,
        fontFace: 'Georgia',
        fontColor: 'primary',
        text: [
          { text: 'inherits' },
          { text: 'overrides', fontSize: 30, color: 'accent', bold: true },
        ],
      },
    ]);

    expect(shapes[0].runs).toEqual([
      expect.objectContaining({
        text: 'inherits',
        fontFamily: 'Georgia',
        fontSize: 20,
        color: { hex: '0066CC' },
      }),
      expect.objectContaining({
        text: 'overrides',
        fontFamily: 'Georgia',
        fontSize: 30,
        color: { hex: '17A2B8' },
        bold: true,
      }),
    ]);
  });

  it('emits a text-carrying shape through addText with the geometry attached', () => {
    const { shapes } = compileShapes([
      {
        type: 'roundRect',
        text: [{ text: 'a' }, { text: 'b', breakLine: true }],
      },
    ]);

    const { addShape, addText, opts } = emit(shapes[0]);
    expect(addShape).not.toHaveBeenCalled();
    expect(opts.shape).toBe('roundRect');
    expect(addText.mock.calls[0][0]).toEqual([
      { text: 'a', options: expect.any(Object) },
      { text: 'b', options: expect.objectContaining({ breakLine: true }) },
    ]);
  });

  it('keeps a plain-string shape text as a single run', () => {
    const { shapes } = compileShapes([
      { type: 'rect', text: 'Label', fontSize: 14 },
    ]);

    expect(shapes[0].runs).toEqual([
      expect.objectContaining({ text: 'Label', fontSize: 14 }),
    ]);
    const { addText } = emit(shapes[0]);
    expect(addText.mock.calls[0][0]).toBe('Label');
  });
});

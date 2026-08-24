import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it, vi } from 'vitest';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
import type {
  PipelineWarning,
  PresentationComponentDefinition,
} from '../../../types';
import type { PptxIrShapeElement } from '../../../ir/types';
import { emitShape, type EmitContext } from '../emit';
import type { PendingXmlFill } from '../fills';

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
const deck = (
  props: Array<Record<string, unknown>>
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { theme },
    children: [
      {
        name: 'slide',
        props: {},
        children: props.map((shape) => ({ name: 'shape', props: shape })),
      },
    ],
  }) as unknown as PresentationComponentDefinition;

async function compile(props: Array<Record<string, unknown>>) {
  const { ir } = await compileDocumentToIr(deck(props));
  return ir.slides[0].elements as PptxIrShapeElement[];
}

const pptx = new PptxGenJS();
function emit(
  shape: PptxIrShapeElement,
  pendingFills?: PendingXmlFill[],
  warnings?: PipelineWarning[]
) {
  const addShape = vi.fn();
  const addText = vi.fn();
  const context: EmitContext = {
    pptx,
    resources: new Map(),
    ...(pendingFills ? { pendingFills } : {}),
    ...(warnings ? { warnings } : {}),
  };
  emitShape(
    { addShape, addText } as unknown as PptxGenJS.Slide,
    shape,
    context
  );
  const call = addShape.mock.calls[0] ?? addText.mock.calls[0];
  return {
    addShape,
    addText,
    opts: (call?.[1] ?? {}) as Record<string, unknown>,
  };
}

describe('PptxGenJS shape adapter', () => {
  it('registers advanced fills and removes their sentinels during packaging', async () => {
    const gradient = {
      type: 'linear',
      stops: [
        { color: 'primary', pos: 0 },
        { color: 'FFFFFF', pos: 100 },
      ],
    };
    const [shape] = await compile([{ type: 'rect', fill: { gradient } }]);
    const pending: PendingXmlFill[] = [];
    expect(emit(shape, pending).opts).toMatchObject({
      objectName: '__jto_fill_0__',
      fill: { color: '0066CC' },
    });
    expect(pending[0].xml).toBe(
      '<a:gradFill rotWithShape="1"><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="0066CC"></a:srgbClr></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="FFFFFF"></a:srgbClr></a:gs>' +
        '</a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>'
    );

    const { buffer } = await generateBufferViaIr(
      deck([{ type: 'rect', x: 1, y: 1, w: 2, h: 2, fill: { gradient } }])
    );
    const xml = await (await JSZip.loadAsync(buffer))
      .file('ppt/slides/slide1.xml')!
      .async('string');
    expect(xml).toContain('<a:gradFill');
    expect(xml).not.toContain('__jto_fill_');
  });

  it('maps pattern and radial fills and numbers sentinels per render', async () => {
    const shapes = await compile([
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
    ]);
    const pending: PendingXmlFill[] = [];
    emit(shapes[0], pending);
    emit(shapes[1], pending);
    expect(pending.map((fill) => fill.objectName)).toEqual([
      '__jto_fill_0__',
      '__jto_fill_1__',
    ]);
    expect(pending[0].xml).toBe(
      '<a:pattFill prst="ltUpDiag"><a:fgClr><a:srgbClr val="0066CC"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
    );
    expect(pending[1].xml).toContain(
      '<a:path path="circle"><a:fillToRect l="0" t="0" r="100000" b="100000"/></a:path>'
    );
    expect(pending[1].xml).not.toContain('<a:lin');
  });

  it('maps geometry, transforms, fill and line options', async () => {
    const [shape] = await compile([
      {
        type: 'pie',
        angleRange: [-90, 180],
        flipH: true,
        flipV: true,
        fill: { color: 'accent', transparency: 40 },
        line: { color: 'primary', width: 2.5, dashType: 'dash' },
      },
    ]);
    const result = emit(shape);
    expect(result.addShape).toHaveBeenCalledWith('pie', expect.any(Object));
    expect(result.opts).toMatchObject({
      angleRange: [-90, 180],
      flipH: true,
      flipV: true,
      fill: { color: '17A2B8', transparency: 40 },
      line: { color: '0066CC', width: 2.5, dashType: 'dash' },
    });
  });

  it('warns and skips an unknown geometry', async () => {
    const document = deck([{ type: 'sprocket' }]);
    const { ir } = await compileDocumentToIr(document, {
      validation: { enabled: false },
    });
    const warnings: PipelineWarning[] = [];
    const result = emit(
      ir.slides[0].elements[0] as PptxIrShapeElement,
      undefined,
      warnings
    );
    expect(result.addShape).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_SHAPE', component: 'shape' }),
    ]);
  });

  it('maps aliases and arc-family custom geometry', async () => {
    const shapes = await compile([
      { type: 'arrow' },
      { type: 'lightning' },
      { type: 'arc' },
      { type: 'blockArc' },
    ]);
    expect(emit(shapes[0]).addShape).toHaveBeenCalledWith(
      'rightArrow',
      expect.any(Object)
    );
    expect(emit(shapes[1]).addShape).toHaveBeenCalledWith(
      'lightningBolt',
      expect.any(Object)
    );
    expect(emit(shapes[2]).addShape).toHaveBeenCalledWith(
      'arc',
      expect.any(Object)
    );
    expect(emit(shapes[3]).addShape).toHaveBeenCalledWith(
      'blockArc',
      expect.any(Object)
    );
  });

  it('emits text-carrying shapes through addText', async () => {
    const [shape] = await compile([
      {
        type: 'roundRect',
        text: [{ text: 'a' }, { text: 'b', breakLine: true }],
      },
    ]);
    const result = emit(shape);
    expect(result.addShape).not.toHaveBeenCalled();
    expect(result.opts.shape).toBe('roundRect');
    expect(result.addText.mock.calls[0][0]).toEqual([
      { text: 'a', options: expect.any(Object) },
      { text: 'b', options: expect.objectContaining({ breakLine: true }) },
    ]);

    const [plain] = await compile([
      { type: 'rect', text: 'Label', fontSize: 14 },
    ]);
    expect(emit(plain).addText.mock.calls[0][0]).toBe('Label');
  });
});

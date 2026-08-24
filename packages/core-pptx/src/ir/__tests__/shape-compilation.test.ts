import { describe, expect, it } from 'vitest';
import {
  compileDocumentToIr,
  type IrGenerationOptions,
} from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';
import type { PptxIrElement, PptxIrShapeElement } from '../types';
import { assertValidPptxIr } from '../validation';

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

function asShape(element: PptxIrElement, index: number): PptxIrShapeElement {
  if (element.kind !== 'shape') {
    throw new Error(`expected shape ${index}, got ${element.kind}`);
  }
  return element;
}

async function compileShapes(
  props: Array<Record<string, unknown>>,
  options?: IrGenerationOptions
) {
  const result = await compileDocumentToIr(deck(props), options);
  assertValidPptxIr(result.ir);
  return {
    shapes: result.ir.slides[0].elements.map(asShape),
    warnings: result.warnings,
  };
}

describe('shape fills compile to IR', () => {
  it('resolves gradients and patterns', async () => {
    const { shapes, warnings } = await compileShapes([
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
    expect(shapes[1].fill).toEqual({
      kind: 'pattern',
      preset: 'ltUpDiag',
      foreground: { hex: '0066CC' },
      background: { hex: 'FFFFFF' },
    });
    expect(warnings).toEqual([]);
  });

  it('warns and falls back for invalid advanced fills', async () => {
    const options: IrGenerationOptions = { validation: { enabled: false } };
    const empty = await compileShapes(
      [{ type: 'rect', fill: { gradient: { type: 'linear', stops: [] } } }],
      options
    );
    expect(empty.shapes[0].fill).toBeUndefined();
    expect(empty.warnings.map((warning) => warning.code)).toEqual([
      'ADVANCED_FILL_FALLBACK',
    ]);

    const unknown = await compileShapes(
      [
        {
          type: 'rect',
          fill: {
            pattern: {
              preset: 'polkaDots',
              foreground: 'primary',
              background: 'FFFFFF',
            },
          },
        },
      ],
      options
    );
    expect(unknown.shapes[0].fill).toEqual({
      kind: 'solid',
      color: { hex: '0066CC' },
    });
    expect(unknown.warnings.map((warning) => warning.code)).toContain(
      'UNKNOWN_PATTERN_PRESET'
    );
  });
});

describe('shape geometry and styling compile to IR', () => {
  it('normalizes known aliases and preserves backend-specific names', async () => {
    const { shapes } = await compileShapes([
      { type: 'rect' },
      { type: 'arrow' },
      { type: 'lightning' },
      { type: 'arc' },
    ]);
    expect(shapes.map((shape) => shape.geometry)).toEqual([
      'rect',
      'rightArrow',
      'lightningBolt',
      { custom: 'arc' },
    ]);

    const unknown = await compileShapes([{ type: 'sprocket' }], {
      validation: { enabled: false },
    });
    expect(unknown.shapes[0].geometry).toEqual({ custom: 'sprocket' });
  });

  it('records transforms, fills and lines', async () => {
    const { shapes } = await compileShapes([
      {
        type: 'pie',
        angleRange: [-90, 180],
        flipH: true,
        flipV: true,
        fill: { color: 'accent', transparency: 40 },
        line: { color: 'primary', width: 2.5, dashType: 'dash' },
      },
    ]);
    expect(shapes[0].angleRangeDegrees).toEqual([-90, 180]);
    expect(shapes[0].transform).toMatchObject({
      flipHorizontal: true,
      flipVertical: true,
    });
    expect(shapes[0].fill).toEqual({
      kind: 'solid',
      color: { hex: '17A2B8', transparency: 40 },
    });
    expect(shapes[0].line).toEqual({
      color: { hex: '0066CC' },
      widthPoints: 2.5,
      dash: 'dash',
    });
  });

  it('cascades shape font properties onto text runs', async () => {
    const { shapes } = await compileShapes([
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
});

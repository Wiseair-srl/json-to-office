import { describe, expect, it } from 'vitest';
import { PPTX_IR_SCHEMA_VERSION } from '../types';
import type {
  PptxIR,
  PptxIrShapeElement,
  PptxIrTextBoxElement,
} from '../types';
import { assertValidPptxIr, validatePptxIr } from '../validation';

function baseIr(): PptxIR {
  return {
    schemaVersion: PPTX_IR_SCHEMA_VERSION,
    metadata: {},
    size: { widthEmu: 9144000, heightEmu: 6858000 },
    theme: {
      name: 'default',
      headingFont: 'Arial',
      bodyFont: 'Arial',
      palette: { primary: '1B4F72' },
    },
    rtl: false,
    resources: [],
    slides: [],
  };
}

function textBox(
  overrides: Partial<PptxIrTextBoxElement> = {}
): PptxIrTextBoxElement {
  return {
    kind: 'textBox',
    id: 's1.e0',
    path: 'slides[0].elements[0]',
    transform: { xEmu: 0, yEmu: 0, widthEmu: 100, heightEmu: 100 },
    runs: [
      {
        text: 'x',
        fontFamily: 'Arial',
        fontSize: 18,
        color: { hex: '333333' },
      },
    ],
    style: {
      verticalAlign: 'top',
      defaults: {
        fontFamily: 'Arial',
        fontSize: 18,
        color: { hex: '333333' },
      },
    },
    ...overrides,
  };
}

function withSlide(elements: PptxIR['slides'][number]['elements']): PptxIR {
  return {
    ...baseIr(),
    slides: [
      {
        id: 'slide1',
        path: 'slides[0]',
        elements,
        hidden: false,
      },
    ],
  };
}

describe('validatePptxIr', () => {
  it('accepts a well-formed document', () => {
    expect(validatePptxIr(withSlide([textBox()]))).toEqual([]);
    expect(() => assertValidPptxIr(withSlide([textBox()]))).not.toThrow();
  });

  it('rejects a wrong schema version', () => {
    const ir = { ...baseIr(), schemaVersion: 2 } as unknown as PptxIR;
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'schemaVersion' })
    );
  });

  it('rejects a non-integer EMU transform', () => {
    const ir = withSlide([
      textBox({
        transform: { xEmu: 1.5, yEmu: 0, widthEmu: 100, heightEmu: 100 },
      }),
    ]);
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'slides[0].elements[0].transform.xEmu',
      })
    );
  });

  it('rejects a negative size', () => {
    const ir = withSlide([
      textBox({
        transform: { xEmu: 0, yEmu: 0, widthEmu: -1, heightEmu: 100 },
      }),
    ]);
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'slides[0].elements[0].transform' })
    );
  });

  it('rejects an unresolved colour token', () => {
    const ir = withSlide([
      textBox({
        runs: [
          {
            text: 'x',
            fontFamily: 'Arial',
            fontSize: 18,
            color: { hex: 'primary' },
          },
        ],
      }),
    ]);
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'slides[0].elements[0].runs[0].color' })
    );
  });

  it('rejects a lowercase hex colour', () => {
    const ir = withSlide([
      textBox({
        runs: [
          {
            text: 'x',
            fontFamily: 'Arial',
            fontSize: 18,
            color: { hex: 'aabbcc' },
          },
        ],
      }),
    ]);
    expect(validatePptxIr(ir)).toHaveLength(1);
  });

  it('rejects a run with no resolved font family or a non-positive size', () => {
    const ir = withSlide([
      textBox({
        runs: [
          { text: 'x', fontFamily: '', fontSize: 0, color: { hex: '000000' } },
        ],
      }),
    ]);
    const paths = validatePptxIr(ir).map((v) => v.path);
    expect(paths).toContain('slides[0].elements[0].runs[0].fontFamily');
    expect(paths).toContain('slides[0].elements[0].runs[0].fontSize');
  });

  it('rejects an image referencing an unknown resource', () => {
    const ir = withSlide([
      {
        kind: 'image',
        id: 's1.e0',
        path: 'slides[0].elements[0]',
        transform: { xEmu: 0, yEmu: 0, widthEmu: 10, heightEmu: 10 },
        resourceId: 'missing',
      },
    ]);
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'slides[0].elements[0].resourceId',
      })
    );
  });

  it('rejects a slide hyperlink outside the deck', () => {
    const ir = withSlide([
      textBox({
        runs: [
          {
            text: 'x',
            fontFamily: 'Arial',
            fontSize: 18,
            color: { hex: '000000' },
            hyperlink: { kind: 'slide', slideIndex: 4 },
          },
        ],
      }),
    ]);
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'slides[0].elements[0].runs[0].hyperlink.slideIndex',
      })
    );
  });

  it('rejects duplicate resource ids', () => {
    const ir = baseIr();
    ir.resources = [
      { id: 'res1', kind: 'image', origin: { kind: 'file', path: '/a.png' } },
      { id: 'res1', kind: 'image', origin: { kind: 'file', path: '/b.png' } },
    ];
    expect(validatePptxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'resources[1]' })
    );
  });

  it('rejects a gradient with no stops', () => {
    const shape: PptxIrShapeElement = {
      kind: 'shape',
      id: 's1.e0',
      path: 'slides[0].elements[0]',
      transform: { xEmu: 0, yEmu: 0, widthEmu: 10, heightEmu: 10 },
      geometry: 'rect',
      fill: {
        kind: 'gradient',
        gradient: { type: 'linear', angleDegrees: 0, stops: [] },
      },
    };
    expect(validatePptxIr(withSlide([shape]))).toContainEqual(
      expect.objectContaining({
        path: 'slides[0].elements[0].fill.gradient.stops',
      })
    );
  });

  it('reports every violation at once and names the count when throwing', () => {
    const ir = withSlide([
      textBox({
        transform: { xEmu: 0.5, yEmu: 0.5, widthEmu: 10, heightEmu: 10 },
      }),
    ]);
    expect(validatePptxIr(ir)).toHaveLength(2);
    expect(() => assertValidPptxIr(ir)).toThrow(/failed 2 invariant\(s\)/);
  });
});

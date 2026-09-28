/**
 * The docx.js drawing-group emitter, below the package: the preset and dash
 * vocabularies it translates, and the option bag it hands `ShapeGroupRun`.
 *
 * The vocabularies are round-tripped through docx itself, because the failure
 * they guard against is silent — docx writes an empty `<a:prstDash/>` for a
 * dash it does not know, which Word draws as solid.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import type {
  IShapeGroupChildOptions,
  IShapeGroupOptions,
  ShapeLineOptions,
  SolidShapeFill,
} from 'docx/shapes';
import type {
  DocxIR,
  DocxIrDrawingFrame,
  DocxIrDrawingGroupRun,
  DocxIrDrawingShape,
  DocxIrParagraph,
} from '../../../ir/types';
import { emuToPixels } from '../../../ir/units';
import {
  DEFAULT_MARKERS,
  OVERFLOW_TOLERANCE_EMU,
  chooseMarkers,
  drawingGroupOptions,
  type GroupPictureSource,
} from '../drawingGroup';
import {
  OOXML_DASH_TO_DOCX,
  OOXML_PRESET_TO_DOCX,
  docxLineDash,
  docxPresetShape,
} from '../presetShapes';

const EMU_PER_INCH = 914400;
const CANVAS_W = 6 * EMU_PER_INCH;
const CANVAS_H = 3 * EMU_PER_INCH;

async function documentXml(children: IShapeGroupChildOptions[]) {
  const shapes = await import('docx/shapes');
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new shapes.ShapeGroupRun({
                children,
                transformation: { width: 600, height: 300 },
              }),
            ],
          }),
        ],
      },
    ],
  });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  return zip.file('word/document.xml')!.async('string');
}

const frame = (
  xEmu: number,
  yEmu: number,
  widthEmu: number,
  heightEmu: number,
  extra: Partial<DocxIrDrawingFrame> = {}
): DocxIrDrawingFrame => ({ xEmu, yEmu, widthEmu, heightEmu, ...extra });

const shape = (
  overrides: Partial<DocxIrDrawingShape> = {}
): DocxIrDrawingShape => ({
  kind: 'shape',
  frame: frame(EMU_PER_INCH, EMU_PER_INCH, EMU_PER_INCH, EMU_PER_INCH),
  geometry: 'rect',
  ...overrides,
});

const BACKGROUND = shape({
  frame: frame(0, 0, CANVAS_W, CANVAS_H),
  fill: { kind: 'solid', color: { hex: 'F5F7FA' } },
  name: 'Canvas background',
});

const group = (
  children: DocxIrDrawingGroupRun['children'],
  overrides: Partial<DocxIrDrawingGroupRun> = {}
): DocxIrDrawingGroupRun => ({
  kind: 'drawingGroup',
  widthEmu: CANVAS_W,
  heightEmu: CANVAS_H,
  canvasWidthEmu: CANVAS_W,
  canvasHeightEmu: CANVAS_H,
  children,
  ...overrides,
});

const NO_PICTURES: GroupPictureSource = () => {
  throw new Error('no picture expected');
};

const options = (g: DocxIrDrawingGroupRun): IShapeGroupOptions =>
  drawingGroupOptions(g, new Map(), NO_PICTURES);

/** The one shape child the tests below care about: the last one. */
const lastChild = (g: DocxIrDrawingGroupRun) => {
  const children = options(g).children;
  return children[children.length - 1] as IShapeGroupChildOptions & {
    fill?: unknown;
    line?: unknown;
    textOptions?: { verticalAlignment?: string; margins?: object };
    children?: unknown[];
    altText?: { name: string; title?: string; description?: string };
  };
};

describe('the OOXML preset map', () => {
  const keys = Object.keys(OOXML_PRESET_TO_DOCX);

  it('covers all 187 presets, one docx name each', () => {
    expect(keys).toHaveLength(187);
    expect(new Set(Object.values(OOXML_PRESET_TO_DOCX)).size).toBe(187);
  });

  it('renames the two authorable geometries docx spells differently', () => {
    expect(docxPresetShape('rect')).toBe('rectangle');
    expect(docxPresetShape('roundRect')).toBe('roundedRectangle');
    expect(docxPresetShape('rightArrow')).toBe('rightArrow');
  });

  it('writes every preset back under its own OOXML name', async () => {
    const xml = await documentXml(
      keys.map((geometry, index) => ({
        type: docxPresetShape(geometry),
        transformation: {
          offset: { left: index, top: 0 },
          width: 10,
          height: 10,
        },
        altText: { name: geometry },
      })) as IShapeGroupChildOptions[]
    );
    const written = [...xml.matchAll(/<a:prstGeom prst="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(written).toEqual(keys);
  });

  it('refuses a geometry it has no name for', () => {
    expect(() => docxPresetShape('bogus')).toThrow(/"bogus"/);
    expect(() => docxPresetShape('toString')).toThrow(/"toString"/);
  });
});

describe('the OOXML dash map', () => {
  const keys = Object.keys(OOXML_DASH_TO_DOCX);

  it('covers the 11 preset dashes', () => {
    expect(keys).toHaveLength(11);
    expect(docxLineDash('sysDot')).toBe('shortDot');
    expect(docxLineDash('lgDashDotDot')).toBe('longDashDotDot');
  });

  it('writes every dash back under its own OOXML name', async () => {
    const xml = await documentXml(
      keys.map((dash, index) => ({
        type: 'line',
        transformation: {
          offset: { left: index * 10, top: 0 },
          width: 10,
          height: 10,
        },
        line: { color: '000000', dash: docxLineDash(dash) },
        altText: { name: dash },
      })) as IShapeGroupChildOptions[]
    );
    const written = [...xml.matchAll(/<a:prstDash val="([^"]*)"\/>/g)].map(
      (match) => match[1]
    );
    // The guard against docx's silent `<a:prstDash/>` for an unknown name.
    expect(xml).not.toContain('<a:prstDash/>');
    expect(written).toEqual(keys);
  });

  it('refuses a dash it has no name for', () => {
    expect(() => docxLineDash('bogus')).toThrow(/"bogus"/);
  });
});

describe('drawingGroupOptions', () => {
  describe('the canvas pad', () => {
    it('is left out when a full-bleed background is the first child', () => {
      const children = options(group([BACKGROUND, shape()])).children;
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        altText: { name: 'Canvas background' },
      });
    });

    it('comes first when nothing reaches the canvas edges', () => {
      const children = options(group([shape()])).children;
      expect(children).toHaveLength(2);
      expect(children[0]).toEqual({
        type: 'rectangle',
        transformation: {
          offset: { left: 0, top: 0 },
          width: emuToPixels(CANVAS_W),
          height: emuToPixels(CANVAS_H),
        },
        fill: 'none',
        line: 'none',
        decorative: true,
        altText: { name: 'Canvas' },
      });
    });

    it('is the only child of an empty group', () => {
      const children = options(group([])).children;
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ altText: { name: 'Canvas' } });
    });
  });

  describe('overflow', () => {
    it('grows the placed size at the authored scale', () => {
      const placed = group(
        [
          shape({
            frame: frame(-EMU_PER_INCH / 4, 0, EMU_PER_INCH, EMU_PER_INCH),
          }),
        ],
        { widthEmu: CANVAS_W / 2, heightEmu: CANVAS_H / 2 }
      );
      const union = CANVAS_W + EMU_PER_INCH / 4;
      expect(options(placed).transformation).toEqual({
        width: emuToPixels((union * (CANVAS_W / 2)) / CANVAS_W),
        height: emuToPixels(CANVAS_H / 2),
      });
    });

    it('treats a rounding overshoot as reaching the edge', () => {
      const overshoot = shape({
        frame: frame(0, 0, CANVAS_W + 1, CANVAS_H + OVERFLOW_TOLERANCE_EMU),
      });
      const result = options(group([overshoot, shape()]));
      expect(result.children).toHaveLength(2);
      expect(result.transformation).toEqual({
        width: emuToPixels(CANVAS_W),
        height: emuToPixels(CANVAS_H),
      });
    });
  });

  describe('fill and line', () => {
    it('states no fill and no line where docx would draw them', () => {
      const child = lastChild(group([shape()]));
      expect(child.fill).toBe('none');
      expect(child.line).toBe('none');
      expect(lastChild(group([shape({ fill: { kind: 'none' } })])).fill).toBe(
        'none'
      );
    });

    it('maps a solid fill and clamps its transparency', () => {
      const fill = (transparencyPercent?: number) =>
        lastChild(
          group([
            shape({
              fill: {
                kind: 'solid',
                color: { hex: '0F172A' },
                ...(transparencyPercent !== undefined
                  ? { transparencyPercent }
                  : {}),
              },
            }),
          ])
        ).fill as SolidShapeFill;
      expect(fill()).toEqual({ type: 'solid', color: '0F172A' });
      expect(fill(25)).toEqual({
        type: 'solid',
        color: '0F172A',
        transparency: 25,
      });
      expect(fill(150).transparency).toBe(100);
    });

    it('maps width, colour and dash, clamping the width', () => {
      const line = (widthEmu?: number, dash?: string) =>
        lastChild(
          group([
            shape({
              outline: {
                color: { hex: '334155' },
                ...(widthEmu !== undefined ? { widthEmu } : {}),
                ...(dash ? { dash } : {}),
              },
            }),
          ])
        ).line as ShapeLineOptions;
      expect(line(19050, 'sysDot')).toEqual({
        color: '334155',
        width: 1.5,
        dash: 'shortDot',
      });
      expect(line(2000 * 12700).width).toBe(1584);
      // No width is office-open's omitted `w`: a hairline, not docx's 1pt.
      expect(line()).toEqual({ color: '334155', width: 0 });
    });

    it('draws no line for an outline without a colour', () => {
      expect(
        lastChild(group([shape({ outline: { widthEmu: 12700 } })])).line
      ).toBe('none');
    });
  });

  describe('text', () => {
    const paragraph: DocxIrParagraph = {
      kind: 'paragraph',
      id: 's0.b0.g0.p0',
      path: 'sections[0].children[0]',
      children: [{ kind: 'text', text: 'Inside' }],
    };

    it('anchors at the top unless told otherwise', () => {
      expect(
        lastChild(group([shape({ text: { paragraphs: [paragraph] } })]))
          .textOptions
      ).toEqual({ verticalAlignment: 'top' });
      expect(
        lastChild(
          group([
            shape({ text: { paragraphs: [paragraph], anchor: 'middle' } }),
          ])
        ).textOptions
      ).toEqual({ verticalAlignment: 'center' });
    });

    it('gives the insets in points, clamped, and only the sides stated', () => {
      expect(
        lastChild(
          group([
            shape({
              text: {
                paragraphs: [paragraph],
                insetsEmu: { left: 12700, top: 0, right: 2000 * 12700 },
              },
            }),
          ])
        ).textOptions
      ).toEqual({
        verticalAlignment: 'top',
        margins: { left: 1, top: 0, right: 1584 },
      });
    });

    it('passes paragraphs as children, and no children for none', () => {
      expect(
        lastChild(group([shape({ text: { paragraphs: [paragraph] } })]))
          .children
      ).toHaveLength(1);
      expect(
        'children' in lastChild(group([shape({ text: { paragraphs: [] } })]))
      ).toBe(false);
    });
  });

  describe('names and markers', () => {
    it('keeps the IR names and falls back to a numbered one', () => {
      const children = drawingGroupOptions(
        group([
          BACKGROUND,
          shape(),
          {
            kind: 'picture',
            frame: frame(0, 0, EMU_PER_INCH, EMU_PER_INCH),
            resourceId: 'res0',
          },
        ]),
        new Map(),
        () => ({ type: 'png', data: Buffer.from('png') })
      ).children;
      expect(
        children.map(
          (child) => (child as { altText: { name: string } }).altText.name
        )
      ).toEqual(['Canvas background', 'Shape 2', 'Picture 3']);
    });

    it('names a picture with its fallback and states its alt text and crop', () => {
      const picture = drawingGroupOptions(
        group([
          BACKGROUND,
          {
            kind: 'picture',
            frame: frame(0, 0, EMU_PER_INCH, EMU_PER_INCH),
            resourceId: 'res0',
            altText: 'a swatch',
            crop: { left: 0.25, right: 0.125 },
          },
        ]),
        new Map(),
        (resourceId, placement) => {
          expect(resourceId).toBe('res0');
          expect(placement).toEqual({
            widthEmu: EMU_PER_INCH,
            heightEmu: EMU_PER_INCH,
          });
          return { type: 'png', data: Buffer.from('png') };
        }
      ).children[1];
      expect(picture).toMatchObject({
        type: 'picture',
        crop: { left: 25, right: 12.5 },
        altText: { name: 'Picture 2', description: 'a swatch' },
      });
    });

    it('describes a group without alt text with the marker', () => {
      expect(options(group([BACKGROUND])).altText).toEqual({
        name: '',
        description: DEFAULT_MARKERS.noAltText,
      });
      // An empty string is no alt text either: docx would describe the
      // diagram from its children's names.
      expect(options(group([BACKGROUND], { altText: '' })).altText).toEqual({
        name: '',
        description: DEFAULT_MARKERS.noAltText,
      });
      expect(
        options(group([BACKGROUND], { altText: 'A labelled diagram' })).altText
      ).toEqual({ name: '', description: 'A labelled diagram' });
    });

    it('titles a text box, and only a text box, with the marker', () => {
      expect(
        lastChild(group([BACKGROUND, shape({ isTextBox: true })])).altText
      ).toEqual({ name: 'Shape 2', title: DEFAULT_MARKERS.textBox });
      expect(lastChild(group([BACKGROUND, shape()])).altText).toEqual({
        name: 'Shape 2',
      });
    });
  });
});

describe('chooseMarkers', () => {
  const ir = (...texts: string[]): DocxIR =>
    ({
      sections: [
        {
          children: texts.map((text) => ({
            kind: 'paragraph',
            children: [{ kind: 'text', text }],
          })),
        },
      ],
      resources: [
        {
          id: 'res0',
          kind: 'image',
          bytes: new TextEncoder().encode('jto:no-alt-text jto:text-box'),
        },
      ],
    }) as unknown as DocxIR;

  it('returns the defaults for a plain document', () => {
    expect(chooseMarkers(ir('Hello'))).toEqual(DEFAULT_MARKERS);
  });

  it('skips a marker that authored text contains', () => {
    expect(chooseMarkers(ir('see jto:no-alt-text here'))).toEqual({
      noAltText: 'jto:no-alt-text-1',
      textBox: 'jto:text-box',
    });
    expect(
      chooseMarkers(ir('jto:no-alt-text', 'jto:no-alt-text-1', 'jto:text-box'))
    ).toEqual({ noAltText: 'jto:no-alt-text-2', textBox: 'jto:text-box-1' });
  });

  it('ignores image bytes', () => {
    // `ir()` always carries bytes spelling both markers.
    expect(chooseMarkers(ir())).toEqual(DEFAULT_MARKERS);
  });
});

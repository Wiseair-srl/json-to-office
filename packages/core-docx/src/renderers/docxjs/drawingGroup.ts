/**
 * A drawing group (`wpg:wgp`), as a `docx/shapes` `ShapeGroupRun`.
 *
 * **A group, not a canvas.** `docx/shapes` also has `ShapeCanvasRun`, but a
 * canvas's children keep their own size, so a canvas authored at one size and
 * placed at another cannot be expressed; it also writes the whole diagram
 * twice (`wpc:wpc` plus a `wpg:wgp` fallback in `mc:AlternateContent`). A
 * group scales its children onto its extent and writes one bare `wpg:wgp`,
 * which is exactly what the office-open adapter writes.
 *
 * **The pad.** `ShapeGroupRun` has no child-space option: it sets `a:chOff`
 * and `a:chExt` to the union of the children's unrotated boxes. The IR's child
 * space is the whole canvas, so when the children do not already reach every
 * edge — any visual without a background — the first (bottom-most) child is an
 * invisible, decorative rectangle the size of the canvas, the same pad
 * upstream's own canvas-to-group fallback uses. With a background the union
 * already is the canvas and no pad is written, so the child list matches
 * office-open's.
 *
 * **The tolerance.** The compiler rounds each offset and extent on its own, so
 * an element meant to end on the canvas edge can overshoot it by an EMU or
 * two. Within `OVERFLOW_TOLERANCE_EMU` that counts as reaching the edge: no
 * pad, and the placed size is kept. Beyond it the children really overflow,
 * and the group keeps the authored scale — the extent grows by the overflow —
 * where office-open draws the overflow outside a frame of the placed size.
 *
 * **The markers.** docx.js writes two things this adapter must not keep, and
 * offers no option to leave them out, so each is replaced by a marker the
 * post-pack repair (`drawingGroupRepair.ts`) removes:
 * - With no truthy alt text, docx.js describes the group from its children's
 *   names (`descr="Canvas background. Shape elements[0]."`). A marker
 *   description suppresses that, and the repair drops the attribute.
 * - It never writes `wps:cNvSpPr txBox="1"`, which is how Word tells a text box
 *   from a shape holding text. A marker title on the text box's `wps:cNvPr`
 *   says where it belongs, and the repair moves it there.
 * The markers are chosen per IR (`chooseMarkers`) so that no string an author
 * wrote can contain one: nothing authored is ever stripped, and the repair's
 * check that no marker survived cannot be tripped by content.
 *
 * **Stated defaults.** Where `docx/shapes` defaults differ from OOXML's, the
 * OOXML default is stated: text anchored at the top rather than centred, no
 * fill, and no line rather than a black 1pt one.
 *
 * **Partial outlines**, as office-open draws them: an outline with no colour
 * strokes nothing (office-open writes an `a:ln` with no fill), and one with a
 * colour but no width is a hairline (`w="0"`, office-open's omitted `w`).
 *
 * **Clamps.** docx throws for a line width or text inset outside 0–1584pt,
 * which is also the most `ST_LineWidth` and Word allow; the schema has no
 * maximum for either, so they are clamped rather than refused. Transparency is
 * clamped to 0–100 for the same reason.
 */

import type { IFloating } from 'docx';
import type {
  IShapeGroupChildOptions,
  IShapeGroupOptions,
  ImageSource,
  ShapeFill,
  ShapeLine,
  ShapeTextOptions,
} from 'docx/shapes';
import type {
  DocxIR,
  DocxIrDrawingFill,
  DocxIrDrawingFrame,
  DocxIrDrawingGroupChild,
  DocxIrDrawingGroupRun,
  DocxIrDrawingOutline,
  DocxIrDrawingPicture,
  DocxIrDrawingShape,
  DocxIrDrawingText,
} from '../../ir/types';
import { emuToPixels } from '../../ir/units';
import {
  emitParagraph,
  floatingOptions,
  type DrawingGroupFactory,
  type EmitResources,
} from './emit';
import { docxLineDash, docxPresetShape } from './presetShapes';

export type ShapesModule = typeof import('docx/shapes');

/** The picture a group child draws, for one resource at one size. */
export type GroupPictureSource = (
  resourceId: string,
  placement: { widthEmu: number; heightEmu: number }
) => ImageSource;

export interface DrawingGroupMarkers {
  /** A `wp:docPr` description standing for "no alt text". */
  readonly noAltText: string;
  /** A `wps:cNvPr` title standing for `wps:cNvSpPr txBox="1"`. */
  readonly textBox: string;
}

export const DEFAULT_MARKERS: DrawingGroupMarkers = {
  noAltText: 'jto:no-alt-text',
  textBox: 'jto:text-box',
};

const EMU_PER_POINT = 12700;
/** docx's range for line widths and text margins, and `ST_LineWidth`'s maximum. */
const MAX_POINTS = 1584;
/** Two independent `Math.round` calls in `ir/nativeVisual.ts`: 1 EMU each. */
export const OVERFLOW_TOLERANCE_EMU = 2;

/**
 * Markers no string in this IR contains, so the repair can never strip or
 * trip on authored content.
 */
export function chooseMarkers(ir: DocxIR): DrawingGroupMarkers {
  const strings: string[] = [];
  collectStrings(ir, strings, new WeakSet());
  const unused = (base: string): string => {
    for (let n = 0; ; n += 1) {
      const candidate = n === 0 ? base : `${base}-${n}`;
      if (!strings.some((value) => value.includes(candidate))) return candidate;
    }
  };
  return {
    noAltText: unused(DEFAULT_MARKERS.noAltText),
    textBox: unused(DEFAULT_MARKERS.textBox),
  };
}

/** Every string reachable from `node`, skipping binary data. */
function collectStrings(
  node: unknown,
  out: string[],
  seen: WeakSet<object>
): void {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  // Image bytes: never text, and walking them would cost more than the rest.
  if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node instanceof Map) {
    for (const [key, value] of node) {
      collectStrings(key, out, seen);
      collectStrings(value, out, seen);
    }
    return;
  }
  if (node instanceof Set) {
    for (const value of node) collectStrings(value, out, seen);
    return;
  }
  for (const value of Object.values(node)) collectStrings(value, out, seen);
}

export function createDrawingGroupFactory(
  shapes: ShapesModule,
  pictures: GroupPictureSource,
  markers: DrawingGroupMarkers
): DrawingGroupFactory {
  return (group, resources) =>
    new shapes.ShapeGroupRun(
      drawingGroupOptions(group, resources, pictures, markers)
    );
}

/** Exported for tests: asserting on the option bag needs no `docx/shapes`. */
export function drawingGroupOptions(
  group: DocxIrDrawingGroupRun,
  resources: EmitResources,
  pictures: GroupPictureSource,
  markers: DrawingGroupMarkers = DEFAULT_MARKERS
): IShapeGroupOptions {
  const canvasWidth = group.canvasWidthEmu;
  const canvasHeight = group.canvasHeightEmu;
  const near = (value: number, edge: number): boolean =>
    Math.abs(value - edge) <= OVERFLOW_TOLERANCE_EMU;
  const bounds = unrotatedBounds(group.children);
  const fillsCanvas =
    bounds !== undefined &&
    near(bounds.left, 0) &&
    near(bounds.top, 0) &&
    near(bounds.right, canvasWidth) &&
    near(bounds.bottom, canvasHeight);
  const union = {
    left: Math.min(0, bounds?.left ?? 0),
    top: Math.min(0, bounds?.top ?? 0),
    right: Math.max(canvasWidth, bounds?.right ?? 0),
    bottom: Math.max(canvasHeight, bounds?.bottom ?? 0),
  };
  const overflows =
    union.left < -OVERFLOW_TOLERANCE_EMU ||
    union.top < -OVERFLOW_TOLERANCE_EMU ||
    union.right > canvasWidth + OVERFLOW_TOLERANCE_EMU ||
    union.bottom > canvasHeight + OVERFLOW_TOLERANCE_EMU;
  // Overflowing children keep the authored scale: the canvas region keeps its
  // placed size and the extent grows by what reaches past it.
  const widthEmu = overflows
    ? ((union.right - union.left) * group.widthEmu) / canvasWidth
    : group.widthEmu;
  const heightEmu = overflows
    ? ((union.bottom - union.top) * group.heightEmu) / canvasHeight
    : group.heightEmu;

  return {
    children: [
      ...(fillsCanvas ? [] : [canvasPad(canvasWidth, canvasHeight)]),
      ...group.children.map((child, index) =>
        groupChild(child, index, resources, pictures, markers)
      ),
    ],
    transformation: {
      width: emuToPixels(widthEmu),
      height: emuToPixels(heightEmu),
    },
    // `||`, not `??`: docx treats '' as no description too, and would then
    // describe the diagram from the child names.
    altText: { name: '', description: group.altText || markers.noAltText },
    ...(group.floating
      ? { floating: floatingOptions(group.floating) as unknown as IFloating }
      : {}),
  };
}

function groupChild(
  child: DocxIrDrawingGroupChild,
  index: number,
  resources: EmitResources,
  pictures: GroupPictureSource,
  markers: DrawingGroupMarkers
): IShapeGroupChildOptions {
  return child.kind === 'picture'
    ? pictureChild(child, index, pictures)
    : shapeChild(child, index, resources, markers);
}

/** An invisible rectangle the size of the canvas; see the module comment. */
function canvasPad(
  canvasWidthEmu: number,
  canvasHeightEmu: number
): IShapeGroupChildOptions {
  return {
    type: 'rectangle',
    transformation: {
      offset: { left: 0, top: 0 },
      width: emuToPixels(canvasWidthEmu),
      height: emuToPixels(canvasHeightEmu),
    },
    fill: 'none',
    line: 'none',
    decorative: true,
    altText: { name: 'Canvas' },
  };
}

/**
 * A child's `a:xfrm`, in pixels. Fractional pixels round-trip every EMU
 * exactly (docx writes `Math.round(px * 9525)`). The rotation is passed in
 * degrees; docx writes it unrounded, and the repair pass rounds it.
 */
function childTransformation(frame: DocxIrDrawingFrame): {
  offset: { left: number; top: number };
  width: number;
  height: number;
  rotation?: number;
  flip?: { horizontal?: boolean; vertical?: boolean };
} {
  const rotation = frame.rotationDegrees;
  return {
    offset: { left: emuToPixels(frame.xEmu), top: emuToPixels(frame.yEmu) },
    width: emuToPixels(frame.widthEmu),
    height: emuToPixels(frame.heightEmu),
    ...(rotation !== undefined && rotation % 360 !== 0 ? { rotation } : {}),
    ...(frame.flipHorizontal || frame.flipVertical
      ? {
          flip: {
            ...(frame.flipHorizontal ? { horizontal: true } : {}),
            ...(frame.flipVertical ? { vertical: true } : {}),
          },
        }
      : {}),
  };
}

function shapeChild(
  shape: DocxIrDrawingShape,
  index: number,
  resources: EmitResources,
  markers: DrawingGroupMarkers
): IShapeGroupChildOptions {
  const paragraphs = shape.text?.paragraphs ?? [];
  return {
    type: docxPresetShape(shape.geometry),
    transformation: childTransformation(shape.frame),
    fill: shapeFill(shape.fill),
    line: shapeLine(shape.outline),
    altText: {
      name: shape.name ?? `Shape ${index + 1}`,
      ...(shape.isTextBox ? { title: markers.textBox } : {}),
    },
    // Never `children: []`: docx would write an empty `w:txbxContent`, which
    // the schema does not allow.
    ...(paragraphs.length > 0
      ? {
          children: paragraphs.map((paragraph) =>
            emitParagraph(paragraph, resources)
          ),
        }
      : {}),
    ...(shape.text ? { textOptions: textOptions(shape.text) } : {}),
  } as IShapeGroupChildOptions;
}

function pictureChild(
  picture: DocxIrDrawingPicture,
  index: number,
  pictures: GroupPictureSource
): IShapeGroupChildOptions {
  // The IR crops by a fraction of each side, docx by a percentage.
  const crop = picture.crop;
  return {
    type: 'picture',
    image: pictures(picture.resourceId, {
      widthEmu: picture.frame.widthEmu,
      heightEmu: picture.frame.heightEmu,
    }),
    transformation: childTransformation(picture.frame),
    ...(crop
      ? {
          crop: {
            ...(crop.left !== undefined ? { left: crop.left * 100 } : {}),
            ...(crop.top !== undefined ? { top: crop.top * 100 } : {}),
            ...(crop.right !== undefined ? { right: crop.right * 100 } : {}),
            ...(crop.bottom !== undefined ? { bottom: crop.bottom * 100 } : {}),
          },
        }
      : {}),
    altText: {
      name: picture.name ?? `Picture ${index + 1}`,
      ...(picture.altText ? { description: picture.altText } : {}),
    },
  };
}

function shapeFill(fill: DocxIrDrawingFill | undefined): ShapeFill {
  if (!fill || fill.kind === 'none') return 'none';
  return {
    type: 'solid',
    color: fill.color.hex,
    ...(fill.transparencyPercent !== undefined
      ? { transparency: clamp(fill.transparencyPercent, 0, 100) }
      : {}),
  };
}

function shapeLine(outline: DocxIrDrawingOutline | undefined): ShapeLine {
  // office-open writes an outline with no colour as an `a:ln` with no fill,
  // which strokes nothing; `'none'` draws the same.
  if (!outline || !outline.color) return 'none';
  return {
    color: outline.color.hex,
    // An omitted width is office-open's omitted `w`, a hairline, where docx's
    // own default would be 1pt.
    width:
      outline.widthEmu !== undefined
        ? clamp(outline.widthEmu / EMU_PER_POINT, 0, MAX_POINTS)
        : 0,
    ...(outline.dash ? { dash: docxLineDash(outline.dash) } : {}),
  };
}

/** Vertical anchoring, which docx centres by default and OOXML tops. */
const VERTICAL_ALIGNMENT = {
  top: 'top',
  middle: 'center',
  bottom: 'bottom',
} as const;

function textOptions(text: DocxIrDrawingText): ShapeTextOptions {
  const insets = text.insetsEmu;
  const points = (emu: number): number =>
    clamp(emu / EMU_PER_POINT, 0, MAX_POINTS);
  const margins = insets
    ? {
        ...(insets.top !== undefined ? { top: points(insets.top) } : {}),
        ...(insets.right !== undefined ? { right: points(insets.right) } : {}),
        ...(insets.bottom !== undefined
          ? { bottom: points(insets.bottom) }
          : {}),
        ...(insets.left !== undefined ? { left: points(insets.left) } : {}),
      }
    : undefined;
  return {
    verticalAlignment: VERTICAL_ALIGNMENT[text.anchor ?? 'top'],
    ...(margins && Object.keys(margins).length > 0 ? { margins } : {}),
  };
}

/** The box around the children's unrotated frames, which docx.js unions. */
function unrotatedBounds(
  children: readonly DocxIrDrawingGroupChild[]
): { left: number; top: number; right: number; bottom: number } | undefined {
  if (children.length === 0) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { frame } of children) {
    left = Math.min(left, frame.xEmu);
    top = Math.min(top, frame.yEmu);
    right = Math.max(right, frame.xEmu + frame.widthEmu);
    bottom = Math.max(bottom, frame.yEmu + frame.heightEmu);
  }
  return { left, top, right, bottom };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

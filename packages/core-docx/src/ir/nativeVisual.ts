/**
 * Lowering a native `visual` into a DocxIR drawing group.
 *
 * A raster visual leaves the tree long before compilation — it becomes an
 * `image`. A native one survives, and this is where it stops being an
 * authoring surface and becomes drawn objects: absolute EMU frames in the
 * group's own coordinate space, resolved colours, registered picture bytes.
 *
 * Two rules shape everything here.
 *
 * *Strict.* The native element model is narrower than the raster one, and
 * anything outside it is refused rather than approximated. A `chart` element,
 * an unresolvable colour, an image whose bytes never arrived: each stops the
 * document with the path that caused it. Silently drawing something else would
 * ship a graphic the author did not design.
 *
 * *Pure.* Every byte and every theme lookup arrives through {@link
 * NativeVisualDeps}, so this is a function of its inputs — same visual, same
 * group, which is what lets a native document be byte-deterministic and
 * golden-tested without a service anywhere in sight.
 *
 * Geometry is inches or a percentage of the canvas. The raster path's rule
 * that a number at or above 100 is already EMU is deliberately not reproduced:
 * a native canvas is inches all the way down.
 */

import type {
  NativeVisualElement,
  NativeVisualImageProps,
  NativeVisualShapeProps,
  NativeVisualTextProps,
  VisualNativeProps,
} from '@json-to-office/shared-docx';
import type {
  DocxIrAlignment,
  DocxIrColor,
  DocxIrDrawingFill,
  DocxIrDrawingFrame,
  DocxIrDrawingGroupChild,
  DocxIrDrawingOutline,
  DocxIrDrawingPicture,
  DocxIrDrawingShape,
  DocxIrDrawingText,
  DocxIrParagraph,
  DocxIrRunFormatting,
  DocxIrInline,
} from './types';
import {
  inchesToEmu,
  pointsToEmu,
  pointsToHalfPoints,
  emuToInches,
} from './units';
// The same source string the pre-pass keyed its loaded bytes by. Using a
// second, equivalent-looking encoder here would silently miss every lookup.
import { resolveImageSource as imageSource } from '../utils/imageUtils';

/** A picture resource the compiler has already loaded and registered. */
export interface NativePictureResource {
  resourceId: string;
  mediaType: string;
  /** Pixel size as stored, when the header could be read. */
  intrinsic?: { width: number; height: number };
}

/**
 * What lowering needs from the compiler.
 *
 * Deliberately four narrow capabilities rather than the compile context: the
 * lowering has no business reaching for bookmarks, numbering or section
 * geometry, and saying so in the type keeps it that way.
 */
export interface NativeVisualDeps {
  /** Resolve an authored colour to hex, or `undefined` if it names nothing. */
  color(value: string): DocxIrColor | undefined;
  /** Register an image source's bytes, or `undefined` if they never loaded. */
  picture(source: string): NativePictureResource | undefined;
  /** Refuse the component, naming what could not be drawn. */
  reject(detail: string): void;
  /** Report something worth knowing that did not stop the drawing. */
  warn(message: string): void;
}

/** The pixel density an image's stored size is interpreted at. */
const PIXELS_PER_INCH = 96;

/** An unstated width covers three quarters of the canvas, as pptx does. */
const DEFAULT_WIDTH_FRACTION = 0.75;

/** Font size assumed when deriving a text box's height and none was stated. */
const ASSUMED_FONT_SIZE_POINTS = 18;

/** Shortest text box a derived height will produce, in inches. */
const MIN_DERIVED_TEXT_HEIGHT_INCHES = 0.5;

/** Line box as a multiple of the font size, when deriving a height. */
const DERIVED_LINE_HEIGHT_RATIO = 1.6;

/**
 * Preset geometry names that differ from the authored `type`.
 *
 * `arrow` and `lightning` are this project's names; OOXML calls the same
 * shapes `rightArrow` and `lightningBolt`. Writing the authored spelling as
 * `prst` produces a shape Word cannot draw, so the rename is not cosmetic.
 */
const GEOMETRY_ALIASES: Readonly<Record<string, string>> = {
  arrow: 'rightArrow',
  lightning: 'lightningBolt',
};

/** Authored dash names that are already OOXML `a:prstDash` values. */
const DASH_VALUES: ReadonlySet<string> = new Set([
  'solid',
  'dash',
  'dot',
  'dashDot',
]);

const ANCHOR: Readonly<Record<string, 'top' | 'middle' | 'bottom'>> = {
  top: 'top',
  middle: 'middle',
  bottom: 'bottom',
};

/**
 * OOXML spells justified alignment `both`; the IR spells it `justified`. The
 * authoring surface says `justify`, like CSS, so the three meet here.
 */
const ALIGNMENT: Readonly<Record<string, DocxIrAlignment>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justified',
};

/** One `[property path, authored colour]` pair awaiting resolution. */
type ColorEntry = [string, string | undefined];

/** The canvas, in EMU, that every element resolves against. */
interface Canvas {
  widthEmu: number;
  heightEmu: number;
}

/** The drawn children of one native visual, in z-order. */
export interface NativeVisualGroup {
  canvas: Canvas;
  children: DocxIrDrawingGroupChild[];
}

/**
 * Lower a native visual's canvas and elements into drawing-group children.
 *
 * Returns `undefined` when something was refused; the refusal has already been
 * reported through `deps.reject`, which is what stops the document.
 */
export function compileNativeVisualGroup(
  props: VisualNativeProps,
  outer: NativeVisualDeps
): NativeVisualGroup | undefined {
  const canvas: Canvas = {
    widthEmu: inchesToEmu(props.canvas.width),
    heightEmu: inchesToEmu(props.canvas.height),
  };

  const children: DocxIrDrawingGroupChild[] = [];

  // Refusal is tracked on the reject channel, not on a `undefined` return.
  // The two are different outcomes: an element that draws nothing (a text
  // element with no text) leaves the rest of the drawing intact, while a
  // refusal has to stop the document. Conflating them made one empty label
  // delete the whole graphic — silently, because nothing had been rejected.
  let refused = false;
  const deps: NativeVisualDeps = {
    ...outer,
    reject: (detail) => {
      refused = true;
      outer.reject(detail);
    },
  };

  // The background is drawn first because it is behind everything: a group has
  // no background of its own, so a canvas colour is a full-bleed rectangle and
  // a canvas image is a full-bleed picture, both at index 0.
  const background = props.canvas.background;
  if (background?.color) {
    const color = deps.color(background.color);
    if (!color) {
      deps.reject(`canvas.background.color "${background.color}"`);
    } else {
      children.push({
        kind: 'shape',
        frame: fullBleed(canvas),
        geometry: 'rect',
        fill: { kind: 'solid', color },
        name: 'Canvas background',
      });
    }
  }
  if (background?.image) {
    const source = imageSource(background.image);
    const resource = source ? deps.picture(source) : undefined;
    if (!resource) {
      deps.reject('canvas.background.image could not be loaded');
    } else {
      children.push({
        kind: 'picture',
        frame: fullBleed(canvas),
        resourceId: resource.resourceId,
        name: 'Canvas background',
      });
    }
  }

  for (const [index, element] of (props.elements ?? []).entries()) {
    // A disabled element produces no output, exactly as a disabled component
    // does — the drawing is what the enabled elements say it is.
    if (element.enabled === false) continue;
    const child = compileElement(element, index, canvas, deps);
    if (child) children.push(child);
  }

  return refused ? undefined : { canvas, children };
}

function compileElement(
  element: NativeVisualElement,
  index: number,
  canvas: Canvas,
  deps: NativeVisualDeps
): DocxIrDrawingGroupChild | undefined {
  const at = `elements[${index}]`;
  switch (element.name) {
    case 'text':
      return compileText(element.props, at, canvas, deps);
    case 'shape':
      return compileShape(element.props, at, canvas, deps);
    case 'image':
      return compileImage(element.props, at, canvas, deps);
    default:
      // Unreachable through validation; a caller that bypassed it still gets a
      // refusal rather than a silently missing object.
      deps.reject(`${at} is a "${(element as { name: string }).name}"`);
      return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

function compileText(
  props: NativeVisualTextProps,
  at: string,
  canvas: Canvas,
  deps: NativeVisualDeps
): DocxIrDrawingShape | undefined {
  const runs = textRuns(props);
  if (!runs) {
    deps.warn(
      `[core-docx] native visual ${at} has neither "text" nor "runs"; nothing was drawn for it.`
    );
    return undefined;
  }

  const colors = resolveColors(
    [
      ['color', props.color],
      ['fill.color', props.fill?.color],
      ...runs.map((run, i): ColorEntry => [`runs[${i}].color`, run.color]),
      ...runs.map(
        (run, i): ColorEntry => [
          `runs[${i}].underline.color`,
          underlineColor(run.underline),
        ]
      ),
      ['underline.color', underlineColor(props.underline)],
    ],
    at,
    deps
  );
  if (!colors) return undefined;

  const frame = resolveFrame(props, canvas, {
    defaultHeightInches: derivedTextHeightInches(props, runs),
  });

  const paragraphs = textParagraphs(runs, props, colors, at);

  return {
    kind: 'shape',
    frame,
    geometry: 'rect',
    isTextBox: true,
    // A text box with no fill is transparent, which is what the rasterized
    // path draws; saying so explicitly stops Word applying its own default.
    fill: props.fill?.color
      ? solidFill(colors.get('fill.color')!, props.fill.transparency)
      : { kind: 'none' },
    text: {
      paragraphs,
      // pptx anchors a text box at the top unless told otherwise, and a
      // drawing that changes anchor between render modes moves its text.
      anchor: ANCHOR[props.valign ?? 'top'] ?? 'top',
      // A text box's insets default to nothing, again matching pptx. A shape
      // deliberately leaves them unstated so OOXML's own defaults apply.
      insetsEmu: marginInsets(props.margin) ?? ZERO_INSETS,
    },
    name: `Text ${at}`,
  };
}

const ZERO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 } as const;

/** The runs a text element draws, or `undefined` when it draws nothing. */
function textRuns(
  props: NativeVisualTextProps
): NativeVisualTextProps['runs'] | undefined {
  if (props.runs?.length) return props.runs;
  if (props.text === undefined) return undefined;
  return [{ text: props.text }];
}

function textParagraphs(
  runs: NonNullable<NativeVisualTextProps['runs']>,
  props: NativeVisualTextProps,
  colors: ReadonlyMap<string, DocxIrColor>,
  at: string
): DocxIrParagraph[] {
  const paragraphs: DocxIrParagraph[] = [];
  let current: DocxIrInline[] = [];

  const flush = (): void => {
    paragraphs.push({
      kind: 'paragraph',
      id: `${at}.p${paragraphs.length}`,
      path: `${at}.paragraphs[${paragraphs.length}]`,
      children: current,
      formatting: {
        ...(props.align ? { alignment: ALIGNMENT[props.align]! } : {}),
        // A drawing's text is set flush against the shape; the document's
        // paragraph spacing would push it away from the top edge, which is not
        // what an absolutely-placed box means.
        spacing: { beforeTwips: 0, afterTwips: 0 },
      },
    });
    current = [];
  };

  runs.forEach((run, index) => {
    const formatting = runFormatting(run, props, colors, index);
    // A newline inside run text is a line break, not a literal character:
    // pptx splits on it, and a native drawing that did not would collapse
    // every multi-line label onto one line.
    const lines = run.text.split('\n');
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) current.push({ kind: 'lineBreak' });
      if (line) {
        current.push({ kind: 'text', text: line, ...formatting });
      }
    });
    // `breakLine` ends the paragraph rather than adding a break, so paragraph
    // alignment applies per line the way the raster path lays it out.
    if (run.breakLine && index < runs.length - 1) flush();
  });

  flush();
  return paragraphs;
}

function runFormatting(
  run: NonNullable<NativeVisualTextProps['runs']>[number],
  props: NativeVisualTextProps,
  colors: ReadonlyMap<string, DocxIrColor>,
  index: number
): { formatting?: DocxIrRunFormatting } {
  const fontFamily = run.fontFace ?? props.fontFace;
  const sizePoints = run.fontSize ?? props.fontSize;
  const color =
    colors.get(`runs[${index}].color`) ??
    (run.color === undefined ? colors.get('color') : undefined);
  const bold = run.bold ?? props.bold;
  const italic = run.italic ?? props.italic;
  const strike = run.strike ?? props.strike;
  // A run's underline brings its own colour; an underline inherited from the
  // element brings the element's. Reading the run's key either way dropped the
  // colour of every element-level underline.
  const underline = compileUnderline(
    run.underline ?? props.underline,
    colors.get(
      run.underline !== undefined
        ? `runs[${index}].underline.color`
        : 'underline.color'
    )
  );

  const formatting: DocxIrRunFormatting = {
    ...(fontFamily ? { fontFamily } : {}),
    ...(sizePoints !== undefined
      ? { sizeHalfPoints: pointsToHalfPoints(sizePoints) }
      : {}),
    ...(color ? { color } : {}),
    ...(bold !== undefined ? { bold } : {}),
    ...(italic !== undefined ? { italic } : {}),
    ...(strike !== undefined ? { strike } : {}),
    ...(underline ? { underline } : {}),
  };
  return Object.keys(formatting).length > 0 ? { formatting } : {};
}

/** OOXML's underline names for the four the authoring surface offers. */
const UNDERLINE_TYPES: Readonly<Record<string, string>> = {
  sng: 'single',
  dbl: 'double',
  dash: 'dash',
  dotted: 'dotted',
};

function compileUnderline(
  value: NativeVisualTextProps['underline'],
  color: DocxIrColor | undefined
): DocxIrRunFormatting['underline'] {
  if (value === undefined || value === false) return undefined;
  const style = value === true ? 'sng' : value.style ?? 'sng';
  return {
    type: UNDERLINE_TYPES[style] ?? 'single',
    ...(color ? { color } : {}),
  };
}

function underlineColor(
  value: NativeVisualTextProps['underline']
): string | undefined {
  return typeof value === 'object' ? value.color : undefined;
}

/**
 * The height a text box gets when it states none.
 *
 * Mirrors the raster path exactly — including its choice to size from the
 * stated font size rather than any style's — because switching `renderMode`
 * must not move the text.
 */
function derivedTextHeightInches(
  props: NativeVisualTextProps,
  runs: NonNullable<NativeVisualTextProps['runs']>
): number {
  const fontSize = props.fontSize ?? ASSUMED_FONT_SIZE_POINTS;
  const lineCount = runs.reduce(
    (total, run) =>
      total + (run.breakLine ? 1 : 0) + (run.text.match(/\n/g)?.length ?? 0),
    1
  );
  return Math.max(
    MIN_DERIVED_TEXT_HEIGHT_INCHES,
    (fontSize / 72) * DERIVED_LINE_HEIGHT_RATIO * lineCount
  );
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

function compileShape(
  props: NativeVisualShapeProps,
  at: string,
  canvas: Canvas,
  deps: NativeVisualDeps
): DocxIrDrawingShape | undefined {
  const segments = shapeSegments(props);
  const colors = resolveColors(
    [
      ['fill.color', props.fill?.color],
      ['line.color', props.line?.color],
      ['fontColor', props.fontColor],
      ...segments.map(
        (segment, i): ColorEntry => [`text[${i}].color`, segment.color]
      ),
    ],
    at,
    deps
  );
  if (!colors) return undefined;

  const frame = resolveFrame(props, canvas, { defaultHeightInches: 0 });
  if (props.flipH) frame.flipHorizontal = true;
  if (props.flipV) frame.flipVertical = true;

  const dash = props.line?.dashType;
  if (dash !== undefined && !DASH_VALUES.has(dash)) {
    deps.reject(`${at}.line.dashType "${dash}"`);
    return undefined;
  }

  const outline: DocxIrDrawingOutline | undefined = props.line
    ? {
        ...(colors.get('line.color')
          ? { color: colors.get('line.color')! }
          : {}),
        ...(props.line.width !== undefined
          ? { widthEmu: pointsToEmu(props.line.width) }
          : {}),
        ...(dash && dash !== 'solid' ? { dash } : {}),
      }
    : undefined;

  const text: DocxIrDrawingText | undefined = segments.length
    ? {
        paragraphs: shapeParagraphs(segments, props, colors, at),
        anchor: ANCHOR[props.valign ?? 'middle'] ?? 'middle',
        // Unstated insets are left unstated so OOXML's own shape defaults
        // apply, which is what the raster path draws.
        ...(marginInsets(props.margin)
          ? { insetsEmu: marginInsets(props.margin)! }
          : {}),
      }
    : undefined;

  return {
    kind: 'shape',
    frame,
    geometry: GEOMETRY_ALIASES[props.type] ?? props.type,
    ...(props.fill
      ? {
          fill: props.fill.color
            ? solidFill(colors.get('fill.color')!, props.fill.transparency)
            : ({ kind: 'none' } as const),
        }
      : {}),
    ...(outline && Object.keys(outline).length > 0 ? { outline } : {}),
    ...(text ? { text } : {}),
    name: `Shape ${at}`,
  };
}

type ShapeSegment = { text: string; color?: string } & Pick<
  NativeVisualShapeProps,
  'fontFace' | 'fontSize' | 'bold' | 'italic'
> & { breakLine?: boolean };

function shapeSegments(props: NativeVisualShapeProps): ShapeSegment[] {
  if (props.text === undefined) return [];
  if (typeof props.text === 'string') {
    return props.text ? [{ text: props.text }] : [];
  }
  return props.text;
}

function shapeParagraphs(
  segments: readonly ShapeSegment[],
  props: NativeVisualShapeProps,
  colors: ReadonlyMap<string, DocxIrColor>,
  at: string
): DocxIrParagraph[] {
  const paragraphs: DocxIrParagraph[] = [];
  let current: DocxIrInline[] = [];

  const flush = (): void => {
    paragraphs.push({
      kind: 'paragraph',
      id: `${at}.p${paragraphs.length}`,
      path: `${at}.paragraphs[${paragraphs.length}]`,
      children: current,
      formatting: {
        // A shape centres its text unless told otherwise, which is what the
        // rasterized shape draws.
        alignment: props.align ? ALIGNMENT[props.align]! : 'center',
        spacing: { beforeTwips: 0, afterTwips: 0 },
      },
    });
    current = [];
  };

  segments.forEach((segment, index) => {
    const fontFamily = segment.fontFace ?? props.fontFace;
    const sizePoints = segment.fontSize ?? props.fontSize;
    const color =
      colors.get(`text[${index}].color`) ??
      (segment.color === undefined ? colors.get('fontColor') : undefined);
    const bold = segment.bold ?? props.bold;
    const italic = segment.italic ?? props.italic;
    const formatting: DocxIrRunFormatting = {
      ...(fontFamily ? { fontFamily } : {}),
      ...(sizePoints !== undefined
        ? { sizeHalfPoints: pointsToHalfPoints(sizePoints) }
        : {}),
      ...(color ? { color } : {}),
      ...(bold !== undefined ? { bold } : {}),
      ...(italic !== undefined ? { italic } : {}),
    };
    const wrapped =
      Object.keys(formatting).length > 0 ? { formatting } : undefined;

    segment.text.split('\n').forEach((line, lineIndex) => {
      if (lineIndex > 0) current.push({ kind: 'lineBreak' });
      if (line) current.push({ kind: 'text', text: line, ...wrapped });
    });
    if (segment.breakLine && index < segments.length - 1) flush();
  });

  flush();
  return paragraphs;
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

function compileImage(
  props: NativeVisualImageProps,
  at: string,
  canvas: Canvas,
  deps: NativeVisualDeps
): DocxIrDrawingPicture | undefined {
  const source = imageSource(props);
  if (!source) {
    deps.reject(`${at} has none of "path", "base64" or "svg"`);
    return undefined;
  }
  const resource = deps.picture(source);
  if (!resource) {
    deps.reject(`${at} image could not be loaded`);
    return undefined;
  }

  const aspect = resource.intrinsic
    ? resource.intrinsic.width / resource.intrinsic.height
    : undefined;
  const intrinsicInches = resource.intrinsic
    ? {
        width: resource.intrinsic.width / PIXELS_PER_INCH,
        height: resource.intrinsic.height / PIXELS_PER_INCH,
      }
    : undefined;

  const box = resolveImageBox(props, canvas, aspect, intrinsicInches);
  const sizing = props.sizing;
  if (!sizing || !aspect) {
    // With no intrinsic size there is nothing to fit against, so the image
    // stretches to its box — the same thing the raster path falls back to.
    if (sizing && !aspect) {
      deps.warn(
        `[core-docx] native visual ${at} asks for "${sizing.type}" sizing, but the image's stored size could not be read; it was stretched to its box instead.`
      );
    }
    return picture(box, props, resource, at);
  }

  const boxAspect = box.widthEmu / box.heightEmu;
  if (sizing.type === 'contain') {
    // Fit inside and centre, by moving the frame — no crop, so the whole
    // image stays visible.
    const fitted =
      boxAspect > aspect
        ? {
            widthEmu: Math.round(box.heightEmu * aspect),
            heightEmu: box.heightEmu,
          }
        : {
            widthEmu: box.widthEmu,
            heightEmu: Math.round(box.widthEmu / aspect),
          };
    return picture(
      {
        ...box,
        xEmu: box.xEmu + Math.round((box.widthEmu - fitted.widthEmu) / 2),
        yEmu: box.yEmu + Math.round((box.heightEmu - fitted.heightEmu) / 2),
        ...fitted,
      },
      props,
      resource,
      at
    );
  }

  // `cover` and `crop` both keep the box and trim the image. Cover trims
  // symmetrically so the subject stays centred; crop takes the top-left
  // corner, which is the only origin the authoring surface can express.
  const visible =
    boxAspect > aspect
      ? { widthFraction: 1, heightFraction: aspect / boxAspect }
      : { widthFraction: boxAspect / aspect, heightFraction: 1 };
  const crop =
    sizing.type === 'cover'
      ? {
          ...(visible.widthFraction < 1
            ? {
                left: (1 - visible.widthFraction) / 2,
                right: (1 - visible.widthFraction) / 2,
              }
            : {}),
          ...(visible.heightFraction < 1
            ? {
                top: (1 - visible.heightFraction) / 2,
                bottom: (1 - visible.heightFraction) / 2,
              }
            : {}),
        }
      : {
          ...(visible.widthFraction < 1
            ? { right: 1 - visible.widthFraction }
            : {}),
          ...(visible.heightFraction < 1
            ? { bottom: 1 - visible.heightFraction }
            : {}),
        };

  return picture(box, props, resource, at, crop);
}

function picture(
  frame: DocxIrDrawingFrame,
  props: NativeVisualImageProps,
  resource: NativePictureResource,
  at: string,
  crop?: DocxIrDrawingPicture['crop']
): DocxIrDrawingPicture {
  return {
    kind: 'picture',
    frame,
    resourceId: resource.resourceId,
    ...(props.alt ? { altText: props.alt } : {}),
    ...(crop && Object.keys(crop).length > 0 ? { crop } : {}),
    name: `Image ${at}`,
  };
}

/**
 * The box an image is drawn into.
 *
 * An unstated axis is derived from the image's own aspect ratio, and an image
 * that states neither is drawn at its stored size — the rule the raster path
 * uses, so an image does not resize when the render mode changes.
 */
function resolveImageBox(
  props: NativeVisualImageProps,
  canvas: Canvas,
  aspect: number | undefined,
  intrinsicInches: { width: number; height: number } | undefined
): DocxIrDrawingFrame {
  // `sizing.w`/`sizing.h` state the box the image is fitted into and take
  // precedence over the element's own `w`/`h` — the precedence the raster path
  // applies (`sizing.w ?? props.w` in resolveImageLayout). Reading only
  // `props.w` here drew the same JSON at two very different sizes depending on
  // the render mode.
  const width = props.sizing?.w ?? props.w;
  const height = props.sizing?.h ?? props.h;
  const widthEmu =
    width !== undefined ? resolveExtent(width, canvas.widthEmu) : undefined;
  const heightEmu =
    height !== undefined ? resolveExtent(height, canvas.heightEmu) : undefined;

  const resolved = ((): { widthEmu: number; heightEmu: number } => {
    if (widthEmu !== undefined && heightEmu !== undefined) {
      return { widthEmu, heightEmu };
    }
    if (widthEmu !== undefined) {
      return {
        widthEmu,
        heightEmu: aspect
          ? Math.round(widthEmu / aspect)
          : Math.round(widthEmu * (3 / 4)),
      };
    }
    if (heightEmu !== undefined) {
      return {
        widthEmu: aspect
          ? Math.round(heightEmu * aspect)
          : Math.round(heightEmu * (4 / 3)),
        heightEmu,
      };
    }
    if (intrinsicInches) {
      return {
        widthEmu: inchesToEmu(intrinsicInches.width),
        heightEmu: inchesToEmu(intrinsicInches.height),
      };
    }
    const fallbackWidth = Math.round(canvas.widthEmu * DEFAULT_WIDTH_FRACTION);
    return {
      widthEmu: fallbackWidth,
      heightEmu: Math.round(fallbackWidth * (3 / 4)),
    };
  })();

  return {
    xEmu: props.x !== undefined ? resolveOffset(props.x, canvas.widthEmu) : 0,
    yEmu: props.y !== undefined ? resolveOffset(props.y, canvas.heightEmu) : 0,
    ...resolved,
    ...rotation(props.rotate),
  };
}

/* ------------------------------------------------------------------ *
 * Geometry, colour and shared helpers
 * ------------------------------------------------------------------ */

function fullBleed(canvas: Canvas): DocxIrDrawingFrame {
  return {
    xEmu: 0,
    yEmu: 0,
    widthEmu: canvas.widthEmu,
    heightEmu: canvas.heightEmu,
  };
}

/**
 * An element's frame: position, size and rotation, all in EMU.
 *
 * The unstated defaults are the raster path's — origin at the canvas corner,
 * three quarters of the canvas wide — so a visual that switches render mode
 * does not rearrange itself.
 */
function resolveFrame(
  props: {
    x?: number | string;
    y?: number | string;
    w?: number | string;
    h?: number | string;
    rotate?: number;
  },
  canvas: Canvas,
  options: { defaultHeightInches: number }
): DocxIrDrawingFrame {
  return {
    xEmu: props.x !== undefined ? resolveOffset(props.x, canvas.widthEmu) : 0,
    yEmu: props.y !== undefined ? resolveOffset(props.y, canvas.heightEmu) : 0,
    widthEmu:
      props.w !== undefined
        ? resolveExtent(props.w, canvas.widthEmu)
        : Math.round(canvas.widthEmu * DEFAULT_WIDTH_FRACTION),
    heightEmu:
      props.h !== undefined
        ? resolveExtent(props.h, canvas.heightEmu)
        : inchesToEmu(options.defaultHeightInches),
    ...rotation(props.rotate),
  };
}

/** A whole turn is not a rotation; stating it would only bloat the XML. */
function rotation(degrees: number | undefined): { rotationDegrees?: number } {
  if (degrees === undefined || degrees % 360 === 0) return {};
  return { rotationDegrees: degrees };
}

function resolveOffset(value: number | string, axisEmu: number): number {
  return resolveLength(value, axisEmu);
}

function resolveExtent(value: number | string, axisEmu: number): number {
  return Math.max(0, resolveLength(value, axisEmu));
}

/** Inches, or a percentage of the canvas extent on this axis. */
function resolveLength(value: number | string, axisEmu: number): number {
  if (typeof value === 'number') return inchesToEmu(value);
  const percent = Number.parseFloat(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.round((percent / 100) * axisEmu);
}

/** Points on each side → EMU insets, in the schema's `[t, r, b, l]` order. */
function marginInsets(
  margin: number | number[] | undefined
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (margin === undefined) return undefined;
  const [top, right, bottom, left] = Array.isArray(margin)
    ? margin
    : [margin, margin, margin, margin];
  return {
    top: pointsToEmu(top ?? 0),
    right: pointsToEmu(right ?? 0),
    bottom: pointsToEmu(bottom ?? 0),
    left: pointsToEmu(left ?? 0),
  };
}

function solidFill(
  color: DocxIrColor,
  transparency: number | undefined
): DocxIrDrawingFill {
  return {
    kind: 'solid',
    color,
    ...(transparency !== undefined && transparency > 0
      ? { transparencyPercent: transparency }
      : {}),
  };
}

/**
 * Resolve every colour an element names, in one pass.
 *
 * Batched rather than resolved at each use so a document with an unresolvable
 * token fails once, naming the property that holds it, instead of throwing
 * from wherever the value happened to be read.
 */
function resolveColors(
  entries: readonly [string, string | undefined][],
  at: string,
  deps: NativeVisualDeps
): Map<string, DocxIrColor> | undefined {
  const resolved = new Map<string, DocxIrColor>();
  let failed = false;
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const color = deps.color(value);
    if (!color) {
      deps.reject(`${at}.${key} "${value}"`);
      failed = true;
      continue;
    }
    resolved.set(key, color);
  }
  return failed ? undefined : resolved;
}

/** Exported for tests that assert the inches↔EMU contract directly. */
export const nativeVisualUnits = { inchesToEmu, emuToInches };

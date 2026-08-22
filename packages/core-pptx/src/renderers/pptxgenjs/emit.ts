/**
 * PptxIR → PptxGenJS calls.
 *
 * Each function here maps one IR node onto the option bag PptxGenJS expects.
 * They are deliberately small and free of policy: every cascade, default and
 * unit conversion already happened in the compiler, so this layer only
 * translates vocabulary.
 *
 * Unit note: the IR is in EMU, PptxGenJS takes inches. Dividing is exact
 * against the compiler's `Math.round(inches * 914400)` because PptxGenJS
 * applies the same rounding on the way in.
 */

import type PptxGenJS from 'pptxgenjs';
import { assertNever } from '@json-to-office/shared/rendering';
import type {
  PptxIrColor,
  PptxIrElement,
  PptxIrFill,
  PptxIrGeometry,
  PptxIrHyperlink,
  PptxIrImageElement,
  PptxIrLine,
  PptxIrResource,
  PptxIrShadow,
  PptxIrShapeElement,
  PptxIrTextBodyStyle,
  PptxIrTextBoxElement,
  PptxIrTextRun,
  PptxIrTransform,
} from '../../ir/types';
import { emuToInches } from '../../ir/units';
import type { PendingFillSink } from './fills';
import { registerAdvancedFill } from './fills';
import { emitChart } from './chart';
import { emitTable } from './table';

type Opts = Record<string, unknown>;

/** Resources by id, so an element's `resourceId` can be turned into a source. */
export type ResourceLookup = ReadonlyMap<string, PptxIrResource>;

export interface EmitContext {
  pptx: PptxGenJS;
  resources: ResourceLookup;
  /** Registry for fills PptxGenJS cannot express. Absent disables the splice. */
  pendingFills?: PendingFillSink;
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export function transformOpts(transform: PptxIrTransform): Opts {
  const opts: Opts = {
    x: emuToInches(transform.xEmu),
    y: emuToInches(transform.yEmu),
    w: emuToInches(transform.widthEmu),
    h: emuToInches(transform.heightEmu),
  };
  if (transform.rotationDegrees !== undefined) {
    opts.rotate = transform.rotationDegrees;
  }
  if (transform.flipHorizontal) opts.flipH = true;
  if (transform.flipVertical) opts.flipV = true;
  return opts;
}

/** PptxGenJS wants bare hex; the IR already stores it that way. */
export function colorValue(color: PptxIrColor): string {
  return color.hex;
}

export function lineOpts(line: PptxIrLine): Opts {
  const opts: Opts = {};
  if (line.color) opts.color = colorValue(line.color);
  if (line.widthPoints !== undefined) opts.width = line.widthPoints;
  if (line.dash) opts.dashType = line.dash;
  return opts;
}

export function shadowOpts(shadow: PptxIrShadow): Opts {
  return {
    type: shadow.type,
    color: colorValue(shadow.color),
    blur: shadow.blurPoints,
    offset: shadow.offsetPoints,
    angle: shadow.angleDegrees,
    opacity: shadow.opacity,
  };
}

export function hyperlinkOpts(link: PptxIrHyperlink): Opts {
  return link.kind === 'external'
    ? { url: link.url, tooltip: link.tooltip }
    : { slide: link.slideIndex, tooltip: link.tooltip };
}

/**
 * Apply a fill.
 *
 * Solid fills map directly. Gradients and patterns do not exist in the
 * PptxGenJS API, so they are registered for the post-generation splice and a
 * sentinel solid fill is written in their place — the workaround lives here,
 * never in the IR.
 */
export function applyFill(
  opts: Opts,
  fill: PptxIrFill,
  elementPath: string,
  ctx: EmitContext
): void {
  switch (fill.kind) {
    case 'none':
      opts.fill = { type: 'none' };
      return;
    case 'solid': {
      const value: Opts = { color: colorValue(fill.color) };
      if (fill.color.transparency !== undefined) {
        value.transparency = fill.color.transparency;
      }
      opts.fill = value;
      return;
    }
    case 'gradient':
    case 'pattern':
      registerAdvancedFill(opts, fill, elementPath, ctx.pendingFills);
      return;
    case 'image':
      // Modelled in the IR; PptxGenJS has no shape image fill. Capability
      // checking rejects this before render, so reaching it is a bug.
      throw new Error(
        `PptxGenJS cannot apply an image fill (${elementPath}); this should have failed capability checking`
      );
    default:
      assertNever(fill, 'PptxIrFill');
  }
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

export function textBodyOpts(style: PptxIrTextBodyStyle): Opts {
  const opts: Opts = { valign: style.verticalAlign };
  if (style.insetPoints !== undefined) opts.margin = style.insetPoints;
  if (style.align) opts.align = style.align;
  if (style.lineSpacingMultiple !== undefined) {
    opts.lineSpacingMultiple = style.lineSpacingMultiple;
  } else if (style.lineSpacingPoints !== undefined) {
    opts.lineSpacing = style.lineSpacingPoints;
  }
  if (style.spaceBeforePoints !== undefined) {
    opts.paraSpaceBefore = style.spaceBeforePoints;
  }
  if (style.spaceAfterPoints !== undefined) {
    opts.paraSpaceAfter = style.spaceAfterPoints;
  }
  if (style.bullet) {
    opts.bullet =
      style.bullet.style === undefined && style.bullet.startAt === undefined
        ? style.bullet.type === 'bullet'
        : {
            type: style.bullet.type,
            ...(style.bullet.style ? { style: style.bullet.style } : {}),
            ...(style.bullet.startAt !== undefined
              ? { startAt: style.bullet.startAt }
              : {}),
          };
  }
  if (style.autoFit) opts.isTextBox = true;
  return opts;
}

/** Run-level options. Every value is already resolved; nothing cascades here. */
export function runOpts(run: PptxIrTextRun): Opts {
  const opts: Opts = {
    fontFace: run.fontFamily,
    fontSize: run.fontSize,
    color: colorValue(run.color),
  };
  if (run.bold !== undefined) opts.bold = run.bold;
  if (run.italic !== undefined) opts.italic = run.italic;
  if (run.strike !== undefined) opts.strike = run.strike;
  if (run.underline)
    opts.underline = run.underline.color
      ? { style: run.underline.style, color: colorValue(run.underline.color) }
      : { style: run.underline.style };
  if (run.superscript !== undefined) opts.superscript = run.superscript;
  if (run.subscript !== undefined) opts.subscript = run.subscript;
  if (run.characterSpacing !== undefined) {
    opts.charSpacing = run.characterSpacing;
  }
  if (run.language) opts.lang = run.language;
  if (run.breakAfter !== undefined) opts.breakLine = run.breakAfter;
  if (run.spaceBeforePoints !== undefined) {
    opts.paraSpaceBefore = run.spaceBeforePoints;
  }
  if (run.spaceAfterPoints !== undefined) {
    opts.paraSpaceAfter = run.spaceAfterPoints;
  }
  if (run.hyperlink) opts.hyperlink = hyperlinkOpts(run.hyperlink);
  return opts;
}

/**
 * Block-level options for a text body.
 *
 * These come from the body's own defaults, never from whichever run happens to
 * be first: PptxGenJS merges run options over block options, and it also uses
 * the block options for the trailing `endParaRPr`. Hoisting run 0's formatting
 * would leak it onto every later run that does not override it.
 */
function bodyDefaultOpts(style: PptxIrTextBodyStyle): Opts {
  const defaults = style.defaults;
  const opts: Opts = {
    fontFace: defaults.fontFamily,
    fontSize: defaults.fontSize,
    color: colorValue(defaults.color),
  };
  if (defaults.bold !== undefined) opts.bold = defaults.bold;
  if (defaults.italic !== undefined) opts.italic = defaults.italic;
  if (defaults.language) opts.lang = defaults.language;
  return opts;
}

export function emitTextBox(
  slide: PptxGenJS.Slide,
  element: PptxIrTextBoxElement,
  ctx: EmitContext
): void {
  const opts: Opts = {
    ...transformOpts(element.transform),
    ...bodyDefaultOpts(element.style),
    ...textBodyOpts(element.style),
  };
  if (element.fill) applyFill(opts, element.fill, element.path, ctx);
  if (element.shadow) opts.shadow = shadowOpts(element.shadow);
  if (element.hyperlink) opts.hyperlink = hyperlinkOpts(element.hyperlink);
  if (element.altText) opts.altText = element.altText;

  emitRuns(slide, element.runs, opts);
}

function emitRuns(
  slide: PptxGenJS.Slide,
  runs: readonly PptxIrTextRun[],
  opts: Opts
): void {
  if (runs.length === 1) {
    const [only] = runs;
    // A lone run's formatting is already hoisted into `opts` by
    // `commonRunOpts`; anything run-specific still has to be applied.
    Object.assign(opts, runOpts(only));
    slide.addText(only.text, opts as never);
    return;
  }
  const segments = runs.map((run) => ({
    text: run.text,
    options: runOpts(run) as never,
  }));
  slide.addText(segments as never, opts as never);
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** Map an IR geometry name to a PptxGenJS `ShapeType` member. */
export function shapeType(
  geometry: PptxIrGeometry,
  pptx: PptxGenJS
): unknown | undefined {
  const name = typeof geometry === 'string' ? geometry : geometry.custom;
  return (pptx.ShapeType as unknown as Record<string, unknown>)[name];
}

export function emitShape(
  slide: PptxGenJS.Slide,
  element: PptxIrShapeElement,
  ctx: EmitContext
): void {
  const type = shapeType(element.geometry, ctx.pptx);
  if (type === undefined) {
    // Capability checking rejects unknown geometry before render.
    throw new Error(
      `PptxGenJS has no shape for geometry "${describeGeometry(element.geometry)}" (${element.path})`
    );
  }

  const opts: Opts = { ...transformOpts(element.transform) };
  if (element.fill) applyFill(opts, element.fill, element.path, ctx);
  if (element.line) opts.line = lineOpts(element.line);
  if (element.shadow) opts.shadow = shadowOpts(element.shadow);
  if (element.cornerRadius !== undefined)
    opts.rectRadius = element.cornerRadius;
  if (element.angleRangeDegrees) opts.angleRange = element.angleRangeDegrees;
  if (element.hyperlink) opts.hyperlink = hyperlinkOpts(element.hyperlink);
  if (element.altText) opts.altText = element.altText;

  if (element.runs && element.runs.length > 0) {
    opts.shape = type;
    if (element.style) {
      Object.assign(opts, bodyDefaultOpts(element.style));
      Object.assign(opts, textBodyOpts(element.style));
    }
    emitRuns(slide, element.runs, opts);
    return;
  }

  slide.addShape(type as never, opts as never);
}

function describeGeometry(geometry: PptxIrGeometry): string {
  return typeof geometry === 'string' ? geometry : geometry.custom;
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Turn a resource into the `path`/`data` pair PptxGenJS expects.
 *
 * Inline bytes become a data URI; file and remote origins keep their location
 * so PptxGenJS streams them exactly as it did before the IR existed.
 */
export function imageSourceOpts(resource: PptxIrResource): Opts {
  switch (resource.origin.kind) {
    case 'inline': {
      const base64 = Buffer.from(resource.origin.bytes).toString('base64');
      const mediaType = resource.mediaType ?? 'image/png';
      return { data: `data:${mediaType};base64,${base64}` };
    }
    case 'file':
      return { path: resource.origin.path };
    case 'remote':
      return { path: resource.origin.url };
    default:
      return assertNever(resource.origin, 'PptxIrResourceOrigin');
  }
}

export function emitImage(
  slide: PptxGenJS.Slide,
  element: PptxIrImageElement,
  ctx: EmitContext
): void {
  const resource = ctx.resources.get(element.resourceId);
  if (!resource) {
    throw new Error(
      `Image ${element.path} references unknown resource "${element.resourceId}"`
    );
  }

  const opts: Opts = {
    ...imageSourceOpts(resource),
    ...transformOpts(element.transform),
  };
  if (element.sizing) {
    // EMU rather than inches: PptxGenJS reads these through the same parser as
    // positions, which treats anything at or above 100 as already-EMU, so
    // passing EMU is exact for any real box size.
    opts.sizing = {
      type: element.sizing.type,
      w: element.sizing.widthEmu,
      h: element.sizing.heightEmu,
      ...(element.sizing.xEmu !== undefined ? { x: element.sizing.xEmu } : {}),
      ...(element.sizing.yEmu !== undefined ? { y: element.sizing.yEmu } : {}),
    };
  }
  if (element.rounding) opts.rounding = true;
  if (element.shadow) opts.shadow = shadowOpts(element.shadow);
  if (element.hyperlink) opts.hyperlink = hyperlinkOpts(element.hyperlink);
  if (element.altText) opts.altText = element.altText;

  slide.addImage(opts as never);
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export function emitElement(
  slide: PptxGenJS.Slide,
  element: PptxIrElement,
  ctx: EmitContext
): void {
  switch (element.kind) {
    case 'textBox':
      emitTextBox(slide, element, ctx);
      return;
    case 'shape':
      emitShape(slide, element, ctx);
      return;
    case 'image':
      emitImage(slide, element, ctx);
      return;
    case 'table':
      emitTable(slide, element, ctx.pptx);
      return;
    case 'chart':
      emitChart(slide, element);
      return;
    case 'group':
      // Reachable only if capability checking let it through, which would be
      // a bug — never a silent drop.
      throw new Error(
        `The pptxgenjs renderer has no emitter for "${element.kind}" (${element.path})`
      );
    default:
      assertNever(element, 'PptxIrElement');
  }
}

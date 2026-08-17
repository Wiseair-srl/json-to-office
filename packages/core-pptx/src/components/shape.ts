/**
 * Shape Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type {
  PptxThemeConfig,
  StyleName,
  PipelineWarning,
  PendingXmlFill,
  SlideRenderContext,
} from '../types';
import type {
  TextSegment,
  GradientFill,
  PatternFill,
} from '@json-to-office/shared-pptx';
import { PATTERN_FILL_PRESETS } from '@json-to-office/shared-pptx';
import { applyFontWeight } from '../utils/fontAliasContext';
import { resolveColor } from '../utils/color';
import { buildGradientFillXml, buildPatternFillXml } from '../utils/fillXml';
import { warn, W } from '../utils/warn';

export interface ShapeFillProps {
  color?: string;
  transparency?: number;
  gradient?: GradientFill;
  pattern?: PatternFill;
}

interface ShapeComponentProps {
  type: string;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  fill?: ShapeFillProps;
  line?: { color?: string; width?: number; dashType?: string };
  text?: string | TextSegment[];
  fontSize?: number;
  fontFace?: string;
  fontColor?: string;
  charSpacing?: number;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  align?: string;
  valign?: string;
  rotate?: number;
  angleRange?: [number, number];
  flipH?: boolean;
  flipV?: boolean;
  shadow?: {
    type?: string;
    color?: string;
    blur?: number;
    offset?: number;
    angle?: number;
    opacity?: number;
  };
  rectRadius?: number;
  style?: StyleName;
}

const SHAPE_TYPE_MAP: Record<string, string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  star5: 'star5',
  star6: 'star6',
  line: 'line',
  arrow: 'rightArrow',
  chevron: 'chevron',
  cloud: 'cloud',
  heart: 'heart',
  lightning: 'lightningBolt',
};

/**
 * Apply a shape fill to pptxgenjs opts. Gradient and pattern fills are not
 * expressible through pptxgenjs, so they render as a sentinel solid fill on a
 * shape tagged with a unique `objectName`; the real fill XML is registered in
 * `pendingFills` and spliced in by packagePresentationBuffer. Without a
 * registry (direct render outside the buffer pipeline) they degrade to the
 * sentinel solid color with a warning.
 */
export function applyShapeFill(
  opts: Record<string, unknown>,
  fill: ShapeFillProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[],
  pendingFills?: PendingXmlFill[]
): void {
  let gradient = fill.gradient;
  let pattern = fill.pattern;
  if (gradient && pattern) {
    warn(
      warnings,
      W.ADVANCED_FILL_FALLBACK,
      'Shape fill sets both "gradient" and "pattern" — using the gradient',
      { component: 'shape' }
    );
    pattern = undefined;
  }
  // An unrecognised preset degrades to the pattern's own foreground, so the
  // shape still reads as authored rather than picking up the pptxgenjs
  // default. `fill.color`, when set, stays authoritative.
  let unknownPresetForeground: string | undefined;
  if (
    pattern &&
    !(PATTERN_FILL_PRESETS as readonly string[]).includes(pattern.preset)
  ) {
    warn(
      warnings,
      W.UNKNOWN_PATTERN_PRESET,
      `Unknown pattern preset "${pattern.preset}" — falling back to solid foreground`,
      { component: 'shape' }
    );
    unknownPresetForeground = pattern.foreground;
    pattern = undefined;
  }

  if (gradient || pattern) {
    // Sentinel color: keeps the deck presentable if the splice cannot run.
    const sentinel = resolveColor(
      fill.color ?? (gradient ? gradient.stops[0].color : pattern!.foreground),
      theme,
      warnings
    );
    if (pendingFills) {
      const xml = gradient
        ? buildGradientFillXml(gradient, theme, warnings)
        : buildPatternFillXml(pattern!, theme, warnings);
      const objectName = `__jto_fill_${pendingFills.length}__`;
      pendingFills.push({ objectName, xml });
      opts.objectName = objectName;
    } else {
      warn(
        warnings,
        W.ADVANCED_FILL_FALLBACK,
        `${gradient ? 'Gradient' : 'Pattern'} fill requires the buffer generation pipeline — rendering a solid fill instead`,
        { component: 'shape' }
      );
    }
    opts.fill = { color: sentinel };
    return;
  }

  const solid = fill.color ?? unknownPresetForeground;
  if (solid !== undefined) {
    opts.fill = { color: resolveColor(solid, theme, warnings) };
    if (fill.transparency !== undefined) {
      (opts.fill as Record<string, unknown>).transparency = fill.transparency;
    }
  }
}

function buildShapeOpts(
  props: ShapeComponentProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[],
  pendingFills?: PendingXmlFill[]
): Record<string, unknown> {
  const opts: Record<string, unknown> = {};

  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  if (props.fill) {
    applyShapeFill(opts, props.fill, theme, warnings, pendingFills);
  }

  if (props.line) {
    opts.line = {};
    if (props.line.color)
      (opts.line as Record<string, unknown>).color = resolveColor(
        props.line.color,
        theme,
        warnings
      );
    if (props.line.width)
      (opts.line as Record<string, unknown>).width = props.line.width;
    if (props.line.dashType)
      (opts.line as Record<string, unknown>).dashType = props.line.dashType;
  }

  if (props.rotate !== undefined) opts.rotate = props.rotate;
  if (props.angleRange !== undefined) opts.angleRange = props.angleRange;
  if (props.flipH !== undefined) opts.flipH = props.flipH;
  if (props.flipV !== undefined) opts.flipV = props.flipV;
  if (props.rectRadius !== undefined) opts.rectRadius = props.rectRadius;

  if (props.shadow) {
    opts.shadow = {
      type: props.shadow.type ?? 'outer',
      color: resolveColor(props.shadow.color ?? '000000', theme, warnings),
      blur: props.shadow.blur ?? 3,
      offset: props.shadow.offset ?? 3,
      angle: props.shadow.angle ?? 45,
      opacity: props.shadow.opacity ?? 0.5,
    };
  }

  return opts;
}

export function renderShapeComponent(
  slide: PptxGenJS.Slide,
  props: ShapeComponentProps,
  theme: PptxThemeConfig,
  pptx: PptxGenJS,
  warnings?: PipelineWarning[],
  ctx?: SlideRenderContext
): void {
  // Resolve shape type from pptxgenjs ShapeType enum
  const shapeTypeName = SHAPE_TYPE_MAP[props.type] || props.type;
  const shapeType = (pptx.ShapeType as Record<string, any>)[shapeTypeName];

  if (!shapeType) {
    warn(warnings, W.UNKNOWN_SHAPE, `Unknown shape type: ${props.type}`, {
      component: 'shape',
    });
    return;
  }

  // Resolve named style
  const style = props.style ? theme.styles?.[props.style] : undefined;
  const isHeadingStyle = props.style && /^(title|heading)/.test(props.style);

  const opts = buildShapeOpts(props, theme, warnings, ctx?.pendingFills);

  // If shape has text, use addText with shape option
  if (props.text && (!Array.isArray(props.text) || props.text.length > 0)) {
    opts.shape = shapeType;

    opts.fontSize =
      props.fontSize ?? style?.fontSize ?? theme.defaults.fontSize;
    opts.fontFace =
      props.fontFace ??
      style?.fontFace ??
      (isHeadingStyle ? theme.fonts.heading : theme.fonts.body);
    // Preserve pre-alias family so segments that inherit it don't feed an
    // already-synthesized name (e.g. "Inter Light") back into applyFontWeight
    // and double-alias to "Inter Light Medium".
    const preAliasFamily = opts.fontFace as string | undefined;
    opts.color = resolveColor(
      props.fontColor ?? style?.fontColor ?? theme.defaults.fontColor,
      theme,
      warnings
    );
    const bold = props.bold ?? style?.bold;
    const italic = props.italic ?? style?.italic;
    const fontWeight = props.fontWeight ?? style?.fontWeight;
    const charSpacing = props.charSpacing ?? style?.charSpacing;
    if (charSpacing !== undefined) opts.charSpacing = charSpacing;
    const align = props.align ?? style?.align;
    if (align) opts.align = align;
    opts.valign = props.valign ?? 'top';

    if (Array.isArray(props.text)) {
      // For segmented text, resolve the aliased family per-segment using the
      // effective (weight, italic, bold) = segment value ?? shape value. Keep
      // shape-level `opts.fontFace` at the un-aliased family so segments that
      // don't set their own fontFace don't accidentally inherit an
      // already-synthesized name (e.g. "Inter Light") from the shape.
      if (bold != null) opts.bold = bold;
      if (italic != null) opts.italic = italic;
      const textSegments = props.text.map((seg) => {
        const segOpts: {
          fontSize?: number;
          fontFace?: string;
          color?: string;
          bold?: boolean;
          italic?: boolean;
          breakLine?: boolean;
          charSpacing?: number;
          paraSpaceBefore?: number;
          paraSpaceAfter?: number;
        } = {};
        if (seg.fontSize != null) segOpts.fontSize = seg.fontSize;
        if (seg.fontFace != null) segOpts.fontFace = seg.fontFace;
        if (seg.color != null)
          segOpts.color = resolveColor(seg.color, theme, warnings);
        if (seg.breakLine != null) segOpts.breakLine = seg.breakLine;
        if (seg.charSpacing != null) segOpts.charSpacing = seg.charSpacing;
        if (seg.spaceBefore != null) segOpts.paraSpaceBefore = seg.spaceBefore;
        if (seg.spaceAfter != null) segOpts.paraSpaceAfter = seg.spaceAfter;
        const segWeight = (seg as TextSegment & { fontWeight?: number })
          .fontWeight;
        const effWeight = segWeight ?? fontWeight;
        const effBold = seg.bold ?? bold;
        const effItalic = seg.italic ?? italic;
        if (effBold != null) segOpts.bold = effBold;
        if (effItalic != null) segOpts.italic = effItalic;
        if (effWeight != null || effBold === true) {
          // Only alias when the segment inherits the shape's family; if the
          // segment explicitly sets its own fontFace, the author has already
          // picked the face they want (possibly an already-synthesized name
          // like "Inter Light") and re-aliasing would double up the suffix.
          if (seg.fontFace == null) {
            const w = applyFontWeight({
              family: preAliasFamily,
              fontWeight: effWeight,
              italic: effItalic,
              bold: effBold,
            });
            if (w.fontFace !== undefined) segOpts.fontFace = w.fontFace;
            if (w.bold !== undefined) segOpts.bold = w.bold;
            if (w.italic !== undefined) segOpts.italic = w.italic;
          }
        }
        return { text: seg.text, options: segOpts };
      });
      slide.addText(textSegments, opts as any);
    } else {
      if (bold != null) opts.bold = bold;
      if (italic != null) opts.italic = italic;
      if (fontWeight != null || bold === true) {
        const w = applyFontWeight({
          family: preAliasFamily,
          fontWeight,
          italic,
          bold,
        });
        if (w.fontFace !== undefined) opts.fontFace = w.fontFace;
        if (w.bold !== undefined) opts.bold = w.bold;
        if (w.italic !== undefined) opts.italic = w.italic;
      }
      slide.addText(props.text, opts as any);
    }
  } else {
    // Pure shape without text
    slide.addShape(shapeType, opts as any);
  }
}

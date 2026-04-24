/**
 * Shape Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, StyleName, PipelineWarning } from '../types';
import type { TextSegment } from '@json-to-office/shared-pptx';
import { applyFontWeight } from '../utils/fontAliasContext';
import { resolveColor } from '../utils/color';
import { warn, W } from '../utils/warn';

interface ShapeComponentProps {
  type: string;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  fill?: { color: string; transparency?: number };
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

function buildShapeOpts(
  props: ShapeComponentProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): Record<string, unknown> {
  const opts: Record<string, unknown> = {};

  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  if (props.fill) {
    opts.fill = { color: resolveColor(props.fill.color, theme, warnings) };
    if (props.fill.transparency !== undefined) {
      (opts.fill as Record<string, unknown>).transparency =
        props.fill.transparency;
    }
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
  warnings?: PipelineWarning[]
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

  const opts = buildShapeOpts(props, theme, warnings);

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

/**
 * Shape Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, StyleName } from '../types';
import type { TextSegment } from '@json-to-office/shared-pptx';
import { resolveColor } from '../utils/color';

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

export function renderShapeComponent(
  slide: PptxGenJS.Slide,
  props: ShapeComponentProps,
  theme: PptxThemeConfig,
  pptx: PptxGenJS
): void {
  // Resolve shape type from pptxgenjs ShapeType enum
  const shapeTypeName = SHAPE_TYPE_MAP[props.type] || props.type;
  const shapeType = (pptx.ShapeType as Record<string, any>)[shapeTypeName];

  if (!shapeType) {
    console.warn(`Unknown shape type: ${props.type}`);
    return;
  }

  // Resolve named style
  const style = props.style ? theme.styles?.[props.style] : undefined;
  const isHeadingStyle = props.style && /^(title|heading)/.test(props.style);

  // If shape has text, use addText with shape option
  if (props.text && (!Array.isArray(props.text) || props.text.length > 0)) {
    const opts: Record<string, unknown> = {
      shape: shapeType,
    };

    if (props.x !== undefined) opts.x = props.x;
    if (props.y !== undefined) opts.y = props.y;
    if (props.w !== undefined) opts.w = props.w;
    if (props.h !== undefined) opts.h = props.h;

    if (props.fill) {
      opts.fill = { color: resolveColor(props.fill.color, theme) };
      if (props.fill.transparency !== undefined) {
        (opts.fill as Record<string, unknown>).transparency = props.fill.transparency;
      }
    }

    if (props.line) {
      opts.line = {};
      if (props.line.color) (opts.line as Record<string, unknown>).color = resolveColor(props.line.color, theme);
      if (props.line.width) (opts.line as Record<string, unknown>).width = props.line.width;
      if (props.line.dashType) (opts.line as Record<string, unknown>).dashType = props.line.dashType;
    }

    opts.fontSize = props.fontSize ?? style?.fontSize ?? theme.defaults.fontSize;
    opts.fontFace = props.fontFace ?? style?.fontFace ?? (isHeadingStyle ? theme.fonts.heading : theme.fonts.body);
    opts.color = resolveColor(props.fontColor ?? style?.fontColor ?? theme.defaults.fontColor, theme);
    const bold = props.bold ?? style?.bold;
    const italic = props.italic ?? style?.italic;
    if (bold != null) opts.bold = bold;
    if (italic != null) opts.italic = italic;
    const charSpacing = props.charSpacing ?? style?.charSpacing;
    if (charSpacing !== undefined) opts.charSpacing = charSpacing;
    const align = props.align ?? style?.align;
    if (align) opts.align = align;
    if (props.valign) opts.valign = props.valign;
    if (props.rotate !== undefined) opts.rotate = props.rotate;
    if (props.rectRadius !== undefined) opts.rectRadius = props.rectRadius;

    if (props.shadow) {
      opts.shadow = {
        type: props.shadow.type ?? 'outer',
        color: resolveColor(props.shadow.color ?? '000000', theme),
        blur: props.shadow.blur ?? 3,
        offset: props.shadow.offset ?? 3,
        angle: props.shadow.angle ?? 45,
        opacity: props.shadow.opacity ?? 0.5,
      };
    }

    if (Array.isArray(props.text)) {
      const textSegments = props.text.map(seg => {
        const segOpts: Record<string, unknown> = {};
        if (seg.fontSize != null) segOpts.fontSize = seg.fontSize;
        if (seg.fontFace != null) segOpts.fontFace = seg.fontFace;
        if (seg.color != null) segOpts.color = resolveColor(seg.color, theme);
        if (seg.bold != null) segOpts.bold = seg.bold;
        if (seg.italic != null) segOpts.italic = seg.italic;
        if (seg.breakLine != null) segOpts.breakLine = seg.breakLine;
        if (seg.charSpacing != null) segOpts.charSpacing = seg.charSpacing;
        if (seg.spaceBefore != null) segOpts.paraSpaceBefore = seg.spaceBefore;
        if (seg.spaceAfter != null) segOpts.paraSpaceAfter = seg.spaceAfter;
        return { text: seg.text, options: segOpts };
      });
      slide.addText(textSegments, opts as any);
    } else {
      slide.addText(props.text, opts as any);
    }
  } else {
    // Pure shape without text
    const opts: Record<string, unknown> = {};

    if (props.x !== undefined) opts.x = props.x;
    if (props.y !== undefined) opts.y = props.y;
    if (props.w !== undefined) opts.w = props.w;
    if (props.h !== undefined) opts.h = props.h;

    if (props.fill) {
      opts.fill = { color: resolveColor(props.fill.color, theme) };
      if (props.fill.transparency !== undefined) {
        (opts.fill as Record<string, unknown>).transparency = props.fill.transparency;
      }
    }

    if (props.line) {
      opts.line = {};
      if (props.line.color) (opts.line as Record<string, unknown>).color = resolveColor(props.line.color, theme);
      if (props.line.width) (opts.line as Record<string, unknown>).width = props.line.width;
      if (props.line.dashType) (opts.line as Record<string, unknown>).dashType = props.line.dashType;
    }

    if (props.rotate !== undefined) opts.rotate = props.rotate;
    if (props.rectRadius !== undefined) opts.rectRadius = props.rectRadius;

    if (props.shadow) {
      opts.shadow = {
        type: props.shadow.type ?? 'outer',
        color: resolveColor(props.shadow.color ?? '000000', theme),
        blur: props.shadow.blur ?? 3,
        offset: props.shadow.offset ?? 3,
        angle: props.shadow.angle ?? 45,
        opacity: props.shadow.opacity ?? 0.5,
      };
    }

    slide.addShape(shapeType, opts as any);
  }
}

/**
 * Shape Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig } from '../types';
import { resolveColor } from '../utils/color';

interface ShapeComponentProps {
  type: string;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  fill?: { color: string; transparency?: number };
  line?: { color?: string; width?: number; dashType?: string };
  text?: string;
  fontSize?: number;
  fontFace?: string;
  fontColor?: string;
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

  // If shape has text, use addText with shape option
  if (props.text) {
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

    opts.fontSize = props.fontSize ?? theme.defaults.fontSize;
    opts.fontFace = props.fontFace ?? theme.fonts.body;
    opts.color = resolveColor(props.fontColor ?? theme.defaults.fontColor, theme);
    if (props.bold) opts.bold = true;
    if (props.italic) opts.italic = true;
    if (props.align) opts.align = props.align;
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

    slide.addText(props.text, opts as any);
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

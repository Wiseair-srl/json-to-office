/**
 * Text Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, StyleName } from '../types';
import { resolveColor } from '../utils/color';

interface TextComponentProps {
  text: string;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  fontSize?: number;
  fontFace?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean | { style?: string; color?: string };
  strike?: boolean;
  align?: string;
  valign?: string;
  breakLine?: boolean;
  bullet?: boolean | { type?: string; style?: string; startAt?: number };
  margin?: number | number[];
  rotate?: number;
  shadow?: {
    type?: string;
    color?: string;
    blur?: number;
    offset?: number;
    angle?: number;
    opacity?: number;
  };
  fill?: { color: string; transparency?: number };
  hyperlink?: { url?: string; slide?: number; tooltip?: string };
  lineSpacing?: number;
  paraSpaceBefore?: number;
  paraSpaceAfter?: number;
  style?: StyleName;
}

export function renderTextComponent(
  slide: PptxGenJS.Slide,
  props: TextComponentProps,
  theme: PptxThemeConfig
): void {
  // Resolve named style as defaults
  const style = props.style ? theme.styles?.[props.style] : undefined;
  const isHeadingStyle = props.style && /^(title|heading)/.test(props.style);

  const opts: Record<string, unknown> = {};

  // Position
  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  // When height is not explicitly set, provide a reasonable default based on
  // font size so that LibreOffice (which renders cy="0" as blank) can display
  // the text. Also mark as textBox for proper auto-sizing in PowerPoint.
  if (props.h === undefined) {
    const fontSize = props.fontSize ?? theme.defaults.fontSize ?? 18;
    opts.h = Math.max(0.5, (fontSize / 72) * 1.6);
    opts.isTextBox = true;
  }

  // Font — cascade: component props → style → theme defaults
  opts.fontSize = props.fontSize ?? style?.fontSize ?? theme.defaults.fontSize;
  opts.fontFace = props.fontFace ?? style?.fontFace ?? (isHeadingStyle ? theme.fonts.heading : theme.fonts.body);
  opts.color = resolveColor(props.color ?? style?.fontColor ?? theme.defaults.fontColor, theme);

  // Formatting
  const bold = props.bold ?? style?.bold;
  const italic = props.italic ?? style?.italic;
  if (bold != null) opts.bold = bold;
  if (italic != null) opts.italic = italic;
  if (props.strike) opts.strike = true;

  if (props.underline !== undefined) {
    if (typeof props.underline === 'boolean') {
      opts.underline = { style: 'sng' };
    } else {
      opts.underline = props.underline;
    }
  }

  // Alignment
  const align = props.align ?? style?.align;
  if (align) opts.align = align;
  if (props.valign) opts.valign = props.valign;

  // Bullet
  if (props.bullet !== undefined) {
    if (typeof props.bullet === 'boolean') {
      opts.bullet = props.bullet;
    } else {
      opts.bullet = props.bullet;
    }
  }

  // Margin
  if (props.margin !== undefined) opts.margin = props.margin;

  // Rotation
  if (props.rotate !== undefined) opts.rotate = props.rotate;

  // Shadow
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

  // Fill
  if (props.fill) {
    opts.fill = { color: resolveColor(props.fill.color, theme) };
    if (props.fill.transparency !== undefined) {
      (opts.fill as Record<string, unknown>).transparency = props.fill.transparency;
    }
  }

  // Hyperlink
  if (props.hyperlink) {
    if (props.hyperlink.url) {
      opts.hyperlink = {
        url: props.hyperlink.url,
        tooltip: props.hyperlink.tooltip,
      };
    } else if (props.hyperlink.slide) {
      opts.hyperlink = {
        slide: props.hyperlink.slide,
        tooltip: props.hyperlink.tooltip,
      };
    }
  }

  // Line spacing
  const lineSpacing = props.lineSpacing ?? style?.lineSpacing;
  if (lineSpacing !== undefined) opts.lineSpacing = lineSpacing;
  if (props.paraSpaceBefore !== undefined) opts.paraSpaceBefore = props.paraSpaceBefore;
  const paraSpaceAfter = props.paraSpaceAfter ?? style?.paraSpaceAfter;
  if (paraSpaceAfter !== undefined) opts.paraSpaceAfter = paraSpaceAfter;

  // Break line handling
  if (props.breakLine) opts.breakLine = true;

  slide.addText(props.text, opts as any);
}

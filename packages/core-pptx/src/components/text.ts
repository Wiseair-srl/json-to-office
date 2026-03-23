/**
 * Text Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, StyleName, PipelineWarning, SlideContext } from '../types';
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
  charSpacing?: number;
  paraSpaceBefore?: number;
  paraSpaceAfter?: number;
  style?: StyleName;
}

function resolvePagePlaceholders(text: string, ctx: SlideContext): string {
  const { slideNumber, totalSlides, pageNumberFormat } = ctx;
  const fmt = (n: number) => pageNumberFormat === '09'
    ? String(n).padStart(String(totalSlides).length, '0')
    : String(n);
  return text
    .replace(/\{PAGE_NUMBER\}/g, fmt(slideNumber))
    .replace(/\{PAGE_COUNT\}/g, fmt(totalSlides));
}

export function renderTextComponent(
  slide: PptxGenJS.Slide,
  props: TextComponentProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[],
  slideCtx?: SlideContext
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
    const lines = (props.text.match(/\n/g)?.length ?? 0) + 1;
    opts.h = Math.max(0.5, (fontSize / 72) * 1.6 * lines);
    opts.isTextBox = true;
  }

  // Font — cascade: component props → style → theme defaults
  opts.fontSize = props.fontSize ?? style?.fontSize ?? theme.defaults.fontSize;
  opts.fontFace = props.fontFace ?? style?.fontFace ?? (isHeadingStyle ? theme.fonts.heading : theme.fonts.body);
  opts.color = resolveColor(props.color ?? style?.fontColor ?? theme.defaults.fontColor, theme, warnings);

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
  opts.valign = props.valign ?? 'top';

  // Bullet
  if (props.bullet !== undefined) opts.bullet = props.bullet;

  // Margin — default to 0 so text aligns exactly to grid positions
  opts.margin = props.margin ?? 0;

  // Rotation
  if (props.rotate !== undefined) opts.rotate = props.rotate;

  // Shadow
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

  // Fill
  if (props.fill) {
    opts.fill = { color: resolveColor(props.fill.color, theme, warnings) };
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
  const charSpacing = props.charSpacing ?? style?.charSpacing;
  if (charSpacing !== undefined) opts.charSpacing = charSpacing;
  if (props.paraSpaceBefore !== undefined) opts.paraSpaceBefore = props.paraSpaceBefore;
  const paraSpaceAfter = props.paraSpaceAfter ?? style?.paraSpaceAfter;
  if (paraSpaceAfter !== undefined) opts.paraSpaceAfter = paraSpaceAfter;

  // Break line handling
  if (props.breakLine) opts.breakLine = true;

  const text = slideCtx ? resolvePagePlaceholders(props.text, slideCtx) : props.text;
  slide.addText(text, opts as any);
}

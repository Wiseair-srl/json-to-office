/**
 * Text Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type {
  PptxThemeConfig,
  StyleName,
  PipelineWarning,
  SlideContext,
} from '../types';
import { resolveColor } from '../utils/color';
import { applyFontWeight } from '../utils/fontAliasContext';
import { applyHyperlink, type HyperlinkProps } from '../utils/hyperlink';
import { warn, W } from '../utils/warn';

interface TextRunProps {
  text: string;
  color?: string;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean | { style?: string; color?: string };
  strike?: boolean;
  fontSize?: number;
  fontFace?: string;
  superscript?: boolean;
  subscript?: boolean;
  charSpacing?: number;
  breakLine?: boolean;
}

interface TextComponentProps {
  text?: string;
  runs?: TextRunProps[];
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  fontSize?: number;
  fontFace?: string;
  color?: string;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean | { style?: string; color?: string };
  strike?: boolean;
  language?: string;
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
  hyperlink?: HyperlinkProps;
  lineSpacing?: number;
  lineSpacingMultiple?: number;
  charSpacing?: number;
  paraSpaceBefore?: number;
  paraSpaceAfter?: number;
  style?: StyleName;
}

function resolvePagePlaceholders(text: string, ctx: SlideContext): string {
  const { slideNumber, totalSlides, pageNumberFormat } = ctx;
  const fmt = (n: number) =>
    pageNumberFormat === '09'
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
  // Exactly one of `text`/`runs` carries the content. Validation enforces the
  // rule up front; this guard covers validation-disabled runs.
  const runs = props.runs && props.runs.length > 0 ? props.runs : undefined;
  if (props.text === undefined && !runs) {
    warn(
      warnings,
      W.TEXT_NO_CONTENT,
      'Text component has neither "text" nor "runs" — skipped',
      { component: 'text' }
    );
    return;
  }

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
    const lines = runs
      ? runs.reduce(
          (count, run) =>
            count +
            (run.breakLine ? 1 : 0) +
            (run.text.match(/\n/g)?.length ?? 0),
          1
        )
      : (props.text!.match(/\n/g)?.length ?? 0) + 1;
    opts.h = Math.max(0.5, (fontSize / 72) * 1.6 * lines);
    opts.isTextBox = true;
  }

  // Font — cascade: component props → style → theme defaults
  opts.fontSize = props.fontSize ?? style?.fontSize ?? theme.defaults.fontSize;
  opts.fontFace =
    props.fontFace ??
    style?.fontFace ??
    (isHeadingStyle ? theme.fonts.heading : theme.fonts.body);
  opts.color = resolveColor(
    props.color ?? style?.fontColor ?? theme.defaults.fontColor,
    theme,
    warnings
  );

  // Formatting — preserve the pre-alias family so runs that set their own
  // weight resolve their alias from the base family, not an
  // already-synthesized name (e.g. "Inter Light").
  const preAliasFamily = opts.fontFace as string | undefined;
  const bold = props.bold ?? style?.bold;
  const italic = props.italic ?? style?.italic;
  const fontWeight = props.fontWeight ?? style?.fontWeight;
  if (bold != null) opts.bold = bold;
  if (italic != null) opts.italic = italic;
  if (fontWeight != null || bold === true) {
    const w = applyFontWeight({
      family: opts.fontFace as string | undefined,
      fontWeight,
      italic,
      bold,
    });
    if (w.fontFace !== undefined) opts.fontFace = w.fontFace;
    if (w.bold !== undefined) opts.bold = w.bold;
    if (w.italic !== undefined) opts.italic = w.italic;
  }
  if (props.strike) opts.strike = true;

  // Proofing language: component override → presentation default. When neither
  // is set, pptxgenjs falls back to its own 'en-US' default.
  const lang = props.language ?? slideCtx?.language;
  if (lang) opts.lang = lang;

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
      (opts.fill as Record<string, unknown>).transparency =
        props.fill.transparency;
    }
  }

  // Hyperlink
  applyHyperlink(opts, props.hyperlink, 'text', warnings);

  // Line spacing
  const lineSpacing = props.lineSpacing ?? style?.lineSpacing;
  if (props.lineSpacingMultiple !== undefined) {
    opts.lineSpacingMultiple = props.lineSpacingMultiple;
  } else if (lineSpacing !== undefined) {
    opts.lineSpacing = lineSpacing;
  }
  const charSpacing = props.charSpacing ?? style?.charSpacing;
  if (charSpacing !== undefined) opts.charSpacing = charSpacing;
  if (props.paraSpaceBefore !== undefined)
    opts.paraSpaceBefore = props.paraSpaceBefore;
  const paraSpaceAfter = props.paraSpaceAfter ?? style?.paraSpaceAfter;
  if (paraSpaceAfter !== undefined) opts.paraSpaceAfter = paraSpaceAfter;

  // Break line handling
  if (props.breakLine) opts.breakLine = true;

  if (runs) {
    // Rich text runs — pptxgenjs natively accepts [{ text, options }] and
    // merges each run's options over the block-level opts, so run options
    // override component-level defaults per run.
    const runSegments = runs.map((run) => {
      const runOpts: Record<string, unknown> = {};
      if (run.fontSize != null) runOpts.fontSize = run.fontSize;
      if (run.fontFace != null) runOpts.fontFace = run.fontFace;
      if (run.color != null)
        runOpts.color = resolveColor(run.color, theme, warnings);
      if (run.strike != null) runOpts.strike = run.strike;
      if (run.underline !== undefined) {
        if (typeof run.underline === 'boolean') {
          if (run.underline) runOpts.underline = { style: 'sng' };
        } else {
          runOpts.underline = run.underline;
        }
      }
      if (run.superscript != null) runOpts.superscript = run.superscript;
      if (run.subscript != null) runOpts.subscript = run.subscript;
      if (run.charSpacing != null) runOpts.charSpacing = run.charSpacing;
      if (run.breakLine != null) runOpts.breakLine = run.breakLine;

      const effWeight = run.fontWeight ?? fontWeight;
      const effBold = run.bold ?? bold;
      const effItalic = run.italic ?? italic;
      if (effBold != null) runOpts.bold = effBold;
      if (effItalic != null) runOpts.italic = effItalic;
      if (effWeight != null || effBold === true) {
        // Only alias when the run inherits the component's family; if the run
        // explicitly sets its own fontFace, the author has already picked the
        // face they want and re-aliasing would double up the suffix.
        if (run.fontFace == null) {
          const w = applyFontWeight({
            family: preAliasFamily,
            fontWeight: effWeight,
            italic: effItalic,
            bold: effBold,
          });
          if (w.fontFace !== undefined) runOpts.fontFace = w.fontFace;
          if (w.bold !== undefined) runOpts.bold = w.bold;
          if (w.italic !== undefined) runOpts.italic = w.italic;
        }
      }

      const runText = slideCtx
        ? resolvePagePlaceholders(run.text, slideCtx)
        : run.text;
      return { text: runText, options: runOpts };
    });
    slide.addText(runSegments as any, opts as any);
    return;
  }

  const text = slideCtx
    ? resolvePagePlaceholders(props.text!, slideCtx)
    : props.text!;
  slide.addText(text, opts as any);
}

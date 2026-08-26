/**
 * Design-quality collectors for PPTX documents (#216, #218).
 *
 * Schema validation answers "will this render?"; these answer "will it look
 * right?" — the canvas the renderer will actually use, whether each text box
 * can hold its text, whether a slide is legible at all. Every check here is
 * deterministic and runs in milliseconds, so an agent gets the verdict from
 * `jto_validate` instead of paying a render plus a vision pass to see the
 * overflow with its own eyes.
 *
 * The rules deliberately read the same tables the renderer reads —
 * `getPptxTheme` for style font sizes, `resolveGridPosition` for box geometry,
 * the renderer's own 10×7.5 fallback canvas — so the estimate and the render
 * cannot drift apart the way an external checker's mirrored constants did.
 *
 * The text-height estimator is conservative (it slightly under-estimates how
 * much fits): a clean run is a strong signal, a TIGHT margin is fragile, an
 * OVERFLOW is near-certain. Findings are warnings and infos, never errors —
 * generation is not gated on taste.
 */

import { QUALITY_CODES, type QualityFinding } from '@json-to-office/shared';
import type { GridConfig, GridPosition, TextStyle } from '../types';
import { mergeGridConfigs, resolveGridPosition } from '../core/grid';
import { DEFAULT_PPTX_THEME, getPptxTheme } from '../themes/defaults';

/** The canvas pptxgenjs falls back to when the document declares none. */
const RENDERER_DEFAULT_WIDTH_IN = 10;
const RENDERER_DEFAULT_HEIGHT_IN = 7.5;

/**
 * Average glyph width as a fraction of the font size. Calibrated against the
 * stock templates: at 0.5 the estimator phantom-wrapped borderline lines the
 * common UI faces (Inter, Archivo, Arial) fit comfortably, and a phantom line
 * is a false OVERFLOW. Real authoring failures overflow by multiples, not by
 * one character, so the slightly optimistic factor costs no real catch.
 */
const CHAR_WIDTH_FACTOR = 0.45;

/** Below this remaining margin a fit survives on renderer rounding alone. */
const SAFETY_BUFFER_PT = 8;

/**
 * Smaller than this is unreadable projected, whatever the style intends.
 * 7pt stays legal — real templates set captions and fine print there — so the
 * floor catches only the sizes nothing on a slide can justify.
 */
const MIN_READABLE_FONT_PT = 7;

/**
 * Body words one slide can carry before it stops being a slide. The stock
 * templates' densest slide sits well under this; a wall of prose does not.
 */
const MAX_BODY_WORDS_PER_SLIDE = 130;

const KNOWN_CANVASES: readonly {
  w: number;
  h: number;
  label: string;
  legacy?: boolean;
}[] = [
  { w: 13.333, h: 7.5, label: '16:9 standard' },
  { w: 10, h: 5.625, label: '16:9 small' },
  { w: 7.5, h: 7.5, label: '1:1 carousel' },
  { w: 7.5, h: 9.375, label: '4:5 vertical' },
  { w: 4.5, h: 8, label: '9:16 story' },
  { w: 10, h: 7.5, label: '4:3 legacy', legacy: true },
];

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** An x/y/w/h prop in points: inches as numbers, `"NN%"` of the axis. */
function dimToPt(value: unknown, axisIn: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 72;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) {
      const pct = Number(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? (pct / 100) * axisIn * 72 : undefined;
    }
    const inches = Number(trimmed);
    return Number.isFinite(inches) ? inches * 72 : undefined;
  }
  return undefined;
}

interface ThemeContext {
  styles: Partial<Record<string, TextStyle>>;
  defaultFontSize: number;
}

/**
 * The style table the render will resolve against.
 *
 * Mirrors `resolveThemeContext` in `core/generationContext.ts`: an inline
 * theme object wins, a named theme resolves through `getPptxTheme` (which
 * never misses), anything else is the default theme. An inline theme's styles
 * layer over the defaults rather than replacing them, so `style: "heading1"`
 * keeps a size even when the inline theme only restyles `title`.
 */
function themeContext(docProps: Rec): ThemeContext {
  const theme = docProps.theme;
  const base =
    typeof theme === 'string' ? getPptxTheme(theme) : DEFAULT_PPTX_THEME;
  const styles: Partial<Record<string, TextStyle>> = { ...base.styles };
  let defaultFontSize =
    asNumber(base.defaults?.fontSize) ??
    asNumber(DEFAULT_PPTX_THEME.defaults?.fontSize) ??
    18;

  const inline = asRecord(theme);
  if (inline) {
    const inlineStyles = asRecord(inline.styles);
    if (inlineStyles) {
      for (const [name, style] of Object.entries(inlineStyles)) {
        const styleRec = asRecord(style);
        if (styleRec) {
          styles[name] = { ...styles[name], ...(styleRec as TextStyle) };
        }
      }
    }
    const inlineDefault = asNumber(asRecord(inline.defaults)?.fontSize);
    if (inlineDefault !== undefined) defaultFontSize = inlineDefault;
  }

  return { styles, defaultFontSize };
}

/**
 * Renderer-aligned leading when nothing specifies one: display type sits
 * tighter than body text, matching what pptxgenjs and LibreOffice produce.
 */
function defaultLineHeightPt(fontSize: number): number {
  if (fontSize >= 60) return fontSize * 1.05;
  if (fontSize >= 28) return fontSize * 1.15;
  return fontSize * 1.25;
}

interface Typography {
  fontSize: number;
  lineSpacing: number;
  paraSpaceBefore: number;
  paraSpaceAfter: number;
  styleName: string | undefined;
}

/** Effective type: explicit prop → named style → theme default. */
function resolveTypography(props: Rec, ctx: ThemeContext): Typography {
  const styleName = typeof props.style === 'string' ? props.style : undefined;
  const style = styleName !== undefined ? ctx.styles[styleName] : undefined;
  const fontSize =
    asNumber(props.fontSize) ?? style?.fontSize ?? ctx.defaultFontSize;

  const multiple = asNumber(props.lineSpacingMultiple);
  const lineSpacing =
    multiple !== undefined
      ? fontSize * multiple
      : asNumber(props.lineSpacing) ??
        style?.lineSpacing ??
        defaultLineHeightPt(fontSize);

  return {
    fontSize,
    lineSpacing,
    paraSpaceBefore: asNumber(props.paraSpaceBefore) ?? 0,
    paraSpaceAfter:
      asNumber(props.paraSpaceAfter) ?? style?.paraSpaceAfter ?? 0,
    styleName,
  };
}

/**
 * Estimated rendered height: the first line occupies the font size, each
 * further wrapped line adds one leading, explicit paragraph breaks add their
 * spacing. Matches how PPTX and PDF renderers stack glyph rows.
 */
function estimateTextHeightPt(
  text: string,
  typography: Typography,
  widthPt: number
): { heightPt: number; lines: number } {
  const paragraphs = text.split('\n');
  const charsPerLine = Math.max(
    1,
    Math.floor(widthPt / (typography.fontSize * CHAR_WIDTH_FACTOR))
  );
  let lines = 0;
  for (const para of paragraphs) {
    // Trailing whitespace renders invisibly at the line end and never wraps,
    // but counted it pushed borderline single-line text into a phantom
    // second line.
    const measured = para.trimEnd();
    lines +=
      measured === ''
        ? 1
        : Math.max(1, Math.ceil(measured.length / charsPerLine));
  }
  let heightPt =
    typography.fontSize + Math.max(0, lines - 1) * typography.lineSpacing;
  if (paragraphs.length > 1) {
    heightPt +=
      (paragraphs.length - 1) *
      (typography.paraSpaceBefore + typography.paraSpaceAfter);
  }
  return { heightPt, lines };
}

interface TextNode {
  props: Rec;
  path: string;
  text: string;
}

/**
 * Every text-bearing node under `component`: `text` components carrying
 * `text`, and `shape` components with a `text` prop. Nodes using `runs` are
 * skipped — per-run sizing makes any single-size estimate a guess, and a
 * wrong OVERFLOW teaches an agent to ignore the right ones.
 */
function collectTextNodes(component: unknown, path: string, out: TextNode[]) {
  const rec = asRecord(component);
  if (!rec) return;
  const props = asRecord(rec.props) ?? {};
  const text = typeof props.text === 'string' ? props.text : undefined;
  if (text !== undefined && text.trim() !== '' && props.runs === undefined) {
    if (rec.name === 'text' || rec.name === 'shape') {
      out.push({ props, path, text });
    }
  }
  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    collectTextNodes(child, `${path}/children/${index}`, out)
  );
}

function checkCanvas(docProps: Rec, findings: QualityFinding[]): void {
  const w = asNumber(docProps.slideWidth);
  const h = asNumber(docProps.slideHeight);

  if (w === undefined || h === undefined) {
    findings.push({
      code: QUALITY_CODES.CANVAS_UNSPECIFIED,
      severity: 'warning',
      message: `No slide canvas declared: the renderer falls back to 4:3 (${RENDERER_DEFAULT_WIDTH_IN}×${RENDERER_DEFAULT_HEIGHT_IN}"), and 16:9 content on that canvas leaves a dead strip at the bottom.`,
      path: '/props',
      suggestion:
        'Declare props.slideWidth and props.slideHeight — 13.333 × 7.5 for a standard 16:9 deck.',
      context: {
        rendererDefault: {
          slideWidth: RENDERER_DEFAULT_WIDTH_IN,
          slideHeight: RENDERER_DEFAULT_HEIGHT_IN,
        },
      },
    });
    return;
  }

  const match = KNOWN_CANVASES.find(
    (canvas) => Math.abs(canvas.w - w) < 0.01 && Math.abs(canvas.h - h) < 0.01
  );
  if (match?.legacy) {
    findings.push({
      code: QUALITY_CODES.CANVAS_LEGACY,
      severity: 'info',
      message: `Canvas is 4:3 legacy (${match.w}×${match.h}") — modern screens are 16:9.`,
      path: '/props',
      suggestion:
        'If 4:3 is not deliberate, use slideWidth 13.333 and slideHeight 7.5.',
    });
  } else if (!match) {
    findings.push({
      code: QUALITY_CODES.CANVAS_NONSTANDARD,
      severity: 'info',
      message: `Canvas ${w}×${h}" matches no common preset (16:9, 1:1, 4:5, 9:16).`,
      path: '/props',
      suggestion:
        'Confirm the size is deliberate; a mistyped canvas distorts every slide.',
      context: {
        knownCanvases: KNOWN_CANVASES.map(({ w: kw, h: kh, label }) => ({
          slideWidth: kw,
          slideHeight: kh,
          label,
        })),
      },
    });
  }
}

function analyzeSlide(
  slide: Rec,
  slidePath: string,
  docGrid: GridConfig | undefined,
  slideWidthIn: number,
  slideHeightIn: number,
  ctx: ThemeContext,
  findings: QualityFinding[]
): void {
  const slideProps = asRecord(slide.props) ?? {};
  const grid = mergeGridConfigs(
    docGrid,
    (asRecord(slideProps.grid) as GridConfig | undefined) ?? undefined
  );

  const nodes: TextNode[] = [];
  const children = Array.isArray(slide.children) ? slide.children : [];
  children.forEach((child, index) =>
    collectTextNodes(child, `${slidePath}/children/${index}`, nodes)
  );

  let bodyWords = 0;

  for (const node of nodes) {
    const typography = resolveTypography(node.props, ctx);

    if (typography.fontSize < MIN_READABLE_FONT_PT) {
      findings.push({
        code: QUALITY_CODES.FONT_SIZE_MIN,
        severity: 'warning',
        message: `Effective font size is ${typography.fontSize}pt — unreadable on a projected slide.`,
        path: `${node.path}/props`,
        suggestion: `Use at least ${MIN_READABLE_FONT_PT}pt; captions rarely work below 10pt.`,
        context: { fontSize: typography.fontSize },
      });
    }

    if (
      typography.styleName !== 'title' &&
      typography.styleName !== 'subtitle'
    ) {
      bodyWords += node.text.split(/\s+/).filter(Boolean).length;
    }

    // Box: explicit dimensions win, a grid position fills in the rest — the
    // same precedence `resolveComponentGridPosition` applies at render.
    let widthPt = dimToPt(node.props.w, slideWidthIn);
    let heightPt = dimToPt(node.props.h, slideHeightIn);
    const gridPos = asRecord(node.props.grid);
    if (
      gridPos !== undefined &&
      asNumber(gridPos.column) !== undefined &&
      asNumber(gridPos.row) !== undefined &&
      (widthPt === undefined || heightPt === undefined)
    ) {
      const resolved = resolveGridPosition(
        gridPos as unknown as GridPosition,
        grid,
        slideWidthIn,
        slideHeightIn
      );
      widthPt ??= resolved.w * 72;
      heightPt ??= resolved.h * 72;
    }
    if (
      widthPt === undefined ||
      heightPt === undefined ||
      widthPt <= 0 ||
      heightPt <= 0
    ) {
      // No declared box: the renderer will autosize, which cannot overflow
      // the way a fixed placeholder can.
      continue;
    }

    const { heightPt: textPt, lines } = estimateTextHeightPt(
      node.text,
      typography,
      widthPt
    );
    const marginPt = heightPt - textPt;
    const measured = {
      estimatedTextPt: Math.round(textPt * 10) / 10,
      availablePt: Math.round(heightPt * 10) / 10,
      marginPt: Math.round(marginPt * 10) / 10,
      estimatedLines: lines,
      fontSize: typography.fontSize,
      boxWidthPt: Math.round(widthPt * 10) / 10,
    };

    // PPTX boxes do not clip: a spill within one line-height lands in the
    // gap below the box and is usually invisible, so only a spill that must
    // collide with what comes next earns a warning.
    if (marginPt < -typography.lineSpacing) {
      findings.push({
        code: QUALITY_CODES.TEXT_OVERFLOW,
        severity: 'warning',
        message: `Text is estimated at ${measured.estimatedTextPt}pt tall (${lines} line${lines === 1 ? '' : 's'} of ${typography.fontSize}pt) in a ${measured.availablePt}pt box — it will overflow.`,
        path: node.path,
        suggestion:
          'Shorten the text, reduce fontSize, or enlarge the box (h / rowSpan).',
        context: measured,
      });
    } else if (marginPt < SAFETY_BUFFER_PT) {
      findings.push({
        code: QUALITY_CODES.TEXT_TIGHT,
        severity: 'info',
        message:
          marginPt < 0
            ? `Text is estimated to exceed its ${measured.availablePt}pt box by ${-measured.marginPt}pt — within one line-height, so likely a harmless spill into the gap below.`
            : `Text fits its box with only ${measured.marginPt}pt to spare — renderer rounding can push it over.`,
        path: node.path,
        suggestion: `Leave at least ${SAFETY_BUFFER_PT}pt of vertical margin.`,
        context: measured,
      });
    }
  }

  if (bodyWords > MAX_BODY_WORDS_PER_SLIDE) {
    findings.push({
      code: QUALITY_CODES.SLIDE_DENSITY,
      severity: 'warning',
      message: `${bodyWords} words of body text on one slide — an audience reads a slide, it does not study one.`,
      path: slidePath,
      suggestion: 'One idea per slide: split the content across more slides.',
      context: { bodyWords, threshold: MAX_BODY_WORDS_PER_SLIDE },
    });
  }
}

/**
 * Every design-quality finding for a PPTX document.
 *
 * Tolerant of any input shape: a document that is not even schema-valid gets
 * whatever findings its recognizable parts support, and never a throw — the
 * caller reports these beside validation errors, not instead of them.
 */
export function collectPptxQualityFindings(doc: unknown): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const root = asRecord(doc);
  if (!root || root.name !== 'pptx') return findings;

  const props = asRecord(root.props) ?? {};
  checkCanvas(props, findings);

  const slideWidthIn = asNumber(props.slideWidth) ?? RENDERER_DEFAULT_WIDTH_IN;
  const slideHeightIn =
    asNumber(props.slideHeight) ?? RENDERER_DEFAULT_HEIGHT_IN;
  const docGrid = asRecord(props.grid) as GridConfig | undefined;
  const ctx = themeContext(props);

  const children = Array.isArray(root.children) ? root.children : [];
  children.forEach((child, index) => {
    const slide = asRecord(child);
    if (!slide || slide.name !== 'slide') return;
    analyzeSlide(
      slide,
      `/children/${index}`,
      docGrid,
      slideWidthIn,
      slideHeightIn,
      ctx,
      findings
    );
  });

  return findings;
}

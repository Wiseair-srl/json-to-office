import type {
  PreparedDocument,
  ProvenanceMap,
  QualityFact,
} from '@json-to-office/quality';
import type {
  FontRuntimeOpts,
  GenerationWarning,
} from '@json-to-office/shared';
import { DEFAULT_DOCX_RENDERER_ID } from '@json-to-office/shared-docx';
import type { ComponentDefinition, ReportComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import {
  resolveThemeContext,
  type GenerationThemeContext,
} from '../core/generationContext';
import { createSectionProperties, getColumnSettings } from '../core/layout';
import {
  resolveDocumentTree,
  type ResolvedDocumentTree,
} from '../core/structure';
import { normalizeDocument } from '../json/normalizer';
import { relativeLengthToTwips } from '../utils/widthUtils';

type Rec = Record<string, unknown>;

export interface DocxTableWidthFact extends QualityFact {
  kind: 'docx/table-width';
  totalWidthTwips: number;
  availableWidthTwips: number;
  hasExplicitWidth: boolean;
  allColumnsExplicit: boolean;
  pointSum: number;
  percentSum: number;
  /**
   * Authored explicit widths by column index (points as numbers, `"NN%"`
   * strings kept verbatim) — what a fix has to rescale. Columns without an
   * explicit width are absent.
   */
  explicitWidths: ReadonlyArray<{ index: number; width: number | string }>;
}

export interface DocxHeadingFact extends QualityFact {
  kind: 'docx/heading';
  level: number;
  previousLevel?: number;
}

/**
 * A paragraph pinned into a floating frame — the one place in DOCX where the
 * author, not the layout engine, decides how much room the text gets. Flowed
 * body copy repaginates; a frame keeps its declared box and lets the text spill
 * or break inside it.
 */
export interface DocxFrameTextFact extends QualityFact {
  kind: 'docx/frame-text';
  text: string;
  fontSizePt: number;
  /** Height of one line, including the resolved line-spacing rule. */
  lineHeightPt: number;
  /** Signed tracking in points: negative when the run is condensed. */
  characterSpacingPt: number;
  frameWidthTwips: number;
  frameHeightTwips?: number;
  /** Frame top, when pinned with an absolute vertical offset. */
  offsetYTwips?: number;
  /** The paper edge — the last twip anything can render on. */
  pageBottomTwips: number;
  /** The longest whitespace-delimited token — the one with nowhere to wrap. */
  longestWord: string;
}

/**
 * A `<text>` element inside an inline SVG, with the canvas it has to sit in.
 * SVG has no overflow rule to fall back on: a baseline past the viewBox is
 * simply not painted, and the words leave the document's text layer with it.
 */
export interface DocxSvgTextFact extends QualityFact {
  kind: 'docx/svg-text';
  content: string;
  /** Baseline position and nominal size, in viewBox units. */
  baselineY: number;
  fontSizeUnits: number;
  viewBoxMinY: number;
  viewBoxHeight: number;
}

export type DocxQualityFact =
  | DocxTableWidthFact
  | DocxHeadingFact
  | DocxFrameTextFact
  | DocxSvgTextFact;

export interface DocxQualityModel {
  authored: ReportComponentDefinition;
  context: GenerationThemeContext;
  document: ResolvedDocumentTree;
  themeName: string;
}

export interface PrepareDocxQualityOptions {
  customThemes?: Record<string, ThemeConfig>;
  fonts?: FontRuntimeOpts;
  warnings?: GenerationWarning[];
  context?: GenerationThemeContext;
  renderer?: string;
}

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

interface PageBox {
  availableWidthTwips: number;
  /**
   * The paper edge, not the text area. Floating frames are anchored to the
   * page and routinely sit inside the bottom margin by design — every running
   * footer in the stock reports does. Only the sheet itself is a hard floor.
   */
  pageBottomTwips: number;
}

function pageBox(
  theme: ThemeConfig,
  themeName: string,
  pageOverride?: unknown
): PageBox {
  const page = createSectionProperties(
    getColumnSettings('single'),
    theme,
    themeName,
    'nextPage',
    pageOverride as Parameters<typeof createSectionProperties>[4]
  ).page;
  return {
    availableWidthTwips: Math.max(
      0,
      page.size.width - page.margin.left - page.margin.right
    ),
    pageBottomTwips: page.size.height,
  };
}

function tableFact(
  props: Rec,
  path: string,
  availableWidthTwips: number
): DocxTableWidthFact | undefined {
  const columns = Array.isArray(props.columns) ? props.columns : undefined;
  if (!columns) return undefined;

  let totalWidthTwips = 0;
  let hasExplicitWidth = false;
  let pointSum = 0;
  let percentSum = 0;
  const explicitWidths: Array<{ index: number; width: number | string }> = [];

  columns.forEach((column, index) => {
    const width = asRecord(column)?.width;
    if (typeof width === 'number' && Number.isFinite(width)) {
      hasExplicitWidth = true;
      explicitWidths.push({ index, width });
      totalWidthTwips += relativeLengthToTwips(width, availableWidthTwips);
      pointSum += width;
    } else if (typeof width === 'string') {
      hasExplicitWidth = true;
      const percent = width.trim().endsWith('%')
        ? Number(width.trim().slice(0, -1))
        : Number.NaN;
      if (Number.isFinite(percent)) {
        explicitWidths.push({ index, width });
        percentSum += percent;
        // relativeLengthToTwips clamps anything past 100% to zero for the
        // renderer; the fact must carry the authored width or the widest
        // tables of all report as clean.
        totalWidthTwips += Math.max(
          0,
          Math.round((availableWidthTwips * percent) / 100)
        );
      }
    }
  });

  return {
    id: `docx:table-width:${path}`,
    kind: 'docx/table-width',
    path: `${path}/props/columns`,
    totalWidthTwips,
    availableWidthTwips,
    hasExplicitWidth,
    allColumnsExplicit: explicitWidths.length === columns.length,
    pointSum,
    percentSum,
    explicitWidths,
  };
}

const TWIPS_PER_POINT = 20;
/** Word's single-spaced line box for a typical Latin face. */
const SINGLE_LINE_RATIO = 1.2;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Resolved line box in points for the `font.lineSpacing` union. */
function lineHeightPt(fontSizePt: number, spacing: unknown): number {
  const rule = asRecord(spacing);
  const value = finiteNumber(rule?.value);
  switch (rule?.type) {
    // `exactly` is an absolute line box, and display type routinely sets it
    // below the font size — reading it as a multiplier would inflate every
    // estimate on exactly the headings that matter most.
    case 'exactly':
      return value ?? fontSizePt * SINGLE_LINE_RATIO;
    case 'atLeast':
      return Math.max(value ?? 0, fontSizePt * SINGLE_LINE_RATIO);
    case 'multiple':
      return fontSizePt * SINGLE_LINE_RATIO * (value ?? 1);
    default:
      return fontSizePt * SINGLE_LINE_RATIO;
  }
}

/** Signed tracking in points; the authored unit is twentieths of a point. */
function characterSpacingPt(spacing: unknown): number {
  const rule = asRecord(spacing);
  const value = finiteNumber(rule?.value);
  if (rule === undefined || value === undefined) return 0;
  return rule.type === 'condensed'
    ? -value / TWIPS_PER_POINT
    : value / TWIPS_PER_POINT;
}

function frameTextFact(
  props: Rec,
  path: string,
  page: PageBox
): DocxFrameTextFact | undefined {
  const floating = asRecord(props.floating);
  const frameWidthTwips = finiteNumber(floating?.width);
  if (frameWidthTwips === undefined) return undefined;

  const text = typeof props.text === 'string' ? props.text : '';
  if (text.trim() === '') return undefined;

  const font = asRecord(props.font);
  const fontSizePt = finiteNumber(font?.size);
  // Without an authored size the theme decides, and the theme's body size is
  // never the reason a frame overflows. Staying silent beats guessing.
  if (fontSizePt === undefined) return undefined;

  const longestWord = text
    .split(/\s+/)
    .reduce(
      (longest, word) => (word.length > longest.length ? word : longest),
      ''
    );
  const offsetY = finiteNumber(asRecord(floating?.verticalPosition)?.offset);

  return {
    id: `docx:frame-text:${path}`,
    kind: 'docx/frame-text',
    path,
    text,
    fontSizePt,
    lineHeightPt: lineHeightPt(fontSizePt, font?.lineSpacing),
    characterSpacingPt: characterSpacingPt(font?.characterSpacing),
    frameWidthTwips,
    ...(finiteNumber(floating?.height) !== undefined && {
      frameHeightTwips: finiteNumber(floating?.height) as number,
    }),
    ...(offsetY !== undefined && { offsetYTwips: offsetY }),
    pageBottomTwips: page.pageBottomTwips,
    longestWord,
  };
}

const SVG_VIEWBOX =
  /viewBox\s*=\s*"\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)\s*"/;
const SVG_TEXT = /<text\b([^>]*)>([^<]*)<\/text>/g;
const SVG_ATTR = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*"(-?[\\d.]+)"`);

/**
 * Text baselines in an inline SVG, paired with the canvas they must fall
 * inside. Regex rather than a parser: this reads one authored attribute set on
 * a flat element, and core-docx has no XML dependency to lean on.
 */
function svgTextFacts(props: Rec, path: string): DocxSvgTextFact[] {
  const svg = typeof props.svg === 'string' ? props.svg : undefined;
  if (!svg) return [];
  const box = SVG_VIEWBOX.exec(svg);
  if (!box) return [];
  const viewBoxMinY = Number(box[2]);
  const viewBoxHeight = Number(box[4]);
  if (!Number.isFinite(viewBoxMinY) || !Number.isFinite(viewBoxHeight)) {
    return [];
  }

  const facts: DocxSvgTextFact[] = [];
  let match: RegExpExecArray | null;
  SVG_TEXT.lastIndex = 0;
  let index = 0;
  while ((match = SVG_TEXT.exec(svg)) !== null) {
    const [, attributes, content] = match;
    const baselineY = Number(SVG_ATTR('y').exec(attributes)?.[1]);
    if (!Number.isFinite(baselineY)) {
      index += 1;
      continue;
    }
    const fontSizeUnits = Number(
      SVG_ATTR('font-size').exec(attributes)?.[1] ?? 0
    );
    facts.push({
      id: `docx:svg-text:${path}:${index}`,
      kind: 'docx/svg-text',
      path: `${path}/props/svg`,
      content: content.trim(),
      baselineY,
      fontSizeUnits: Number.isFinite(fontSizeUnits) ? fontSizeUnits : 0,
      viewBoxMinY,
      viewBoxHeight,
    });
    index += 1;
  }
  return facts;
}

function walkActive(
  node: unknown,
  path: string,
  page: PageBox,
  visit: (node: Rec, path: string, page: PageBox) => void
): void {
  const rec = asRecord(node);
  if (!rec || rec.enabled === false) return;
  visit(rec, path, page);
  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    walkActive(child, `${path}/children/${index}`, page, visit)
  );
}

export function prepareDocxQualityDocument(
  document: ReportComponentDefinition,
  options: PrepareDocxQualityOptions = {}
): PreparedDocument<DocxQualityModel, DocxQualityFact> {
  const context =
    options.context ??
    resolveThemeContext(normalizeDocument(document)[0], {
      customThemes: options.customThemes,
      fonts: options.fonts,
      warnings: options.warnings,
    });
  const resolved = resolveDocumentTree(context.document, context.theme);
  const basePage = pageBox(resolved.theme, context.themeName);
  const facts: DocxQualityFact[] = [];
  const provenance: Record<string, ProvenanceMap[string]> = {};
  let previousHeadingLevel: number | undefined;

  const addFact = (fact: DocxQualityFact): void => {
    facts.push(fact);
    provenance[fact.id] = {
      path: fact.path,
      ...(fact.relatedPaths && { relatedPaths: fact.relatedPaths }),
    };
  };

  const visit = (node: Rec, path: string, page: PageBox): void => {
    const props = asRecord(node.props) ?? {};
    if (node.name === 'table') {
      const fact = tableFact(props, path, page.availableWidthTwips);
      if (fact) addFact(fact);
    }

    if (node.name === 'paragraph' || node.name === 'text-box') {
      const fact = frameTextFact(props, path, page);
      if (fact) addFact(fact);
    }

    if (node.name === 'image' || node.name === 'visual') {
      for (const fact of svgTextFacts(props, path)) addFact(fact);
    }

    if (node.name === 'heading') {
      const level =
        typeof props.level === 'number' && Number.isFinite(props.level)
          ? props.level
          : 1;
      addFact({
        id: `docx:heading:${path}`,
        kind: 'docx/heading',
        path: `${path}/props/level`,
        level,
        ...(previousHeadingLevel !== undefined && {
          previousLevel: previousHeadingLevel,
        }),
      });
      previousHeadingLevel = level;
    }
  };

  resolved.children.forEach((component, index) => {
    const rec = component as ComponentDefinition & {
      props?: Record<string, unknown>;
    };
    const page =
      rec.name === 'section'
        ? pageBox(resolved.theme, context.themeName, rec.props?.page)
        : basePage;
    walkActive(component, `/children/${index}`, page, visit);
  });

  return {
    format: 'docx',
    model: {
      authored: document,
      context,
      document: resolved,
      themeName: context.themeName,
    },
    facts,
    provenance,
    renderer: options.renderer ?? DEFAULT_DOCX_RENDERER_ID,
  };
}

import {
  collectColorLiterals,
  collectFontFamilies,
  collectPlaceholders,
  normalizeHex,
  type PlaceholderKind,
  type PreparedDocument,
  type ProvenanceMap,
  type QualityFact,
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
import { resolveFontSize } from '../styles/utils/styleHelpers';
import { getThemeStyles } from '../themes/defaults';
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
  /**
   * Resolved anchor when the frame is pinned by numeric offsets; an unstated
   * axis pins at 0, exactly as the compiler resolves it. Absent for
   * alignment-positioned frames and for percentage offsets, which this static
   * pass does not resolve.
   */
  absoluteOffsetTwips?: { x: number; y: number };
  /**
   * What each axis's offset is measured from — `page` unless authored.
   * Offsets are only comparable between frames sharing both references.
   */
  anchorHorizontal: string;
  anchorVertical: string;
  /**
   * Shared by consecutive paragraphs whose frame properties are identical.
   * OOXML merges those into one flowing frame (§17.3.1.11 — the stock stat
   * cards stack number, caption and body this way), so their texts stack
   * inside the box rather than painting over each other. Any rule comparing
   * frame rects must treat a chain as a single frame.
   */
  frameChainId: string;
  /**
   * Top-level flow this frame renders in. Every top-level `section` starts a
   * new page, so frames in different flows never share one; top-level content
   * outside any section shares the flow it lands in.
   */
  flowIndex: number;
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

/**
 * A paragraph or heading whose line box is pinned with `exactly` — the one
 * line-spacing form that is an absolute height rather than a floor the line may
 * grow past. `atLeast` and the multiples can only ever be as tall as the text
 * needs; an exact box keeps its stated height and the glyphs are clipped to it.
 */
export interface DocxLineBoxFact extends QualityFact {
  kind: 'docx/line-box';
  /** The pinned box, in points. */
  lineBoxPt: number;
  /** Size of the text inside it: authored, defaulted, or from the style. */
  fontSizePt: number;
  /** Whether the size came from the component rather than the paragraph style. */
  fontSizeAuthored: boolean;
  /**
   * Whether `path` addresses a member of the authored document. A line box
   * arriving through `componentDefaults` has no such member, and an RFC 6902
   * `add` under a parent that does not exist fails instead of repairing.
   */
  patchable: boolean;
}

/** The resolved theme, as the brand rules see it. */
export interface DocxThemeFact extends QualityFact {
  kind: 'docx/theme';
  themeName: string;
  /** Token name to `#RRGGBB`, for every palette entry that resolves. */
  paletteHexes: Readonly<Record<string, string>>;
  fontFamilies: readonly string[];
}

/** A colour written as a literal rather than as a theme token. */
export interface DocxColorFact extends QualityFact {
  kind: 'docx/color';
  raw: string;
  hex: string;
}

/** A font family the document asks for by name. */
export interface DocxFontFact extends QualityFact {
  kind: 'docx/font-family';
  family: string;
}

/** One authored string that reads as a placeholder rather than as content. */
export interface DocxPlaceholderFact extends QualityFact {
  kind: 'docx/placeholder';
  text: string;
  placeholderKind: PlaceholderKind;
  pattern: string;
  excerpt: string;
}

export type DocxQualityFact =
  | DocxTableWidthFact
  | DocxHeadingFact
  | DocxFrameTextFact
  | DocxSvgTextFact
  | DocxLineBoxFact
  | DocxPlaceholderFact
  | DocxThemeFact
  | DocxColorFact
  | DocxFontFact;

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

/**
 * Whether `pointer` addresses a member of `root`. Tokens here are the fixed
 * names and array indices this walk builds, so RFC 6901 escaping never arises.
 */
function pointerExists(root: unknown, pointer: string): boolean {
  let current: unknown = root;
  for (const token of pointer.split('/').slice(1)) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return false;
      current = current[index];
      continue;
    }
    const record = asRecord(current);
    if (!record) return false;
    current = record[token];
  }
  return current !== undefined;
}

/**
 * The theme style a component inherits its run size from when it states none.
 * Mirrors the compiler: a heading takes `heading{level}`, a paragraph takes its
 * `themeStyle` — including the display-only heading clones, which are built
 * from the same style — and everything else falls back to `normal`.
 */
function styleKey(node: Rec, props: Rec): string {
  if (node.name === 'heading') {
    return `heading${finiteNumber(props.level) ?? 1}`;
  }
  return typeof props.themeStyle === 'string' && props.themeStyle !== ''
    ? props.themeStyle
    : 'normal';
}

/** The theme's styles and font table, resolved once for the whole walk. */
interface Typography {
  styles: Rec;
  theme: ThemeConfig;
}

/**
 * Size of the text a line box has to hold. An unstated size is not unknown
 * here the way it is for frame geometry: the run inherits the paragraph style,
 * which is the size Word will lay out, and the collapsed-box question cannot
 * be asked without it. The style states a size or names a theme font that
 * carries one — the same two steps the compiler takes.
 */
function effectiveFontSize(
  node: Rec,
  props: Rec,
  typography: Typography
): { fontSizePt: number; authored: boolean } | undefined {
  const authored = finiteNumber(asRecord(props.font)?.size);
  if (authored !== undefined) return { fontSizePt: authored, authored: true };
  const { styles, theme } = typography;
  const style =
    asRecord(styles[styleKey(node, props)]) ?? asRecord(styles.normal);
  const stated = finiteNumber(style?.size);
  if (stated !== undefined) return { fontSizePt: stated, authored: false };
  const reference =
    style?.font === 'heading' ||
    style?.font === 'body' ||
    style?.font === 'mono' ||
    style?.font === 'light'
      ? style.font
      : undefined;
  const inherited = resolveFontSize(theme, reference);
  return inherited === undefined
    ? undefined
    : { fontSizePt: inherited, authored: false };
}

/**
 * The absolute line box a component pins, with the pointer that states it.
 * `compileSpacing` reads the top-level spelling before the one under `font`,
 * so a top-level rule that is not `exactly` hides an exact box below it.
 */
function pinnedLineBox(
  props: Rec,
  path: string
): { lineBoxPt: number; pointer: string } | undefined {
  const candidates: ReadonlyArray<[unknown, string]> = [
    [props.lineSpacing, `${path}/props/lineSpacing`],
    [asRecord(props.font)?.lineSpacing, `${path}/props/font/lineSpacing`],
  ];
  for (const [spacing, pointer] of candidates) {
    if (spacing === undefined) continue;
    // A bare number is a multiple of single spacing, never an absolute box.
    const rule = asRecord(spacing);
    if (rule?.type !== 'exactly') return undefined;
    const lineBoxPt = finiteNumber(rule.value);
    return lineBoxPt === undefined ? undefined : { lineBoxPt, pointer };
  }
  return undefined;
}

function lineBoxFact(
  node: Rec,
  props: Rec,
  path: string,
  typography: Typography,
  authored: unknown
): DocxLineBoxFact | undefined {
  // No glyphs, nothing to clip: an empty paragraph with a collapsed box is how
  // a thin spacer rule is drawn, and the stock templates draw them that way.
  if (typeof props.text !== 'string' || props.text.trim() === '') {
    return undefined;
  }
  const pinned = pinnedLineBox(props, path);
  if (!pinned) return undefined;
  const size = effectiveFontSize(node, props, typography);
  if (size === undefined) return undefined;
  return {
    id: `docx:line-box:${path}`,
    kind: 'docx/line-box',
    path: pinned.pointer,
    lineBoxPt: pinned.lineBoxPt,
    fontSizePt: size.fontSizePt,
    fontSizeAuthored: size.authored,
    patchable: pointerExists(authored, pinned.pointer),
  };
}

/**
 * The frame properties that decide OOXML frame identity: consecutive
 * paragraphs are one flowing frame exactly when all of these agree.
 */
function frameSignature(floating: Rec): string {
  const horizontal = asRecord(floating.horizontalPosition);
  const vertical = asRecord(floating.verticalPosition);
  return JSON.stringify([
    floating.width ?? null,
    floating.height ?? null,
    horizontal?.offset ?? null,
    horizontal?.relative ?? null,
    horizontal?.align ?? null,
    vertical?.offset ?? null,
    vertical?.relative ?? null,
    vertical?.align ?? null,
    asRecord(floating.wrap)?.type ?? null,
  ]);
}

function frameTextFact(
  props: Rec,
  path: string,
  page: PageBox,
  frameChainId: string,
  flowIndex: number
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
  const horizontal = asRecord(floating?.horizontalPosition);
  const vertical = asRecord(floating?.verticalPosition);
  const offsetX = finiteNumber(horizontal?.offset);
  const offsetY = finiteNumber(vertical?.offset);
  // The compiler switches to absolute placement when either axis states an
  // offset, pinning the unstated axis at 0. A percentage offset would need
  // the resolver, so the anchor stays unresolved rather than guessed.
  const absolutelyPinned =
    horizontal?.offset !== undefined || vertical?.offset !== undefined;
  const resolvable =
    (horizontal?.offset === undefined || offsetX !== undefined) &&
    (vertical?.offset === undefined || offsetY !== undefined);

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
    ...(absolutelyPinned &&
      resolvable && {
        absoluteOffsetTwips: { x: offsetX ?? 0, y: offsetY ?? 0 },
      }),
    anchorHorizontal:
      typeof horizontal?.relative === 'string' ? horizontal.relative : 'page',
    anchorVertical:
      typeof vertical?.relative === 'string' ? vertical.relative : 'page',
    frameChainId,
    flowIndex,
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
  const typography: Typography = {
    styles: getThemeStyles(resolved.theme) as Rec,
    theme: resolved.theme,
  };
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

  const paletteHexes: Record<string, string> = {};
  for (const [token, value] of Object.entries(
    (resolved.theme.colors ?? {}) as Record<string, unknown>
  )) {
    if (typeof value !== 'string') continue;
    const hex = normalizeHex(value);
    if (hex) paletteHexes[token] = hex;
  }
  addFact({
    id: 'docx:theme',
    kind: 'docx/theme',
    path: '/props',
    themeName: context.themeName,
    paletteHexes,
    // `heading` and `body` only. A theme also names `mono` and `light`, but
    // those paint nothing until a component asks for them — counting an
    // unused `Courier New` against a document's family budget would flag a
    // report that only ever uses one typeface.
    fontFamilies: [
      ...new Set(
        (['heading', 'body'] as const).flatMap((role) => {
          const family = asRecord(
            (resolved.theme.fonts as Rec | undefined)?.[role]
          )?.family;
          return typeof family === 'string' && family.trim() !== ''
            ? [family]
            : [];
        })
      ),
    ],
  });

  collectColorLiterals(document).forEach((literal, index) => {
    addFact({
      id: `docx:color:${index}:${literal.path}`,
      kind: 'docx/color',
      path: literal.path,
      raw: literal.raw,
      hex: literal.hex,
    });
  });

  collectFontFamilies(document).forEach((use, index) => {
    addFact({
      id: `docx:font:${index}:${use.path}`,
      kind: 'docx/font-family',
      path: use.path,
      family: use.family,
    });
  });

  // Over the authored tree, before normalization: a marker has to be reported
  // where the author can patch it out.
  collectPlaceholders(document).forEach((occurrence, index) => {
    addFact({
      id: `docx:placeholder:${index}:${occurrence.path}`,
      kind: 'docx/placeholder',
      path: occurrence.path,
      text: occurrence.text,
      placeholderKind: occurrence.match.kind,
      pattern: occurrence.match.pattern,
      excerpt: occurrence.match.excerpt,
    });
  });

  // Frame-chain state. A chain extends only while nothing rendered between
  // its members, so every visited node advances `previousVisitPath` — and a
  // framed paragraph with no fact of its own (no authored font size) still
  // has to carry the chain, or one silent member would split a stat card
  // into two "overlapping" frames.
  let previousVisitPath: string | undefined;
  let lastFrame:
    | { path: string; signature: string; chainId: string }
    | undefined;
  let flowIndex = 0;
  const parentOf = (path: string): string =>
    path.slice(0, path.lastIndexOf('/'));

  const visit = (node: Rec, path: string, page: PageBox): void => {
    const props = asRecord(node.props) ?? {};
    if (node.name === 'table') {
      const fact = tableFact(props, path, page.availableWidthTwips);
      if (fact) addFact(fact);
    }

    if (node.name === 'paragraph' || node.name === 'text-box') {
      const floating = asRecord(props.floating);
      if (floating) {
        const signature = frameSignature(floating);
        const chainId =
          lastFrame !== undefined &&
          previousVisitPath === lastFrame.path &&
          parentOf(lastFrame.path) === parentOf(path) &&
          lastFrame.signature === signature
            ? lastFrame.chainId
            : `docx:frame-chain:${path}`;
        lastFrame = { path, signature, chainId };
        const fact = frameTextFact(props, path, page, chainId, flowIndex);
        if (fact) addFact(fact);
      }
    }

    if (node.name === 'paragraph' || node.name === 'heading') {
      const fact = lineBoxFact(node, props, path, typography, context.document);
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

    previousVisitPath = path;
  };

  resolved.children.forEach((component, index) => {
    const rec = component as ComponentDefinition & {
      props?: Record<string, unknown>;
    };
    if (rec.name === 'section') flowIndex += 1;
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

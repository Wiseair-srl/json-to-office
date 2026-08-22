/**
 * Compile a processed document into DocxIR.
 *
 * The input is the authoring tree after schema validation, custom-component
 * expansion, theme resolution and component defaults (`ProcessedDocument`),
 * paired with the section and column plan (`LayoutPlan`). What remains, and
 * what this module does, is the last mile: the inline mini-language becomes
 * inline nodes, points become twips and half-points, theme colour tokens become
 * hex, and a font weight becomes the family alias it resolves to.
 *
 * No renderer is imported here, and none may be. The output is plain data.
 *
 * Scope: this is the first vertical slice — document metadata and settings,
 * sections and page setup, headers and footers, paragraphs and headings with
 * their runs, bookmarks, inline images and simple tables. Anything outside it
 * is reported through `unsupported`, so a caller can tell "not yet compiled"
 * from "compiled to nothing", and the default pipeline stays on the pre-IR path
 * until the gap closes.
 */

import {
  FeatureRequirementCollector,
  type FeatureRequirement,
} from '@json-to-office/shared/rendering';
import type { GenerationWarning } from '@json-to-office/shared';
import { synthesizeFamilyName } from '@json-to-office/shared';
import type { LayoutPlan, SectionLayout } from '../core/layout';
import type { ProcessedDocument } from '../core/structure';
import type { ComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import { resolveColor } from '../styles/utils/colorUtils';
import { resolveFontFamily } from '../styles/utils/styleHelpers';
import { getNormalStyle, getThemeFonts } from '../themes/defaults';
import { computeSectionOrdinals } from '../core/sectionOrdinals';
import {
  dedupeBookmarkId,
  slugifyBookmarkText,
} from '../utils/bookmarkRegistry';
import { resolveListLevels, type ListLevelSource } from '../utils/listLevels';
import {
  resolveTableModel,
  type ResolvedBorder,
  type ResolvedCell,
  type ResolvedRow,
  type ResolvedTable,
  type TableSource,
} from '../core/tableModel';
import { getPageSetup, getTableStyle } from '../styles/utils/layoutUtils';
import type { ImageResources, LoadedImage } from '../core/imageResources';
import {
  calculateMissingDimension,
  detectImageType,
  parseDimensionValue,
  parseWidthValue,
  resolveImageSource,
} from '../utils/imageUtils';
import {
  getAvailableHeightTwips,
  getAvailableWidthTwips,
  getPageHeightTwips,
  getPageWidthTwips,
  resolveOffsetTwips,
} from '../utils/widthUtils';
import {
  HEADING_NUMBERING_REFERENCE,
  type ListLevelConfig,
  type ListMarkerFontConfig,
} from '../utils/numberingConfig';
import { normalizeUnicodeText } from '../utils/unicode';
import {
  containsLink,
  containsUnsupportedSyntax,
  parseInline,
  parseLiteral,
} from './inline';
import type { DocxFeature } from './features';
import {
  DOCX_IR_SCHEMA_VERSION,
  type DocxIR,
  type DocxIrAlignment,
  type DocxIrBlock,
  type DocxIrBorder,
  type DocxIrFloating,
  type DocxIrFloatingPosition,
  type DocxIrHeaderFooter,
  type DocxIrImageRun,
  type DocxIrInline,
  type DocxIrNumbering,
  type DocxIrNumberingLevel,
  type DocxIrParagraph,
  type DocxIrParagraphFormatting,
  type DocxIrResource,
  type DocxIrRunFormatting,
  type DocxIrSection,
  type DocxIrSectionProperties,
  type DocxIrSpacing,
  type DocxIrStyles,
  type DocxIrTableCell,
  type DocxIrTableRow,
  type DocxIrTextWrap,
  type DocxIrVerticalAlign,
} from './types';
import {
  blockId,
  headerFooterBlockId,
  inchesToTwips,
  irColor,
  pixelsToEmu,
  pointsToEighthPoints,
  pointsToHalfPoints,
  pointsToTwips,
  sha256Hex,
  twipsToEmu,
  twipsToPixels,
} from './units';

/** A component the compiler does not yet lower into IR. */
export interface UnsupportedComponent {
  name: string;
  path: string;
  /** What about it is not handled, when the component itself is. */
  detail?: string;
}

export interface DocxCompileResult {
  ir: DocxIR;
  /** Backend capabilities the IR needs, with the IR path that needs them. */
  required: readonly FeatureRequirement<DocxFeature>[];
  warnings: GenerationWarning[];
  /**
   * What the compiler could not lower. Empty once the migration is complete;
   * until then this is what keeps the pre-IR path authoritative instead of
   * silently dropping content.
   */
  unsupported: UnsupportedComponent[];
}

/**
 * Content bookmarks number from here up.
 *
 * `w:id` pairs a `bookmarkStart` with its `bookmarkEnd`, so it has to be unique
 * across the whole document. Section bookmarks take two lower ranges — layout
 * ordinals from 1, nested sections from 1_000_000 (see `sectionBookmarks.ts`) —
 * and this is the third disjoint one.
 */
const CONTENT_BOOKMARK_ID_BASE = 2_000_000;

/** One line of single spacing, in twips — the unit `w:line` counts in. */
const SINGLE_LINE_TWIPS = 240;

/** Shared mutable state for one compilation. Never module-global. */
interface CompileContext {
  theme: ThemeConfig;
  themeName: string;
  warnings: GenerationWarning[];
  features: FeatureRequirementCollector<DocxFeature>;
  unsupported: UnsupportedComponent[];
  resources: DocxIrResource[];
  resourcesByHash: Map<string, string>;
  /** Content bookmark ids, allocated in document order from {@link CONTENT_BOOKMARK_ID_BASE}. */
  nextBookmarkId: number;
  /**
   * Bookmark names already taken, in document order.
   *
   * A heading with no author-supplied id slugs its text, and two headings can
   * easily slug to the same thing — so the slug is disambiguated against every
   * name allocated before it, explicit ones included.
   */
  bookmarkNames: Set<string>;
  styleIds: Set<string>;
  /** Numbering definitions, in the order the lists that need them appear. */
  numbering: DocxIrNumbering[];
  numberingByReference: Map<string, DocxIrNumbering>;
  /** Counter behind the generated `list-1`, `list-2`, … references. */
  listCounter: number;
  /** Warning messages already collected, so one bad value warns once. */
  warnedMessages: Set<string>;
  /** Image bytes, loaded before compilation started. */
  images: ImageResources;
}

export function compileDocument(
  structure: ProcessedDocument,
  layout: LayoutPlan,
  warnings: GenerationWarning[] = [],
  images: ImageResources = new Map()
): DocxCompileResult {
  const styles = compileStyleManifest(structure.theme);
  const ctx: CompileContext = {
    theme: structure.theme,
    themeName: structure.themeName,
    warnings,
    features: new FeatureRequirementCollector<DocxFeature>(),
    unsupported: [],
    resources: [],
    resourcesByHash: new Map(),
    nextBookmarkId: CONTENT_BOOKMARK_ID_BASE + 1,
    bookmarkNames: new Set(),
    styleIds: new Set([
      ...styles.paragraph.map((s) => s.id),
      ...styles.character.map((s) => s.id),
    ]),
    numbering: [],
    numberingByReference: new Map(),
    listCounter: 0,
    warnedMessages: new Set(),
    images,
  };

  ctx.features.require('paragraphs', 'sections');
  ctx.features.require('styles', 'styles');
  if (layout.sections.length > 1) ctx.features.require('sections', 'sections');

  // A user-defined section can be split across several layout sections; the
  // fold decides which one opens the shared bookmark and which one closes it.
  const ordinals = computeSectionOrdinals(layout.sections);
  const chrome = resolveSectionChrome(layout.sections);
  const sections = layout.sections.map((section, index) =>
    compileSection(section, index, ordinals[index], chrome[index], ctx)
  );

  const ir: DocxIR = {
    schemaVersion: DOCX_IR_SCHEMA_VERSION,
    metadata: compileMetadata(structure),
    settings: {
      ...(structure.language ? { language: structure.language } : {}),
      updateFields: true,
      trackRevisions: structure.trackRevisions === true,
      ...(noProofWords(structure.theme)
        ? { noProofWords: noProofWords(structure.theme) }
        : {}),
    },
    styles,
    numbering: ctx.numbering,
    resources: ctx.resources,
    sections,
    comments: [],
    footnotes: [],
    endnotes: [],
  };

  return {
    ir,
    required: ctx.features.list(),
    warnings: ctx.warnings,
    unsupported: ctx.unsupported,
  };
}

/* ------------------------------------------------------------------ *
 * Document level
 * ------------------------------------------------------------------ */

/**
 * Core and custom document properties.
 *
 * `subtitle` lands in the `subject` slot and `company`/`version` have no core
 * slot at all, so they become custom properties — the same mapping the pre-IR
 * writer used. Created and modified timestamps are pinned during packaging, so
 * the value here is only a placeholder.
 */
function compileMetadata(structure: ProcessedDocument): DocxIR['metadata'] {
  const { metadata } = structure;
  const timestamp = metadata.date.toISOString();
  const custom = [
    ...(metadata.company ? [{ name: 'Company', value: metadata.company }] : []),
    ...(metadata.version ? [{ name: 'Version', value: metadata.version }] : []),
  ];

  return {
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.subtitle ? { subject: metadata.subtitle } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.author
      ? { author: metadata.author, lastModifiedBy: metadata.author }
      : {}),
    ...(metadata.tags?.length ? { keywords: metadata.tags.join(', ') } : {}),
    ...(custom.length > 0 ? { custom } : {}),
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

function noProofWords(theme: ThemeConfig): string[] | undefined {
  const words = (theme as { noProofWords?: string[] }).noProofWords;
  return words && words.length > 0 ? words : undefined;
}

/** The document-wide allowlist plus a component's own, de-duplicated. */
function mergeNoProofWords(
  themeWords: string[] | undefined,
  componentWords: unknown
): string[] | undefined {
  const own = Array.isArray(componentWords) ? (componentWords as string[]) : [];
  const merged = [...(themeWords ?? []), ...own];
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

/**
 * The style ids a paragraph may reference.
 *
 * A manifest rather than a full compilation: the style *definitions* still come
 * from the theme adapter, which is the next piece of the migration. Recording
 * the ids here is what lets IR validation catch a paragraph pointing at a style
 * that does not exist.
 */
function compileStyleManifest(theme: ThemeConfig): DocxIrStyles {
  const builtIn = [
    'Normal',
    'Title',
    'Subtitle',
    'Header',
    'Footer',
    'StatisticNumber',
    'StatisticDescription',
    ...[1, 2, 3, 4, 5, 6].flatMap((level) => [
      `Heading${level}`,
      `JTD_HeadingText${level}`,
    ]),
  ];
  const custom = Object.keys(theme.styles ?? {});

  return {
    defaults: { run: {}, paragraph: {} },
    paragraph: [...new Set([...builtIn, ...custom])].map((id) => ({
      id,
      name: id,
    })),
    character: [],
  };
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/** A section's header and footer content, after inheritance is resolved. */
interface SectionChrome {
  header?: ComponentDefinition[];
  footer?: ComponentDefinition[];
}

/**
 * Decide what each section's header and footer actually contain.
 *
 * Word links a section's page chrome to the previous section's unless the
 * section says otherwise, so "no header here" cannot be expressed by leaving
 * the header out — it has to be an explicit empty one. Three cases:
 *
 * - `linkToPrevious` repeats the previous section's content;
 * - stated content is used as written, and becomes what the next section may
 *   inherit or has to override;
 * - nothing stated after a section that had chrome becomes an empty part,
 *   which is what breaks the link.
 *
 * A document whose sections never set a header or footer stays free of both.
 */
function resolveSectionChrome(
  sections: readonly SectionLayout[]
): SectionChrome[] {
  let previousHeader: ComponentDefinition[] | undefined;
  let previousFooter: ComponentDefinition[] | undefined;

  return sections.map((section) => {
    const resolve = (
      part: SectionLayout['header'],
      previous: ComponentDefinition[] | undefined
    ): {
      resolved: ComponentDefinition[] | undefined;
      previous: ComponentDefinition[] | undefined;
    } => {
      if (part === 'linkToPrevious') return { resolved: previous, previous };
      if (part) return { resolved: part, previous: part };
      return { resolved: previous ? [] : undefined, previous };
    };

    const header = resolve(section.header, previousHeader);
    previousHeader = header.previous;
    const footer = resolve(section.footer, previousFooter);
    previousFooter = footer.previous;

    return {
      ...(header.resolved ? { header: header.resolved } : {}),
      ...(footer.resolved ? { footer: footer.resolved } : {}),
    };
  });
}

function compileSection(
  section: SectionLayout,
  index: number,
  ordinal: { ordinal?: number; closeBookmark: boolean },
  chrome: SectionChrome,
  ctx: CompileContext
): DocxIrSection {
  const path = `sections[${index}]`;
  const { page, column } = section.properties;

  if (column && column.count > 1) {
    ctx.features.require('columns', `${path}.properties.columns`);
  }

  const children: DocxIrBlock[] = [];
  section.components.forEach((component, i) => {
    if ('enabled' in component && component.enabled === false) return;
    children.push(
      ...compileComponent(component, {
        ctx,
        path: `${path}.children[${i}]`,
        id: blockId(index, [i]),
      })
    );
  });

  const compiled: DocxIrSection = {
    id: `s${index}`,
    path,
    children,
    properties: {
      page: {
        widthTwips: page.size.width,
        heightTwips: page.size.height,
        orientation:
          page.size.width > page.size.height ? 'landscape' : 'portrait',
        ...(page.size.code !== undefined ? { code: page.size.code } : {}),
        margins: {
          topTwips: page.margin.top,
          bottomTwips: page.margin.bottom,
          leftTwips: page.margin.left,
          rightTwips: page.margin.right,
          ...(page.margin.header !== undefined
            ? { headerTwips: page.margin.header }
            : {}),
          ...(page.margin.footer !== undefined
            ? { footerTwips: page.margin.footer }
            : {}),
          ...(page.margin.gutter !== undefined
            ? { gutterTwips: page.margin.gutter }
            : {}),
        },
      },
      // A chunk that starts on a new page says so; the rest continue the flow.
      // The layout stage already decided which, so it is carried rather than
      // re-derived from `breakBefore`: a section can be continuous without the
      // two agreeing.
      ...(section.properties.type
        ? { type: sectionType(section.properties.type) }
        : {}),
      ...(column
        ? {
            columns: {
              count: column.count,
              ...(column.space !== undefined
                ? { spaceTwips: column.space }
                : {}),
              ...(column.equalWidth !== undefined
                ? { equalWidth: column.equalWidth }
                : {}),
              ...(column.widths
                ? {
                    widths: column.widths.map((c) => ({
                      widthTwips: c.width,
                      ...(c.space !== undefined ? { spaceTwips: c.space } : {}),
                    })),
                  }
                : {}),
            },
          }
        : {}),
    },
  };

  if (ordinal.ordinal !== undefined) {
    compiled.bookmark = {
      id: ordinal.ordinal,
      name: `_Section_${ordinal.ordinal}`,
      opens: section.isUserSection,
      closes: ordinal.closeBookmark,
    };
    ctx.features.require('bookmarks', `${path}.bookmark`);
  }

  const headers = compilePart(chrome.header, 'header', index, ctx);
  if (headers) compiled.headers = { default: headers };
  const footers = compilePart(chrome.footer, 'footer', index, ctx);
  if (footers) compiled.footers = { default: footers };

  if (headers || footers) {
    ctx.features.require('headers-footers', `${path}.headers`);
  }

  return compiled;
}

/**
 * The layout stage's section-start value, restated as the IR's own.
 *
 * The two vocabularies happen to coincide today; mapping rather than casting
 * means the IR union stays the authority if either side moves.
 */
function sectionType(
  value: string
): DocxIrSectionProperties['type'] | undefined {
  switch (value) {
    case 'nextPage':
    case 'nextColumn':
    case 'continuous':
    case 'evenPage':
    case 'oddPage':
      return value;
    default:
      return undefined;
  }
}

function compilePart(
  part: ComponentDefinition[] | undefined,
  kind: 'header' | 'footer',
  sectionIndex: number,
  ctx: CompileContext
): DocxIrHeaderFooter | undefined {
  if (!part) return undefined;

  const id = `${kind}:s${sectionIndex}:default`;
  const children: DocxIrBlock[] = [];
  // `enabled: false` is stripped from body content while sections are being
  // flattened; header and footer content never passes through that, so it is
  // filtered here instead.
  const active = part.filter(
    (component) => !('enabled' in component && component.enabled === false)
  );
  active.forEach((component, i) => {
    const scope: ComponentScope = {
      ctx,
      path: `sections[${sectionIndex}].${kind}s.default.children[${i}]`,
      id: headerFooterBlockId(id, [i]),
    };
    children.push(
      ...(component.name === 'paragraph'
        ? compileChromeParagraph(component, scope)
        : component.name === 'image'
          ? compileChromeImage(component, scope)
          : compileComponent(component, scope))
    );
  });

  // An empty part is deliberate — it is what breaks Word's link to the
  // previous section — but content that compiles to nothing is not: the
  // section keeps whatever it inherited rather than gaining a blank part.
  if (children.length === 0 && part.length > 0) return undefined;

  return { id, children };
}

/**
 * A paragraph inside a header or footer.
 *
 * Page chrome has no style of its own, so every run states its family, size,
 * colour and weight, resolved against the theme's Normal style rather than
 * inherited. That also makes it a narrower component than a body paragraph:
 * only text, alignment, font and spacing apply here. Indentation, tab stops,
 * bookmarks, notes, comments, revisions and the keep flags have never been
 * carried into page chrome and still are not.
 */
function compileChromeParagraph(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const text = String(props.text ?? '');

  if (reportUnlowered(component, props, text, scope)) return [];

  const font = (props.font ?? {}) as Record<string, any>;
  const normal = getNormalStyle(ctx.theme);
  const chromeProps: Record<string, any> = {
    text,
    ...(props.alignment ? { alignment: props.alignment } : {}),
    ...(props.spacing ? { spacing: props.spacing } : {}),
    ...(props.boldColor ? { boldColor: props.boldColor } : {}),
    font: {
      family:
        font.family ||
        resolveFontFamily(ctx.theme, normal.font) ||
        getThemeFonts(ctx.theme).body.family,
      size: font.size ?? normal.size ?? 11,
      color: font.color || normal.color || 'textPrimary',
      bold: font.bold ?? false,
      italic: font.italic ?? false,
      ...(font.underline !== undefined ? { underline: font.underline } : {}),
      ...(font.fontWeight !== undefined ? { fontWeight: font.fontWeight } : {}),
      ...(font.lineSpacing !== undefined
        ? { lineSpacing: font.lineSpacing }
        : {}),
    },
  };

  return [
    paragraphNode(scope, compileRuns(chromeProps, text, ctx, scope.path), {
      styleId: 'Normal',
      formatting: paragraphFormatting(chromeProps, ctx, {
        alwaysSpacing: true,
      }),
    }),
  ];
}

/**
 * An image inside a header or footer.
 *
 * Narrower than a body image, and differently sized: page chrome has no
 * caption, no spacing and no keep flags, its paragraph names the Normal style,
 * and it is only aligned when the author said so. A width given as a number is
 * taken literally rather than defaulting to the full measure — an unsized
 * chrome image draws at its own resolution.
 */
function compileChromeImage(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  const source = resolveImageSource(props);
  if (!source) {
    ctx.unsupported.push({
      name: 'image',
      path,
      detail: 'missing path, base64 or svg',
    });
    return [];
  }

  const loaded = ctx.images.get(source);
  if (!loaded) {
    throw new Error(`Failed to load image from ${source.substring(0, 50)}`);
  }

  const mediaType = detectImageType(source, loaded.contentType);
  if (mediaType === 'svg') ctx.features.require('svg-images', path);

  const page = getPageSetup(ctx.theme);
  const pageWidthPx = Math.round(twipsToPixels(page.size.width));
  const contentWidthPx = Math.round(
    twipsToPixels(page.size.width - page.margin.left - page.margin.right)
  );
  const pageHeightPx = Math.round(twipsToPixels(page.size.height));
  const contentHeightPx = Math.round(
    twipsToPixels(page.size.height - page.margin.top - page.margin.bottom)
  );
  const referenceWidthPx =
    props.widthRelativeTo === 'page' ? pageWidthPx : contentWidthPx;
  const referenceHeightPx =
    props.heightRelativeTo === 'page' ? pageHeightPx : contentHeightPx;

  // Only a percentage is resolved against the reference; a number is a pixel
  // count and an absent width is genuinely absent.
  const targetWidth =
    typeof props.width === 'string'
      ? parseWidthValue(props.width, referenceWidthPx)
      : (props.width as number | undefined);
  const targetHeight =
    typeof props.height === 'string'
      ? parseWidthValue(props.height, referenceHeightPx)
      : (props.height as number | undefined);

  const size = loaded.intrinsic
    ? calculateMissingDimension(
        loaded.intrinsic.width,
        loaded.intrinsic.height,
        targetWidth,
        targetHeight
      )
    : fallbackSize(targetWidth, targetHeight, {
        width: referenceWidthPx,
        height: Math.round(referenceWidthPx * 0.6),
      });

  ctx.features.require('images', path);
  if (props.floating) ctx.features.require('floating-images', path);

  const image: DocxIrImageRun = {
    kind: 'image',
    resourceId: declareResource(loaded, mediaType, ctx),
    widthEmu: pixelsToEmu(size.width),
    heightEmu: pixelsToEmu(size.height),
    ...(props.floating
      ? { floating: compileFloating(props.floating, ctx, path) }
      : {}),
  };

  return [
    {
      kind: 'paragraph',
      id: scope.id,
      path,
      styleId: 'Normal',
      children: [image],
      ...(props.alignment
        ? { formatting: { alignment: compileAlignment(props.alignment)! } }
        : {}),
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

interface ComponentScope {
  ctx: CompileContext;
  path: string;
  id: string;
}

function compileComponent(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  switch (component.name) {
    case 'paragraph':
      return compileParagraph(component, scope);
    case 'heading':
      return compileHeading(component, scope);
    case 'list':
      return compileList(component, scope);
    case 'statistic':
      return compileStatistic(component, scope);
    case 'image':
      return compileImage(component, scope);
    case 'table':
      return compileTable(component, scope);
    default:
      scope.ctx.unsupported.push({
        name: component.name,
        path: scope.path,
      });
      return [];
  }
}

/* ------------------------------------------------------------------ *
 * Paragraphs and headings
 * ------------------------------------------------------------------ */

/** Markdown decorators, the syntax that makes a heading take the parser. */
const DECORATED = /(\*\*\*|___|(\*\*|__)|(\*|_))/;

/** Props a paragraph or heading may carry that this slice does not lower. */
const UNLOWERED_PARAGRAPH_PROPS = [
  'revision',
  'comment',
  'footnotes',
  'endnotes',
  'floating',
] as const;

function compileParagraph(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const text = String(props.text ?? '');

  if (reportUnlowered(component, props, text, scope)) return [];

  const styleId = paragraphStyleId(props.themeStyle);
  if (styleId && !ctx.styleIds.has(styleId)) ctx.styleIds.add(styleId);

  const children = compileRuns(props, text, ctx, path);
  // A paragraph is a bookmark target only when the author asked for one, and
  // the id is a prop — unlike a heading, whose id sits on the component.
  const bookmarkName = typeof props.id === 'string' ? props.id : undefined;

  return [
    paragraphNode(scope, children, {
      ...(styleId ? { styleId } : {}),
      formatting: paragraphFormatting(props, ctx, {
        outlineLevel: customOutlineLevel(props.themeStyle, ctx.theme),
        // A paragraph always states its spacing, even when empty, so a
        // paragraph with none is distinguishable from a heading, which
        // deliberately leaves its style's spacing alone.
        alwaysSpacing: true,
      }),
      bookmarkName,
    }),
  ];
}

function compileHeading(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const text = String(props.text ?? '');

  if (reportUnlowered(component, props, text, scope)) return [];

  const level = headingLevel(props.level);
  // A heading with no decorators is rendered character for character — the
  // cheaper path the writer has always taken, and the reason a bare link in a
  // heading stays literal text.
  const children = compileRuns(
    props,
    text,
    ctx,
    path,
    DECORATED.test(text) ? 'inline' : 'literal'
  );

  // A heading is always a bookmark target: an explicit id, or a slug of the
  // text. That is what makes it reachable from a TOC or an internal link.
  const bookmarkName =
    (typeof component.id === 'string' ? component.id : undefined) ??
    dedupeBookmarkId(slugifyBookmarkText(text), (id) =>
      ctx.bookmarkNames.has(id)
    );

  return [
    paragraphNode(scope, children, {
      styleId: `Heading${level}`,
      // A heading with no stated alignment is left-aligned; its style's own
      // spacing is left untouched.
      formatting: paragraphFormatting(props, ctx, { defaultAlignment: 'left' }),
      bookmarkName,
      numberingNone: props.numbering === false,
      ...(props.numbering === true
        ? { numbering: declareHeadingNumbering(level, ctx, path) }
        : {}),
    }),
  ];
}

/**
 * The one numbering definition every numbered heading shares.
 *
 * Shared so that 1., 1.1., 1.1.1. is a single continuous sequence rather than
 * one that restarts at each heading. Levels bind to `Heading1`..`Heading6`
 * through `pStyle`, which is what makes Word's own restart/continue UI and the
 * `\r` cross-reference switch recognise them.
 */
function declareHeadingNumbering(
  level: number,
  ctx: CompileContext,
  path: string
): { reference: string; level: number } {
  if (!ctx.numberingByReference.has(HEADING_NUMBERING_REFERENCE)) {
    const numbering: DocxIrNumbering = {
      reference: HEADING_NUMBERING_REFERENCE,
      levels: Array.from({ length: 6 }, (_, index) => ({
        level: index,
        format: 'decimal',
        // Each level accumulates the ones above it: %1, %1.%2, %1.%2.%3, …
        text: `${Array.from({ length: index + 1 }, (_, i) => `%${i + 1}`).join('.')}.`,
        alignment: 'left' as const,
        start: 1,
        // A space, not the default tab: a tab would push the heading text to
        // the next tab stop and misalign it against unnumbered headings.
        suffix: 'space' as const,
        // A numbered heading stays flush left and takes its indentation from
        // the heading style, so the level supplies none of its own.
        indent: { leftTwips: 0, hangingTwips: 0 },
        paragraphStyleId: `Heading${index + 1}`,
      })),
    };
    ctx.numbering.push(numbering);
    ctx.numberingByReference.set(HEADING_NUMBERING_REFERENCE, numbering);
  }

  ctx.features.require('numbering', path);
  return { reference: HEADING_NUMBERING_REFERENCE, level: level - 1 };
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

/**
 * A statistic: a figure and its caption, as two styled paragraphs.
 *
 * The text is taken literally — no decorators, no links — because a statistic
 * is a number and a label, not prose. Its spacing is stated in twips: the
 * authoring value has always been passed to the writer unconverted, and
 * reinterpreting it now would move every statistic in every document.
 */
function compileStatistic(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const alignment = compileAlignment(props.alignment) ?? 'center';

  // Stating `spacing` at all, even empty, is a statement: it produces a
  // `w:spacing` element that overrides whatever the style would apply.
  const spacing: DocxIrSpacing | undefined = props.spacing
    ? {
        ...(props.spacing.before !== undefined
          ? { beforeTwips: props.spacing.before }
          : {}),
        ...(props.spacing.after !== undefined
          ? { afterTwips: props.spacing.after }
          : {}),
      }
    : undefined;

  const line = (
    text: unknown,
    styleId: string,
    suffix: string,
    formatting: DocxIrParagraphFormatting
  ): DocxIrParagraph => {
    const value = normalizeUnicodeText(String(text ?? ''));
    return {
      kind: 'paragraph',
      id: `${scope.id}:${suffix}`,
      path: `${path}.${suffix}`,
      styleId,
      formatting,
      // Nothing to say is not the same as saying nothing: an empty statistic
      // line is a styled blank paragraph, with no run inside it at all.
      children: value ? [{ kind: 'text', text: value }] : [],
    };
  };

  return [
    line(props.number, 'StatisticNumber', 'number', {
      alignment,
      ...(spacing ? { spacing } : {}),
    }),
    line(props.description, 'StatisticDescription', 'description', {
      alignment,
    }),
  ];
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

/** List props this slice does not lower. */
const UNLOWERED_LIST_PROPS = ['comment', 'footnotes', 'endnotes'] as const;

/**
 * A list: one numbering definition plus one paragraph per item.
 *
 * The levels come from `resolveListLevels`, shared with the outline pre-pass so
 * a cross-reference cannot predict a different marker from the one drawn. List
 * items deliberately carry no run formatting of their own — they inherit the
 * Normal style, which is what makes a list look like the body text around it.
 */
function compileList(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  for (const prop of UNLOWERED_LIST_PROPS) {
    if (props[prop] !== undefined) {
      ctx.unsupported.push({ name: 'list', path, detail: prop });
      return [];
    }
  }

  const items = (props.items ?? []) as ListItem[];
  if (items.length === 0) return [];

  const reference = declareNumbering(props, ctx);
  const blocks: DocxIrBlock[] = [];

  items.forEach((item, index) => {
    const text = typeof item === 'string' ? item : String(item.text ?? '');
    const level = typeof item === 'object' ? item.level ?? 0 : 0;
    const revision = typeof item === 'object' ? item.revision : undefined;
    const itemPath = `${path}.items[${index}]`;

    if (revision !== undefined) {
      ctx.unsupported.push({
        name: 'list',
        path: itemPath,
        detail: 'revision',
      });
      return;
    }
    // An item with nothing in it is not a bullet with no text; it is not an
    // item at all.
    if (!text.trim()) return;

    const syntax = containsUnsupportedSyntax(text);
    if (syntax) {
      ctx.unsupported.push({ name: 'list', path: itemPath, detail: syntax });
      return;
    }

    blocks.push(
      paragraphNode(
        { ctx, path: itemPath, id: `${scope.id}:i${index}` },
        parseInline(text, { base: {}, hyperlinks: true }),
        {
          styleId: 'Normal',
          formatting: {
            alignment: compileAlignment(props.alignment) ?? 'left',
            spacing: itemSpacing(props.spacing, index, items.length),
          },
          ...(typeof item === 'object' && typeof item.id === 'string'
            ? { bookmarkName: item.id }
            : {}),
          numbering: { reference, level },
        }
      )
    );
  });

  if (blocks.length > 0) ctx.features.require('numbering', path);
  return blocks;
}

type ListItem =
  | string
  | { text?: string; level?: number; id?: string; revision?: unknown };

/**
 * Spacing for one list item.
 *
 * `before` sits on the first item and `after` on the last, so the list as a
 * whole is spaced from its surroundings; `item` spaces every other item from
 * the next one.
 */
function itemSpacing(
  spacing: { before?: number; after?: number; item?: number } | undefined,
  index: number,
  count: number
): DocxIrSpacing {
  const out: DocxIrSpacing = {};
  if (index === 0 && spacing?.before) {
    out.beforeTwips = pointsToTwips(spacing.before);
  }
  if (index === count - 1 && spacing?.after) {
    out.afterTwips = pointsToTwips(spacing.after);
  } else if (spacing?.item) {
    out.afterTwips = pointsToTwips(spacing.item);
  }
  return out;
}

/**
 * Register this list's numbering definition and return its reference.
 *
 * A stated `reference` lets several lists share one definition — and continue
 * one numbering sequence — so the first list to claim it wins and the rest just
 * point at it.
 */
function declareNumbering(
  props: Record<string, any>,
  ctx: CompileContext
): string {
  const reference =
    typeof props.reference === 'string' && props.reference
      ? props.reference
      : `list-${++ctx.listCounter}`;

  if (ctx.numberingByReference.has(reference)) return reference;

  const numbering: DocxIrNumbering = {
    reference,
    levels: resolveListLevels(props as ListLevelSource).map((level) =>
      compileNumberingLevel(level, ctx)
    ),
  };
  ctx.numbering.push(numbering);
  ctx.numberingByReference.set(reference, numbering);
  return reference;
}

/**
 * One numbering level, with every default resolved.
 *
 * Indents are stated in points by authors and in inches by the defaults; both
 * become twips here so no renderer has to know either.
 */
function compileNumberingLevel(
  level: ListLevelConfig,
  ctx: CompileContext
): DocxIrNumberingLevel {
  const format = level.format || 'bullet';
  const text =
    level.text || (format === 'bullet' ? '•' : `%${level.level + 1}.`);
  const leftInches =
    level.indent?.left !== undefined
      ? level.indent.left / 72
      : 0.5 * (level.level + 1);
  const hangingInches =
    level.indent?.hanging !== undefined ? level.indent.hanging / 72 : 0.25;

  return {
    level: level.level,
    format,
    text,
    alignment: markerAlignment(level.alignment),
    indent: {
      leftTwips: inchesToTwips(leftInches),
      hangingTwips: inchesToTwips(hangingInches),
    },
    ...(level.start !== undefined ? { start: level.start } : {}),
    ...(markerRunFormatting(level.font, ctx)
      ? { run: markerRunFormatting(level.font, ctx)! }
      : {}),
  };
}

/**
 * How a marker sits in its own space (`w:lvlJc`).
 *
 * Wider than paragraph alignment: a marker may be `start`/`end`-aligned, which
 * follows the reading direction, and there is nothing to justify. Anything
 * unrecognised is left-aligned.
 */
function markerAlignment(value: unknown): DocxIrAlignment {
  switch (value) {
    case 'start':
    case 'end':
    case 'right':
    case 'center':
      return value;
    default:
      return 'left';
  }
}

/** The marker glyph's own formatting, resolved against the theme. */
function markerRunFormatting(
  font: ListMarkerFontConfig | undefined,
  ctx: CompileContext
): DocxIrRunFormatting | undefined {
  if (!font) return undefined;
  const run: DocxIrRunFormatting = {
    ...(font.family ? { fontFamily: font.family } : {}),
    ...(font.size !== undefined
      ? { sizeHalfPoints: pointsToHalfPoints(font.size) }
      : {}),
    ...(font.color
      ? { color: irColor(resolveColor(font.color, ctx.theme)) }
      : {}),
    ...(font.bold !== undefined ? { bold: font.bold } : {}),
    ...(font.italic !== undefined ? { italic: font.italic } : {}),
    ...(font.underline !== undefined
      ? { underline: font.underline ? { type: 'single' } : undefined }
      : {}),
  };
  return Object.keys(run).length > 0 ? run : undefined;
}

/**
 * Wrap runs into a paragraph, adding the bookmark pair when there is one.
 *
 * Bookmark ids are allocated here, in document order, so two concurrent
 * compilations of the same document produce the same ids.
 */
function paragraphNode(
  scope: ComponentScope,
  children: DocxIrInline[],
  options: {
    styleId?: string;
    formatting?: DocxIrParagraphFormatting;
    bookmarkName?: string;
    numberingNone?: boolean;
    numbering?: { reference: string; level: number };
  }
): DocxIrParagraph {
  const { ctx } = scope;
  let content = children;

  if (options.bookmarkName) {
    ctx.bookmarkNames.add(options.bookmarkName);
    const id = ctx.nextBookmarkId++;
    // A bookmark covers the text, not a break that happens to precede it —
    // a link to this paragraph should land on its content, not on the column
    // boundary before it.
    const breakCount = children.findIndex((c) => c.kind !== 'columnBreak');
    const split = breakCount === -1 ? children.length : breakCount;
    content = [
      ...children.slice(0, split),
      { kind: 'bookmarkStart', id, name: options.bookmarkName },
      ...children.slice(split),
      { kind: 'bookmarkEnd', id },
    ];
    ctx.features.require('bookmarks', scope.path);
  }

  return {
    kind: 'paragraph',
    id: scope.id,
    path: scope.path,
    children: content,
    // Body text always names a style; leaving it out is how a table cell says
    // it has none.
    styleId: options.styleId ?? 'Normal',
    ...(options.formatting ? { formatting: options.formatting } : {}),
    ...(options.numberingNone
      ? { numbering: { none: true as const } }
      : options.numbering
        ? { numbering: options.numbering }
        : {}),
  };
}

/**
 * Report anything about this component the slice does not lower.
 *
 * Returns true when the component was reported, in which case it is not
 * compiled — refusing beats emitting a paragraph with its annotations missing.
 */
function reportUnlowered(
  component: ComponentDefinition,
  props: Record<string, unknown>,
  text: string,
  scope: ComponentScope
): boolean {
  for (const prop of UNLOWERED_PARAGRAPH_PROPS) {
    if (props[prop] !== undefined) {
      scope.ctx.unsupported.push({
        name: component.name,
        path: scope.path,
        detail: prop,
      });
      return true;
    }
  }

  const syntax = containsUnsupportedSyntax(text);
  if (syntax) {
    scope.ctx.unsupported.push({
      name: component.name,
      path: scope.path,
      detail: syntax,
    });
    return true;
  }

  // Markdown list syntax turns a paragraph into a numbered list, which needs a
  // numbering definition this slice does not build.
  if (/^\s*(?:[-*+]|\d+[.)])\s+/m.test(text)) {
    scope.ctx.unsupported.push({
      name: component.name,
      path: scope.path,
      detail: 'markdown list',
    });
    return true;
  }

  return false;
}

function compileRuns(
  props: Record<string, any>,
  text: string,
  ctx: CompileContext,
  path: string,
  mode: 'inline' | 'literal' = 'inline'
): DocxIrInline[] {
  const font = (props.font ?? {}) as Record<string, any>;
  const base = runFormatting(font, props, ctx);

  if (base.language) ctx.features.require('proofing-language', path);
  if (base.noProof) ctx.features.require('proofing-language', path);

  // The document's allowlist reaches every paragraph — `processDocument` folds
  // it into the theme — and a paragraph may add words of its own on top.
  const words = mergeNoProofWords(noProofWords(ctx.theme), props.noProofWords);

  const children: DocxIrInline[] = [];
  if (props.columnBreak) {
    children.push({ kind: 'columnBreak' });
    ctx.features.require('breaks', path);
  }

  const parseOptions = {
    base,
    ...(props.boldColor
      ? { boldColor: irColor(resolveColor(props.boldColor, ctx.theme)) }
      : {}),
    ...(words ? { noProofWords: words } : {}),
  };
  children.push(
    ...(mode === 'literal'
      ? parseLiteral(text, parseOptions)
      : parseInline(text, { ...parseOptions, hyperlinks: true }))
  );
  if (mode === 'inline' && containsLink(text)) {
    ctx.features.require('hyperlinks', path);
  }

  return children;
}

/**
 * Resolve the run formatting shared by every run in a paragraph.
 *
 * A numeric weight, or `bold: true`, resolves to a synthesized family alias —
 * the same rule the rest of the pipeline uses, applied once here so no run has
 * to re-derive it. The family is only stated when the author asked for one, or
 * when aliasing produced a different one; emitting the theme body family on
 * every run would change every document.
 */
function runFormatting(
  font: Record<string, any>,
  props: Record<string, any>,
  ctx: CompileContext
): DocxIrRunFormatting {
  const hasWeightRequest = font.fontWeight != null || font.bold === true;
  const effectiveFamily =
    font.family ??
    (hasWeightRequest ? resolveBodyFamily(ctx.theme) : undefined);

  const weighted = applyFontWeightAlias({
    fontFamily: effectiveFamily,
    bold: font.bold,
    italic: font.italic,
    fontWeight: font.fontWeight,
  });

  const formatting: DocxIrRunFormatting = {};
  if (font.family || (weighted.font && weighted.font !== effectiveFamily)) {
    formatting.fontFamily = weighted.font;
  }
  if (font.size) formatting.sizeHalfPoints = pointsToHalfPoints(font.size);
  if (font.color)
    formatting.color = irColor(resolveColor(font.color, ctx.theme));
  if (weighted.bold !== undefined) formatting.bold = weighted.bold;
  if (weighted.italic !== undefined) formatting.italic = weighted.italic;
  if (font.underline !== undefined) {
    formatting.underline = font.underline ? { type: 'single' } : undefined;
  }
  if (font.scale) formatting.scalePercent = font.scale;
  if (font.characterSpacing) {
    const { type, value } = font.characterSpacing as {
      type?: string;
      value: number;
    };
    formatting.characterSpacingTwentieths =
      type === 'condensed' ? -value : value;
  }
  if (props.language) formatting.language = props.language;
  if (props.noProof !== undefined) formatting.noProof = props.noProof;

  return formatting;
}

function applyFontWeightAlias(opts: {
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: number;
}): { font?: string; bold?: boolean; italic?: boolean } {
  if (!opts.fontFamily) {
    return { bold: opts.bold, italic: opts.italic };
  }
  const weight = opts.fontWeight ?? (opts.bold === true ? 700 : undefined);
  const synth = synthesizeFamilyName(
    opts.fontFamily,
    weight,
    opts.italic === true
  );
  return { font: synth.family, bold: synth.bold, italic: synth.italic };
}

function resolveBodyFamily(theme: ThemeConfig): string | undefined {
  return (theme.fonts as { body?: { family?: string } } | undefined)?.body
    ?.family;
}

function paragraphFormatting(
  props: Record<string, any>,
  ctx: CompileContext,
  extra: {
    outlineLevel?: number;
    alwaysSpacing?: boolean;
    defaultAlignment?: DocxIrParagraphFormatting['alignment'];
  } = {}
): DocxIrParagraphFormatting | undefined {
  const formatting: DocxIrParagraphFormatting = {};

  const alignment = compileAlignment(props.alignment) ?? extra.defaultAlignment;
  if (alignment) formatting.alignment = alignment;
  const spacing = compileSpacing(props, ctx);
  if (spacing) formatting.spacing = spacing;
  else if (extra.alwaysSpacing) formatting.spacing = {};
  if (props.indent) {
    formatting.indent = {
      ...(props.indent.left !== undefined
        ? { leftTwips: props.indent.left }
        : {}),
      ...(props.indent.right !== undefined
        ? { rightTwips: props.indent.right }
        : {}),
      ...(props.indent.firstLine !== undefined
        ? { firstLineTwips: props.indent.firstLine }
        : {}),
      ...(props.indent.hanging !== undefined
        ? { hangingTwips: props.indent.hanging }
        : {}),
    };
  }
  if (Array.isArray(props.tabStops) && props.tabStops.length > 0) {
    formatting.tabStops = props.tabStops.map(
      (stop: { position: number; type?: string; leader?: string }) => ({
        positionTwips: stop.position,
        type: (stop.type ?? 'left') as never,
        ...(stop.leader ? { leader: stop.leader as never } : {}),
      })
    );
    ctx.features.require('tab-stops', 'formatting');
  }
  if (props.keepNext !== undefined) formatting.keepNext = props.keepNext;
  if (props.keepLines !== undefined) formatting.keepLines = props.keepLines;
  if (extra.outlineLevel !== undefined) {
    formatting.outlineLevel = extra.outlineLevel;
  }

  return Object.keys(formatting).length > 0 ? formatting : undefined;
}

/**
 * Authoring alignment, in the IR's vocabulary.
 *
 * Authoring says `justify`; OOXML calls the same thing `both`, which the IR
 * spells `justified`. Anything else an author writes falls back to left — the
 * rule the pipeline has always applied rather than rejecting the value.
 */
function compileAlignment(value: unknown): DocxIrAlignment | undefined {
  if (value === undefined || value === null) return undefined;
  switch (value) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'justify':
      return 'justified';
    default:
      return 'left';
  }
}

function compileSpacing(
  props: Record<string, any>,
  ctx: CompileContext
): DocxIrSpacing | undefined {
  const spacing: DocxIrSpacing = {};
  if (props.spacing?.before !== undefined) {
    spacing.beforeTwips = pointsToTwips(props.spacing.before);
  }
  if (props.spacing?.after !== undefined) {
    spacing.afterTwips = pointsToTwips(props.spacing.after);
  }

  // A paragraph carries line spacing inside `font`; a heading states it at the
  // top level. Both spellings are authoring surface, so both are read here.
  const lineSpacing = props.lineSpacing ?? (props.font ?? {}).lineSpacing;
  if (lineSpacing !== undefined) {
    const resolved = compileLineSpacing(lineSpacing);
    if (resolved) {
      if (resolved.lineTwips !== undefined)
        spacing.lineTwips = resolved.lineTwips;
      spacing.lineRule = resolved.lineRule;
    }
  }
  void ctx;

  return Object.keys(spacing).length > 0 ? spacing : undefined;
}

/**
 * Line spacing, in the two forms the authoring surface accepts.
 *
 * A bare number is a multiple of single spacing, which OOXML expresses as
 * 240ths; the named forms map onto the same field with a different rule.
 */
function compileLineSpacing(
  value: unknown
): { lineTwips?: number; lineRule: DocxIrSpacing['lineRule'] } | undefined {
  if (typeof value === 'number') {
    return { lineTwips: value * SINGLE_LINE_TWIPS, lineRule: 'auto' };
  }
  if (typeof value !== 'object' || value === null) return undefined;

  const { type, value: amount } = value as { type?: string; value?: number };
  // A type with no value still states its rule: `atLeast` with nothing to go
  // on means "at least whatever the style says", not "no line spacing".
  switch (type) {
    case 'single':
      return { lineTwips: SINGLE_LINE_TWIPS, lineRule: 'auto' };
    case 'double':
      return { lineTwips: 2 * SINGLE_LINE_TWIPS, lineRule: 'auto' };
    case 'atLeast':
      return {
        ...(amount !== undefined ? { lineTwips: pointsToTwips(amount) } : {}),
        lineRule: 'atLeast',
      };
    case 'exactly':
      return {
        ...(amount !== undefined ? { lineTwips: pointsToTwips(amount) } : {}),
        lineRule: 'exact',
      };
    case 'multiple':
      return {
        ...(amount !== undefined
          ? { lineTwips: amount * SINGLE_LINE_TWIPS }
          : {}),
        lineRule: 'auto',
      };
    default:
      return undefined;
  }
}

function paragraphStyleId(themeStyle: unknown): string | undefined {
  if (typeof themeStyle !== 'string' || !themeStyle) return undefined;
  const key = themeStyle.toLowerCase();
  if (key === 'normal') return 'Normal';
  if (key === 'title') return 'Title';
  if (key === 'subtitle') return 'Subtitle';
  const heading = /^heading([1-6])$/.exec(key);
  // A paragraph asking for a heading *look* gets the display-only clone, which
  // carries no outline level and so never enters a table of contents.
  if (heading) return `JTD_HeadingText${heading[1]}`;
  return themeStyle;
}

function customOutlineLevel(
  themeStyle: unknown,
  theme: ThemeConfig
): number | undefined {
  if (typeof themeStyle !== 'string' || !themeStyle) return undefined;
  if (/^heading[1-6]$/.test(themeStyle.toLowerCase())) return undefined;
  const style = (theme.styles as Record<string, unknown> | undefined)?.[
    themeStyle
  ];
  if (style && typeof style === 'object' && 'outlineLevel' in style) {
    return (style as { outlineLevel?: number }).outlineLevel;
  }
  return undefined;
}

function headingLevel(level: unknown): number {
  const value = typeof level === 'number' ? level : 1;
  return value >= 1 && value <= 6 ? value : 1;
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/** Image props this slice does not lower. */
const UNLOWERED_IMAGE_PROPS = ['comment'] as const;

/**
 * An image, and the caption paragraph that may follow it.
 *
 * The bytes were loaded before compilation started; what happens here is the
 * sizing — a width may be a percentage of the text column or of the page, and a
 * missing dimension is derived from the image's own aspect ratio.
 */
function compileImage(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  for (const prop of UNLOWERED_IMAGE_PROPS) {
    if (props[prop] !== undefined) {
      ctx.unsupported.push({ name: 'image', path, detail: prop });
      return [];
    }
  }

  const source = resolveImageSource(props);
  if (!source) {
    throw new Error(
      'Image component requires one of "path", "base64", or "svg" property'
    );
  }

  const loaded = ctx.images.get(source);
  if (!loaded) throw new Error(`Failed to load image from ${source}`);

  const mediaType = detectImageType(source, loaded.contentType);
  if (mediaType === 'svg') ctx.features.require('svg-images', path);

  if (typeof props.alt === 'string' && props.alt) {
    warnOnce(
      ctx,
      'image',
      `Alt text is not written to the document: the DOCX pipeline has never ` +
        `emitted \`wp:docPr\` descriptions, so the image at ${path} will have ` +
        `none. The text is preserved in the IR.`
    );
  }

  const size = imagePixelSize(props, loaded, ctx);
  const resourceId = declareResource(loaded, mediaType, ctx);

  const image: DocxIrImageRun = {
    kind: 'image',
    resourceId,
    widthEmu: pixelsToEmu(size.width),
    heightEmu: pixelsToEmu(size.height),
    ...(typeof props.alt === 'string' && props.alt
      ? { altText: props.alt }
      : {}),
    ...(props.floating
      ? { floating: compileFloating(props.floating, ctx, path) }
      : {}),
  };

  ctx.features.require('images', path);
  if (props.floating) ctx.features.require('floating-images', path);

  const spacing: DocxIrSpacing = {};
  if (props.spacing?.before !== undefined) {
    spacing.beforeTwips = pointsToTwips(props.spacing.before);
  }
  if (props.spacing?.after !== undefined) {
    spacing.afterTwips = pointsToTwips(props.spacing.after);
  }

  const blocks: DocxIrBlock[] = [
    {
      kind: 'paragraph',
      id: scope.id,
      path,
      children: [image],
      formatting: {
        // A floating image is anchored, so aligning its paragraph would move
        // the anchor rather than the picture.
        ...(props.floating
          ? {}
          : { alignment: compileAlignment(props.alignment) ?? 'center' }),
        ...(Object.keys(spacing).length > 0 ? { spacing } : {}),
        ...(props.keepNext !== undefined ? { keepNext: props.keepNext } : {}),
        ...(props.keepLines !== undefined
          ? { keepLines: props.keepLines }
          : {}),
      },
    },
  ];

  if (props.caption) {
    const caption = String(props.caption);
    const syntax = containsUnsupportedSyntax(caption);
    if (syntax) {
      ctx.unsupported.push({ name: 'image', path, detail: syntax });
      return [];
    }
    blocks.push({
      kind: 'paragraph',
      id: `${scope.id}:caption`,
      path: `${path}.caption`,
      styleId: 'Normal',
      // Captions default to left alignment, whatever the figure did.
      formatting: { alignment: 'left' },
      // A caption reaches the parser only when it carries a decorator, which
      // is why a link in an otherwise plain caption stays literal.
      children: DECORATED.test(caption)
        ? parseInline(caption, { base: {}, hyperlinks: true })
        : parseLiteral(caption, { base: {} }),
    });
  }

  return blocks;
}

/**
 * The frames of reference OOXML actually has, per axis.
 *
 * An author may name one OOXML cannot express — `text` vertically, say — and
 * the anchor then states no frame at all rather than an invented one, leaving
 * the backend to apply its own default.
 */
function relativeFrom(
  value: unknown,
  axis: 'horizontal' | 'vertical'
): string | undefined {
  const allowed =
    axis === 'horizontal'
      ? ['character', 'column', 'margin', 'page']
      : ['margin', 'page', 'paragraph', 'line'];
  return typeof value === 'string' && allowed.includes(value)
    ? value
    : undefined;
}

/** The alignments OOXML has, per axis. */
function alignValue(
  value: unknown,
  axis: 'horizontal' | 'vertical'
): string | undefined {
  const allowed =
    axis === 'horizontal'
      ? ['left', 'center', 'right', 'inside', 'outside']
      : ['top', 'center', 'bottom', 'inside', 'outside'];
  return typeof value === 'string' && allowed.includes(value)
    ? value
    : undefined;
}

/**
 * Authoring wrap types, in OOXML's vocabulary.
 *
 * `around` and `through` are VML spellings with no OOXML element of their own;
 * tight wrapping is the closest thing OOXML has, which is what they have always
 * produced.
 */
function wrapType(value: string): DocxIrTextWrap['type'] {
  switch (value) {
    case 'none':
      return 'none';
    case 'square':
      return 'square';
    case 'topAndBottom':
      return 'topAndBottom';
    case 'around':
    case 'through':
      return 'tight';
    default:
      return 'square';
  }
}

/**
 * The size the image is drawn at, in pixels.
 *
 * A width defaults to the full measure. Percentages resolve against the text
 * column, or the page when the author said so. Whichever dimension is left
 * unstated comes from the image's own proportions; when those cannot be read,
 * the pre-IR fallbacks stand in — 16:9, or a 7.36cm column.
 */
function imagePixelSize(
  props: Record<string, any>,
  loaded: LoadedImage,
  ctx: CompileContext
): { width: number; height: number } {
  const widthRef = props.widthRelativeTo === 'page' ? 'page' : 'content';
  const heightRef = props.heightRelativeTo === 'page' ? 'page' : 'content';
  const availableWidthPx = Math.round(
    twipsToPixels(
      widthRef === 'page'
        ? getPageWidthTwips(ctx.theme)
        : getAvailableWidthTwips(ctx.theme)
    )
  );
  const availableHeightPx = Math.round(
    twipsToPixels(
      heightRef === 'page'
        ? getPageHeightTwips(ctx.theme)
        : getAvailableHeightTwips(ctx.theme)
    )
  );

  const targetWidth = parseWidthValue(props.width ?? '100%', availableWidthPx);
  const targetHeight =
    props.height !== undefined
      ? parseDimensionValue(props.height, availableHeightPx)
      : undefined;

  if (loaded.intrinsic) {
    return calculateMissingDimension(
      loaded.intrinsic.width,
      loaded.intrinsic.height,
      targetWidth,
      targetHeight
    );
  }

  return fallbackSize(targetWidth, targetHeight, {
    width: FALLBACK_IMAGE_WIDTH_PX,
    height: FALLBACK_IMAGE_HEIGHT_PX,
  });
}

/**
 * The size to draw at when the image's own proportions cannot be read.
 *
 * One stated dimension implies the other at 16:9; neither leaves only the
 * caller's fallback box.
 */
function fallbackSize(
  targetWidth: number | undefined,
  targetHeight: number | undefined,
  fallback: { width: number; height: number }
): { width: number; height: number } {
  if (targetWidth && targetHeight) {
    return { width: targetWidth, height: targetHeight };
  }
  if (targetWidth) {
    return { width: targetWidth, height: Math.round((targetWidth * 9) / 16) };
  }
  if (targetHeight) {
    return { width: Math.round((targetHeight * 16) / 9), height: targetHeight };
  }
  return fallback;
}

/** 7.36cm at 96dpi — the column width the pipeline falls back to. */
const FALLBACK_IMAGE_WIDTH_PX = Math.round(7.36 * 37.795275591);
const FALLBACK_IMAGE_HEIGHT_PX = Math.round(FALLBACK_IMAGE_WIDTH_PX * 0.6);

/**
 * Register an image's bytes, reusing a resource with the same content.
 *
 * Identity is the hash, not the source: two components pointing at different
 * URLs that return the same bytes embed once.
 */
function declareResource(
  loaded: LoadedImage,
  mediaType: string,
  ctx: CompileContext
): string {
  const bytes = new Uint8Array(loaded.bytes);
  const sha256 = sha256Hex(bytes);
  const existing = ctx.resourcesByHash.get(sha256);
  if (existing) return existing;

  const id = `res${ctx.resources.length + 1}`;
  ctx.resources.push({
    id,
    kind: 'image',
    mediaType,
    bytes,
    byteLength: bytes.byteLength,
    sha256,
    ...(loaded.intrinsic
      ? {
          intrinsic: {
            widthPx: loaded.intrinsic.width,
            heightPx: loaded.intrinsic.height,
          },
        }
      : {}),
  });
  ctx.resourcesByHash.set(sha256, id);
  return id;
}

/**
 * Where a floating image sits, in EMU.
 *
 * Both axes are always stated: a drawing anchored on one axis only has no
 * defined position on the other, so the unstated one falls back to the top-left
 * of its natural container.
 */
function compileFloating(
  floating: Record<string, any>,
  ctx: CompileContext,
  path: string
): DocxIrFloating {
  if (floating.wrap?.type === 'tight') {
    throw new Error(
      "Image floating wrap.type 'tight' is not supported due to invalid OOXML emitted by docx. Use 'square', 'topAndBottom', or 'none'."
    );
  }

  const hRelative = floating.horizontalPosition?.relative;
  const vRelative = floating.verticalPosition?.relative;
  const hRef =
    hRelative && hRelative !== 'page'
      ? getAvailableWidthTwips(ctx.theme, ctx.themeName)
      : getPageWidthTwips(ctx.theme, ctx.themeName);
  const vRef =
    vRelative && vRelative !== 'page'
      ? getAvailableHeightTwips(ctx.theme, ctx.themeName)
      : getPageHeightTwips(ctx.theme, ctx.themeName);

  const hasHorizontal = Boolean(floating.horizontalPosition);
  const hasVertical = Boolean(floating.verticalPosition);

  const position = (
    stated: Record<string, any> | undefined,
    reference: number,
    axis: 'horizontal' | 'vertical',
    fallback: DocxIrFloatingPosition,
    present: boolean
  ): DocxIrFloatingPosition | undefined => {
    if (!stated) return present ? fallback : undefined;
    const relativeTo = relativeFrom(stated.relative, axis);
    const align = alignValue(stated.align, axis);
    return {
      ...(relativeTo ? { relativeTo } : {}),
      ...(align ? { align } : {}),
      ...(stated.offset !== undefined
        ? {
            offsetEmu: twipsToEmu(resolveOffsetTwips(stated.offset, reference)),
          }
        : {}),
    };
  };

  const pageWidth = getPageWidthTwips(ctx.theme, ctx.themeName);
  const pageHeight = getPageHeightTwips(ctx.theme, ctx.themeName);
  const rawMargins = floating.wrap?.margins ?? floating.margins;
  const margin = (value: unknown, reference: number): number | undefined =>
    value === undefined
      ? undefined
      : twipsToEmu(resolveOffsetTwips(value as number | string, reference));

  // OOXML reads `relativeHeight` as a positive integer, and a backend with no
  // value to use may derive one from the image height — which differs per
  // image and can invalidate the document. So it is always stated.
  let zIndex = floating.zIndex ?? 0;
  if (zIndex < 0) {
    warnOnce(
      ctx,
      'image',
      `Invalid zIndex value ${zIndex} for floating image at ${path}. Using 0 instead. zIndex must be >= 0.`
    );
    zIndex = 0;
  }

  const horizontal = position(
    floating.horizontalPosition,
    hRef,
    'horizontal',
    { relativeTo: 'margin', align: 'left' },
    hasVertical
  );
  const vertical = position(
    floating.verticalPosition,
    vRef,
    'vertical',
    { relativeTo: 'paragraph', align: 'top' },
    hasHorizontal
  );

  return {
    ...(horizontal ? { horizontal } : {}),
    ...(vertical ? { vertical } : {}),
    ...(floating.wrap
      ? {
          wrap: {
            ...(floating.wrap.type
              ? { type: wrapType(floating.wrap.type) }
              : {}),
            ...(floating.wrap.side ? { side: floating.wrap.side } : {}),
          } as DocxIrTextWrap,
        }
      : {}),
    ...(rawMargins
      ? {
          margins: {
            ...(margin(rawMargins.top, pageHeight) !== undefined
              ? { topEmu: margin(rawMargins.top, pageHeight)! }
              : {}),
            ...(margin(rawMargins.bottom, pageHeight) !== undefined
              ? { bottomEmu: margin(rawMargins.bottom, pageHeight)! }
              : {}),
            ...(margin(rawMargins.left, pageWidth) !== undefined
              ? { leftEmu: margin(rawMargins.left, pageWidth)! }
              : {}),
            ...(margin(rawMargins.right, pageWidth) !== undefined
              ? { rightEmu: margin(rawMargins.right, pageWidth)! }
              : {}),
          },
        }
      : {}),
    ...(floating.allowOverlap !== undefined
      ? { allowOverlap: floating.allowOverlap }
      : {}),
    ...(floating.behindDocument !== undefined
      ? { behindDocument: floating.behindDocument }
      : {}),
    ...(floating.lockAnchor !== undefined
      ? { lockAnchor: floating.lockAnchor }
      : {}),
    ...(floating.layoutInCell !== undefined
      ? { layoutInCell: floating.layoutInCell }
      : {}),
    zIndex,
  };
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

/**
 * A table.
 *
 * Every cascade — cell over column over table, per border side — and the column
 * grid come from `resolveTableModel`, which the pre-IR writer shares. What is
 * left here is turning each resolved cell into a paragraph and its runs.
 */
function compileTable(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const source = tableSource(props);

  if (source.columns.length === 0) {
    ctx.unsupported.push({ name: 'table', path, detail: 'no columns' });
    return [];
  }

  const style = getTableStyle(ctx.theme, ctx.themeName);
  const model = resolveTableModel<unknown, unknown, unknown>(
    source,
    ctx.theme,
    ctx.themeName,
    { onWarning: (_code, message) => warnOnce(ctx, 'table', message) }
  );

  if (model.overflow) {
    warnOnce(
      ctx,
      'table',
      `Column widths total (${model.overflow.totalTwips} twips) exceeds available table width (${model.overflow.availableTwips} twips). Table may overflow.`
    );
  }

  // A cell may carry an annotation or a nested component this slice does not
  // lower; refusing the whole table beats emitting one with a cell missing.
  const blocker = tableBlocker(model, path);
  if (blocker) {
    ctx.unsupported.push({ name: 'table', ...blocker });
    return [];
  }

  const rows: DocxIrTableRow[] = [
    compileTableRow(model.header, style.headerParagraph, style.tableHeader, {
      ctx,
      path: `${path}.header`,
      id: `${scope.id}:h`,
      // Headers repeat across page breaks unless the source disabled it.
      isHeader: model.repeatHeader,
    }),
    ...model.rows.map((row, index) =>
      compileTableRow(row, style.cellParagraph, style.tableCell, {
        ctx,
        path: `${path}.rows[${index}]`,
        id: `${scope.id}:r${index}`,
        ...(row.tableHeader !== undefined ? { isHeader: row.tableHeader } : {}),
        ...(row.cantSplit !== undefined ? { cantSplit: row.cantSplit } : {}),
      })
    ),
  ];

  ctx.features.require('tables', path);

  return [
    {
      kind: 'table',
      id: scope.id,
      path,
      rows,
      columnGrid: model.columnGrid,
      width:
        model.width.unit === 'twips'
          ? { kind: 'twips', value: model.width.size }
          : { kind: 'percent', value: model.width.size },
      // Fixed layout is what the pipeline has always produced.
      layout: 'fixed',
    },
  ];
}

/**
 * The table as the model wants it, whichever way the author wrote it.
 *
 * `headers`/`rows` is the original flat shape: a header row and a row of
 * strings each. It has no per-cell or per-column settings, so every cell is
 * given the same explicit defaults the flat shape has always rendered with.
 */
function tableSource(
  props: Record<string, any>
): TableSource<unknown, unknown, unknown> {
  if (!Array.isArray(props.headers) || !Array.isArray(props.rows)) {
    return { ...props, columns: props.columns ?? [] } as TableSource<
      unknown,
      unknown,
      unknown
    >;
  }

  const headers = props.headers as string[];
  const rows = props.rows as string[][];
  const cellDefaults = {
    color: '000000',
    backgroundColor: 'transparent',
    horizontalAlignment: 'left' as const,
    verticalAlignment: 'top' as const,
    font: {
      family: 'Arial',
      size: 11,
      bold: false,
      italic: false,
      underline: false,
    },
    borderColor: '000000',
    borderSize: 1,
  };

  return {
    borderColor: '000000',
    borderSize: 1,
    cellDefaults,
    width: 100,
    columns: headers.map((header, colIndex) => ({
      cellDefaults: { ...cellDefaults },
      header: { ...cellDefaults, content: header },
      cells: rows.map((row) => ({
        ...cellDefaults,
        content: row[colIndex] || '',
      })),
    })),
  };
}

/** The first thing about this table the slice cannot lower, if any. */
function tableBlocker(
  model: ResolvedTable<unknown, unknown, unknown>,
  path: string
): { path: string; detail: string } | undefined {
  const rows = [model.header, ...model.rows];
  for (const [rowIndex, row] of rows.entries()) {
    const rowPath = row.isHeader
      ? `${path}.header`
      : `${path}.rows[${rowIndex - 1}]`;
    if (row.revision !== undefined) {
      return { path: rowPath, detail: 'revision' };
    }
    for (const [colIndex, cell] of row.cells.entries()) {
      const cellPath = `${rowPath}.cells[${colIndex}]`;
      if (cell.comment !== undefined)
        return { path: cellPath, detail: 'comment' };
      if (cell.revision !== undefined)
        return { path: cellPath, detail: 'revision' };
      const content = cell.content;
      if (content === undefined || typeof content === 'string') {
        if (content && containsUnsupportedSyntax(content)) {
          return {
            path: cellPath,
            detail: containsUnsupportedSyntax(content)!,
          };
        }
        continue;
      }
      if (content.name !== 'paragraph') {
        return { path: cellPath, detail: content.name };
      }
      const text = String((content.props as { text?: unknown })?.text ?? '');
      const syntax = containsUnsupportedSyntax(text);
      if (syntax) return { path: cellPath, detail: syntax };
      if ((content.props as { revision?: unknown })?.revision !== undefined) {
        return { path: cellPath, detail: 'revision' };
      }
    }
  }
  return undefined;
}

/** Base run style for a cell, from the theme's table styles. */
type TableBaseStyle = ReturnType<typeof getTableStyle>['tableCell'] & {
  bold?: boolean;
};

function compileTableRow(
  row: ResolvedRow<unknown, unknown, unknown>,
  spacing: ReturnType<typeof getTableStyle>['cellParagraph'],
  baseStyle: TableBaseStyle,
  scope: ComponentScope & { isHeader?: boolean; cantSplit?: boolean }
): DocxIrTableRow {
  return {
    cells: row.cells.map((cell, colIndex) =>
      compileTableCell(cell, spacing, baseStyle, row.keepNext, {
        ctx: scope.ctx,
        path: `${scope.path}.cells[${colIndex}]`,
        id: `${scope.id}:c${colIndex}`,
      })
    ),
    ...(row.height !== undefined
      ? {
          heightTwips: pointsToTwips(row.height),
          heightRule: 'atLeast' as const,
        }
      : {}),
    ...(scope.isHeader !== undefined ? { isHeader: scope.isHeader } : {}),
    ...(scope.cantSplit !== undefined ? { cantSplit: scope.cantSplit } : {}),
  };
}

function compileTableCell(
  cell: ResolvedCell<unknown, unknown>,
  spacing: ReturnType<typeof getTableStyle>['cellParagraph'],
  baseStyle: TableBaseStyle,
  keepNext: boolean,
  scope: ComponentScope
): DocxIrTableCell {
  const paragraph: DocxIrParagraph = {
    kind: 'paragraph',
    id: scope.id,
    path: scope.path,
    // A cell paragraph names no style: it takes its run properties from the
    // cell, not from Normal, so naming one would layer body-prose spacing back
    // on top of the dense table spacing.
    children:
      cell.missing || cellText(cell) === undefined
        ? []
        : parseInline(cellText(cell)!, {
            base: cellRunFormatting(cell, baseStyle, scope.ctx),
            hyperlinks: true,
          }),
    formatting: {
      alignment: cell.missing
        ? 'left'
        : compileAlignment(cell.horizontalAlignment)!,
      spacing: {
        beforeTwips: spacing.before,
        afterTwips: spacing.after,
        ...(spacing.line !== undefined
          ? { lineTwips: spacing.line, lineRule: lineRule(spacing.lineRule) }
          : {}),
      },
      ...(keepNext ? { keepNext: true } : {}),
    },
  };

  return {
    children: [paragraph],
    ...(cell.missing
      ? {}
      : {
          verticalAlign: verticalAlign(cell.verticalAlignment),
          ...(cell.backgroundColor !== undefined &&
          cell.backgroundColor !== 'transparent'
            ? { shading: { fill: { hex: cell.backgroundColor } } }
            : {}),
          ...(cell.padding
            ? {
                margins: {
                  topTwips: pointsToTwips(cell.padding.top),
                  bottomTwips: pointsToTwips(cell.padding.bottom),
                  leftTwips: pointsToTwips(cell.padding.left),
                  rightTwips: pointsToTwips(cell.padding.right),
                },
              }
            : {}),
        }),
    borders: {
      top: compileTableBorder(cell.borders.top),
      bottom: compileTableBorder(cell.borders.bottom),
      left: compileTableBorder(cell.borders.left),
      right: compileTableBorder(cell.borders.right),
    },
  };
}

/**
 * The text a cell renders.
 *
 * A cell holding a `paragraph` renders that paragraph's text; a cell holding
 * nothing renders nothing at all, which is not the same as rendering an empty
 * string — an empty string still produces a run.
 */
function cellText(cell: ResolvedCell<unknown, unknown>): string | undefined {
  const content = cell.content;
  if (content === undefined || content === '') return undefined;
  if (typeof content === 'string') return content;
  return String((content.props as { text?: unknown })?.text ?? '');
}

/**
 * The run formatting a cell's text starts from.
 *
 * The cell's own font wins over the theme's table style, and a numeric weight
 * resolves to the synthesized family alias exactly as it does in body text.
 */
function cellRunFormatting(
  cell: ResolvedCell<unknown, unknown>,
  baseStyle: TableBaseStyle,
  ctx: CompileContext
): DocxIrRunFormatting {
  const content = cell.content;
  const componentFont =
    content !== undefined && typeof content !== 'string'
      ? (content.props as { font?: Record<string, any> })?.font ?? undefined
      : undefined;

  const weighted = applyFontWeightAlias({
    fontFamily: cell.font?.family || baseStyle.font,
    bold: cell.font?.bold ?? false,
    italic: cell.font?.italic ?? false,
    fontWeight: cell.font?.fontWeight,
  });

  const formatting: DocxIrRunFormatting = {
    ...(weighted.font ? { fontFamily: weighted.font } : {}),
    sizeHalfPoints: cell.font?.size ? cell.font.size * 2 : baseStyle.size,
    bold: weighted.bold ?? false,
    italic: weighted.italic ?? false,
    ...(cell.font?.underline ? { underline: { type: 'single' } } : {}),
    ...(cell.color || baseStyle.color
      ? { color: irColor(cell.color || baseStyle.color) }
      : {}),
  };

  if (!componentFont) return formatting;

  // A paragraph component inside the cell layers its own font on top.
  const paraWeighted = applyFontWeightAlias({
    fontFamily: componentFont.family ?? formatting.fontFamily,
    bold: componentFont.bold,
    italic: componentFont.italic,
    fontWeight: componentFont.fontWeight,
  });

  return {
    ...formatting,
    ...(paraWeighted.font ? { fontFamily: paraWeighted.font } : {}),
    ...(componentFont.size ? { sizeHalfPoints: componentFont.size * 2 } : {}),
    ...(paraWeighted.bold !== undefined ? { bold: paraWeighted.bold } : {}),
    ...(paraWeighted.italic !== undefined
      ? { italic: paraWeighted.italic }
      : {}),
    ...(componentFont.underline !== undefined
      ? {
          underline: componentFont.underline
            ? { type: 'single' as const }
            : undefined,
        }
      : {}),
    ...(componentFont.color
      ? { color: irColor(resolveColor(componentFont.color, ctx.theme)) }
      : {}),
  };
}

/**
 * One side of a cell border.
 *
 * A zero size and a hidden side are the same thing to OOXML — `none` — and the
 * distinction between them is only meaningful to the author.
 */
function compileTableBorder(border: ResolvedBorder): DocxIrBorder {
  if (border.size === 0 || border.hidden) {
    return { style: 'none', sizeEighthPoints: 0, color: { hex: '000000' } };
  }
  return {
    style: 'single',
    sizeEighthPoints: pointsToEighthPoints(border.size),
    color: irColor(border.color || '000000'),
  };
}

function verticalAlign(
  value: 'top' | 'middle' | 'bottom'
): DocxIrVerticalAlign {
  return value === 'middle' ? 'center' : value;
}

/** The theme's line rule, in the IR's vocabulary. */
function lineRule(value: unknown): DocxIrSpacing['lineRule'] {
  if (value === 'exactly' || value === 'exact') return 'exact';
  if (value === 'atLeast') return 'atLeast';
  return 'auto';
}

/** Collect a warning at most once per compilation, keyed by its message. */
function warnOnce(
  ctx: CompileContext,
  component: string,
  message: string
): void {
  if (ctx.warnedMessages.has(message)) return;
  ctx.warnedMessages.add(message);
  ctx.warnings.push({ component, message });
}

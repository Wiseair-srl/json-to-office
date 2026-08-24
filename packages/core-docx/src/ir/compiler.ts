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
import {
  synthesizeFamilyName,
  DEFAULT_CHART_THEME_COLORS,
} from '@json-to-office/shared';
import type { LayoutPlan, SectionLayout } from '../core/layout';
import type { ProcessedDocument } from '../core/structure';
import type { ComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import { resolveColor } from '../styles/utils/colorUtils';
import {
  isNativeVisualProps,
  type VisualNativeProps,
  type VisualProps,
} from '@json-to-office/shared-docx';
import {
  compileNativeVisualGroup,
  type NativeVisualDeps,
} from './nativeVisual';
import { createDocumentStyles } from '../styles/themeToStyles';
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
import {
  DEFAULT_REVISION_AUTHOR,
  DEFAULT_REVISION_DATE,
} from '../utils/revisionUtils';
import {
  DEFAULT_COMMENT_AUTHOR,
  DEFAULT_COMMENT_DATE,
} from '../utils/commentRegistry';
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
  relativeLengthToTwips,
  resolveOffsetTwips,
} from '../utils/widthUtils';
import {
  HEADING_NUMBERING_REFERENCE,
  type ListLevelConfig,
  type ListMarkerFontConfig,
} from '../utils/numberingConfig';
import { normalizeUnicodeText } from '../utils/unicode';
import {
  collectDocumentOutline,
  type NumberedItemInfo,
  type TocHeadingEntry,
} from '../core/collectTocHeadings';
import { resolveTocField } from '../core/tocField';
import { parseMarkdownList } from '../core/markdownList';
import {
  containsCrossReference,
  containsLink,
  containsPlaceholder,
  containsUnsupportedSyntax,
  parseInline,
  parseLiteral,
  type CrossReferenceFormat,
  type PlaceholderResolution,
} from './inline';
import type { DocxFeature } from './features';
import {
  DOCX_IR_SCHEMA_VERSION,
  type DocxIR,
  type DocxIrAlignment,
  type DocxIrBlock,
  type DocxIrBorder,
  type DocxIrBorders,
  type DocxIrColor,
  type DocxIrComment,
  type DocxIrDrawingGroupRun,
  type DocxIrNote,
  type DocxIrFloating,
  type DocxIrFloatingPosition,
  type DocxIrFrame,
  type DocxIrHeaderFooter,
  type DocxIrImageRun,
  type DocxIrChartRun,
  type DocxIrChartSeries,
  type DocxIrChartType,
  type DocxIrChartLegendPosition,
  type DocxIrInline,
  type DocxIrNumbering,
  type DocxIrNumberingLevel,
  type DocxIrParagraph,
  type DocxIrParagraphFormatting,
  type DocxIrParagraphMarkRevision,
  type DocxIrResource,
  type DocxIrRunFormatting,
  type DocxIrSection,
  type DocxIrSectionProperties,
  type DocxIrSpacing,
  type DocxIrTableCell,
  type DocxIrTableFloating,
  type DocxIrTableWidth,
  type DocxIrTableRow,
  type DocxIrTextWrap,
  type DocxIrVerticalAlign,
} from './types';
import {
  blockId,
  emuToPixels,
  headerFooterBlockId,
  inchesToEmu,
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
  /**
   * Counter behind the generated `list-1`, `markdown-list-2`, … references.
   *
   * One counter for both kinds: they share a namespace, so a document that
   * mixes them must not produce two definitions with the same name.
   */
  listCounter: number;
  /** Warning messages already collected, so one bad value warns once. */
  warnedMessages: Set<string>;
  /** Echo warnings to the console, because the caller collects none itself. */
  echoWarnings: boolean;
  /**
   * Ids for `w:ins` / `w:del`, allocated in document order.
   *
   * OOXML wants a number on every tracked change, unique within the document;
   * allocating them here rather than while rendering is what keeps two
   * compilations of the same document identical.
   */
  nextRevisionId: number;
  /** Comment bodies, in id order, with the ids their anchors carry. */
  comments: DocxIrComment[];
  /** Note bodies, in the order their markers resolved. */
  footnotes: DocxIrNote[];
  endnotes: DocxIrNote[];
  commentCounter: number;
  /** Whether anything in this document asked for a resolved state. */
  hasResolvedComment: boolean;
  /**
   * Cross-reference targets, from the document-outline pre-pass.
   *
   * A `[@id]` may point forward, so nothing but a walk of the whole document
   * can resolve it — which is why it is computed once, before compiling.
   */
  numberedItems: ReadonlyMap<string, NumberedItemInfo>;
  /** Every heading and mapped-style paragraph, for a TOC's cached entries. */
  tocEntries: readonly TocHeadingEntry[];
  /** Image bytes, loaded before compilation started. */
  images: ImageResources;
  /**
   * When this document was generated.
   *
   * A `{DATE}` placeholder resolves against it here rather than at render
   * time, so the document says when it was made and two compilations of the
   * same document agree.
   */
  generatedAt: Date;
}

export function compileDocument(
  structure: ProcessedDocument,
  layout: LayoutPlan,
  warnings: GenerationWarning[] = [],
  images: ImageResources = new Map(),
  options: { echoWarnings?: boolean } = {}
): DocxCompileResult {
  const styles = createDocumentStyles(structure.theme, structure.language);
  // Walk the outline before compiling so a cross-reference can resolve a target
  // that appears later in the document, and a TOC field can carry cached
  // entries. Same catch-and-degrade discipline as the pre-IR path: a failure
  // here costs the cached values, never the document.
  const outline = collectOutline(layout, warnings);
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
    echoWarnings: options.echoWarnings === true,
    nextRevisionId: 1,
    comments: [],
    footnotes: [],
    endnotes: [],
    commentCounter: 0,
    hasResolvedComment: false,
    numberedItems: outline.numberedItems,
    tocEntries: outline.entries,
    images,
    generatedAt: structure.metadata.date,
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

  // A resolved flag lives in `word/commentsExtended.xml`, which is written only
  // for threaded comments. A document whose only resolved comment has no
  // replies would lose that state, so say so rather than dropping it quietly.
  if (
    ctx.hasResolvedComment &&
    !ctx.comments.some((comment) => comment.parentId !== undefined)
  ) {
    warnOnce(
      ctx,
      'comment',
      'A comment sets `resolved` but the document has no replies. Word stores ' +
        'the resolved flag in commentsExtended.xml, which is written only for ' +
        'threaded comments, so the flag will not survive.'
    );
  }

  const metadata = compileMetadata(structure);
  // `docProps/custom.xml` is a part of its own, and a backend that does not
  // write it would drop the properties without saying so.
  if (metadata.custom?.length) {
    ctx.features.require('custom-properties', 'metadata.custom');
  }

  const ir: DocxIR = {
    schemaVersion: DOCX_IR_SCHEMA_VERSION,
    metadata,
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
    comments: ctx.comments,
    footnotes: ctx.footnotes,
    endnotes: ctx.endnotes,
  };

  return {
    ir,
    required: ctx.features.list(),
    warnings: ctx.warnings,
    unsupported: ctx.unsupported,
  };
}

/**
 * The document outline, or an empty one if the walk fails.
 *
 * A failure here costs the cached cross-reference values and the TOC entries,
 * never the document itself — a reader that refreshes fields still sees the
 * right numbers.
 */
function collectOutline(
  layout: LayoutPlan,
  warnings: GenerationWarning[]
): ReturnType<typeof collectDocumentOutline> {
  try {
    return collectDocumentOutline(layout.sections);
  } catch (error) {
    warnings.push({
      component: 'document',
      message:
        '[core-docx] Document outline collection failed; the TOC field will rely on the reader refreshing it: ' +
        (error instanceof Error ? error.message : String(error)),
    });
    return { entries: [], numberedItems: new Map() };
  }
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
  // Every layout chunk of one user-defined section resolves to the same
  // bookmark, which is what a section-scoped table of contents restricts to.
  const sectionBookmarkName =
    section.belongsToUserSection && ordinal.ordinal !== undefined
      ? `_Section_${ordinal.ordinal}`
      : undefined;

  section.components.forEach((component, i) => {
    if ('enabled' in component && component.enabled === false) return;
    children.push(
      ...compileComponent(component, {
        ctx,
        path: `${path}.children[${i}]`,
        id: blockId(index, [i]),
        ...(sectionBookmarkName ? { sectionBookmarkName } : {}),
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
  // previous section — and disabling every component in one is the same
  // statement said differently: the author supplied chrome for this section and
  // asked for none of it. Only *active* content that compiles to nothing falls
  // back to inheritance, because that is a lowering gap rather than an
  // instruction, and inheriting is the older behaviour.
  if (children.length === 0 && active.length > 0) return undefined;

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
  /**
   * The bookmark covering the section this component sits in, if any.
   *
   * A table of contents scoped to its own section needs it; nothing else does.
   */
  sectionBookmarkName?: string;
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
    case 'toc':
      return compileToc(component, scope);
    case 'text-box':
      return compileTextBox(component, scope);
    case 'columns':
      return compileColumns(component, scope);
    case 'image':
      return compileImage(component, scope);
    case 'visual':
      return compileVisual(component, scope);
    case 'chart':
      return compileChart(component, scope);
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

/**
 * The levels a markdown list always defines.
 *
 * Three of them, whatever depth the text actually reaches: the syntax has no
 * way to declare its own numbering, so the definition is fixed.
 */
const MARKDOWN_LIST_LEVELS: Readonly<Record<string, ListLevelConfig[]>> = {
  unordered: [
    { level: 0, format: 'bullet', text: '•', alignment: 'left' },
    { level: 1, format: 'bullet', text: '◦', alignment: 'left' },
    { level: 2, format: 'bullet', text: '▪', alignment: 'left' },
  ],
  ordered: [
    { level: 0, format: 'decimal', text: '%1.', alignment: 'left' },
    { level: 1, format: 'lowerLetter', text: '%2.', alignment: 'left' },
    { level: 2, format: 'lowerRoman', text: '%3.', alignment: 'left' },
  ],
};

/**
 * Markdown decorators.
 *
 * A heading reaches the inline parser only when its text carries one of these
 * or a cross-reference; anything else is rendered character for character.
 */
const DECORATED = /(\*\*\*|___|(\*\*|__)|(\*|_))/;

function compileParagraph(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const text = String(props.text ?? '');

  if (reportUnlowered(component, props, text, scope)) return [];

  // A paragraph whose whole text is a markdown list is a list, and has always
  // rendered as one. A revision paragraph never is: its segments carry literal
  // text and cannot be re-split into items.
  const markdown = props.revision ? null : parseMarkdownList(text);
  if (markdown) {
    return compileList(
      {
        ...component,
        props: {
          items: markdown.items,
          ...(props.spacing ? { spacing: props.spacing } : {}),
          ...(props.alignment ? { alignment: props.alignment } : {}),
          ...(props.comment ? { comment: props.comment } : {}),
          ...(props.footnotes ? { footnotes: props.footnotes } : {}),
          ...(props.endnotes ? { endnotes: props.endnotes } : {}),
        },
      } as ComponentDefinition,
      scope,
      'markdown-list',
      MARKDOWN_LIST_LEVELS[markdown.type]
    );
  }

  const styleId = paragraphStyleId(props.themeStyle);
  if (styleId && !ctx.styleIds.has(styleId)) ctx.styleIds.add(styleId);

  const children = compileRuns(props, text, ctx, path);
  // A paragraph is a bookmark target only when the author asked for one, and
  // the id is a prop — unlike a heading, whose id sits on the component.
  const bookmarkName = typeof props.id === 'string' ? props.id : undefined;

  return [
    paragraphNode(scope, children, {
      ...(styleId ? { styleId } : {}),
      ...(props.floating
        ? { frame: compileFrame(props.floating, ctx, path) }
        : {}),
      formatting: paragraphFormatting(props, ctx, {
        outlineLevel: customOutlineLevel(props.themeStyle, ctx.theme),
        // A paragraph always states its spacing, even when empty, so a
        // paragraph with none is distinguishable from a heading, which
        // deliberately leaves its style's spacing alone.
        alwaysSpacing: true,
      }),
      bookmarkName,
      ...(props.comment
        ? { commentIds: declareComment(props.comment, ctx, path) }
        : {}),
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
    DECORATED.test(text) || containsCrossReference(text) ? 'inline' : 'literal'
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
      ...(props.comment
        ? { commentIds: declareComment(props.comment, ctx, path) }
        : {}),
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
 * Text boxes
 * ------------------------------------------------------------------ */

/**
 * Columns nested inside a text box, as a one-row table.
 *
 * At the top level a `columns` component becomes a section with a real column
 * layout, and the layout stage has already unwrapped it by the time the
 * compiler runs. Inside a text box there is no section to give, so the columns
 * become cells: children are dealt round-robin across them, and the gap between
 * two columns is split as a margin on each side of the boundary.
 */
function compileColumns(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;
  const configs = columnConfigs(props.columns);
  if (configs.length === 0) return [];

  const available = getAvailableWidthTwips(ctx.theme, ctx.themeName);
  const { widths, gaps } = columnMetrics(configs, props.gap, available);

  // Round-robin: the only distribution available without measuring text, and
  // the one this has always used.
  const contents: ComponentDefinition[][] = configs.map(() => []);
  const children =
    (component as { children?: ComponentDefinition[] }).children ?? [];
  children.forEach((child, index) => {
    contents[index % configs.length].push(child);
  });

  ctx.features.require('tables', path);

  return [
    {
      kind: 'table',
      id: scope.id,
      path,
      columnGrid: { unit: 'twips', values: [] },
      width: { kind: 'percent', value: 100 },
      layout: 'fixed',
      borders: NO_BORDERS,
      rows: [
        {
          cells: configs.map((_, index) => {
            const blocks = contents[index].flatMap((child, childIndex) =>
              compileComponent(child, {
                ...scope,
                path: `${path}.children[${index}][${childIndex}]`,
                id: `${scope.id}:c${index}:${childIndex}`,
              })
            );
            return {
              // An empty column is still a column: it needs a paragraph or the
              // cell has no content at all.
              children: blocks.length
                ? blocks
                : [
                    {
                      kind: 'paragraph' as const,
                      id: `${scope.id}:c${index}:empty`,
                      path: `${path}.children[${index}][0]`,
                      children: [],
                    },
                  ],
              widthTwips: widths[index],
              margins: {
                topTwips: 0,
                rightTwips: gaps[index] / 2,
                bottomTwips: 0,
                leftTwips: index > 0 ? gaps[index - 1] / 2 : 0,
              },
              verticalAlign: 'top' as const,
              borders: {
                top: NO_BORDERS.top,
                right: NO_BORDERS.right,
                bottom: NO_BORDERS.bottom,
                left: NO_BORDERS.left,
              },
            };
          }),
        },
      ],
    },
  ];
}

/** A column count or an explicit list, as a list either way. */
function columnConfigs(
  columns: unknown
): Array<{ width?: number | string; gap?: number | string }> {
  if (typeof columns === 'number') {
    return Array.from({ length: columns }, () => ({ width: 'auto' as const }));
  }
  return Array.isArray(columns) ? columns : [];
}

/**
 * Column widths and the gaps between them, in twips.
 *
 * Stated widths are taken as written; whatever the page has left over after
 * them and the gaps is split evenly between the columns that stated none.
 */
function columnMetrics(
  configs: Array<{ width?: number | string; gap?: number | string }>,
  defaultGap: number | string | undefined,
  available: number
): { widths: number[]; gaps: number[] } {
  const widths: number[] = [];
  const gaps: number[] = [];
  const autoIndexes: number[] = [];
  let stated = 0;
  let totalGaps = 0;

  configs.forEach((column, index) => {
    if (column.width === undefined || column.width === 'auto') {
      autoIndexes.push(index);
      widths.push(0);
    } else {
      const width = relativeLengthToTwips(column.width, available);
      widths.push(width);
      stated += width;
    }

    if (index < configs.length - 1) {
      // Half an inch between columns unless something says otherwise.
      const gap =
        column.gap !== undefined
          ? relativeLengthToTwips(column.gap, available)
          : defaultGap !== undefined
            ? relativeLengthToTwips(defaultGap, available)
            : 720;
      gaps.push(gap);
      totalGaps += gap;
    } else {
      gaps.push(0);
    }
  });

  if (autoIndexes.length > 0) {
    const share = Math.floor(
      Math.max(0, available - stated - totalGaps) / autoIndexes.length
    );
    for (const index of autoIndexes) widths[index] = share;
  }

  return { widths, gaps };
}

/** 1px at 96 DPI in twips — 1440 twips per inch over 96 pixels per inch. */
const TWIPS_PER_PIXEL = 15;

/** ~333px, the width a floating text box takes when it states none. */
const DEFAULT_TEXT_BOX_WIDTH_TWIPS = 5000;

/**
 * A text box: a borderless one-cell table holding its children.
 *
 * A table rather than a shape because that is the only rendering with autofit,
 * per-side borders and a width that stays a percentage — a shape freezes all
 * three at generation time. `renderAs: 'shape'` asks for the other one.
 */
function compileTextBox(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  const children: DocxIrBlock[] = [];
  const contents =
    (component as { children?: ComponentDefinition[] }).children ?? [];
  contents.forEach((child, index) => {
    children.push(
      ...compileComponent(child, {
        ...scope,
        path: `${path}.children[${index}]`,
        id: `${scope.id}:c${index}`,
      })
    );
  });

  const style = props.style as Record<string, any> | undefined;
  const padding = style?.padding as Record<string, number> | undefined;

  if (props.renderAs === 'shape') {
    const shape = compileShape(props, children, scope);
    if (shape) return shape;
    // Everything a shape cannot express falls back to the table below, rather
    // than shipping a box that clips its content or redraws its border.
  }

  ctx.features.require('tables', path);
  if (props.floating) ctx.features.require('floating-tables', path);

  return [
    {
      kind: 'table',
      id: scope.id,
      path,
      // No grid: one cell, whose width the table itself decides.
      columnGrid: { unit: 'twips', values: [] },
      width: textBoxWidth(props),
      layout: 'fixed',
      // The container is invisible; whatever border the author asked for is
      // drawn by the cell inside it.
      borders: NO_BORDERS,
      ...(props.floating
        ? { floating: compileTableFloat(props.floating, ctx) }
        : {}),
      rows: [
        {
          cells: [
            {
              // A cell with nothing in it still needs a paragraph, or the row
              // has no content at all and Word rejects the table.
              children: children.length
                ? children
                : [
                    {
                      kind: 'paragraph',
                      id: `${scope.id}:empty`,
                      path: `${path}.children[0]`,
                      children: [],
                    },
                  ],
              margins: {
                topTwips: padding?.top ? pointsToTwips(padding.top) : 0,
                rightTwips: padding?.right ? pointsToTwips(padding.right) : 0,
                bottomTwips: padding?.bottom
                  ? pointsToTwips(padding.bottom)
                  : 0,
                leftTwips: padding?.left ? pointsToTwips(padding.left) : 0,
              },
              ...(style?.shading?.fill
                ? {
                    shading: {
                      fill: irColor(
                        resolveColor(style.shading.fill, ctx.theme)
                      ),
                    },
                  }
                : {}),
              ...(compileBorders(style?.border, ctx)
                ? { borders: compileBorders(style?.border, ctx)! }
                : {}),
            },
          ],
        },
      ],
    },
  ];
}

/** 1px at 96 DPI in EMU — 914400 EMU per inch over 96 pixels per inch. */
const EMU_PER_PIXEL = 9525;

/**
 * A text box as a native Word shape, or nothing when it cannot be one.
 *
 * A shape has no autofit, one uniform outline and no dash patterns, so a text
 * box that needs any of those is better served by the table rendering. Each
 * refusal says why: the author asked for something the shape cannot draw, and
 * silently drawing something else would change the design.
 */
function compileShape(
  props: Record<string, any>,
  children: DocxIrBlock[],
  scope: ComponentScope
): DocxIrBlock[] | undefined {
  const { ctx, path } = scope;
  const width = shapeSize(props.width, 'width', ctx);
  const height = shapeSize(props.height, 'height', ctx);

  if (width.pixels === undefined || height.pixels === undefined) {
    warnOnce(
      ctx,
      'text-box',
      '[core-docx] text-box renderAs "shape" needs an explicit width and height (a shape has no autofit); falling back to table rendering.'
    );
    return undefined;
  }

  const style = props.style as Record<string, any> | undefined;
  const outline = shapeOutline(style, ctx);
  if (outline.unsupportedStyles.length > 0) {
    warnOnce(
      ctx,
      'text-box',
      `[core-docx] text-box renderAs "shape" cannot draw a ${outline.unsupportedStyles.join('/')} border (a shape outline has no dash pattern); falling back to table rendering, which draws it.`
    );
    return undefined;
  }

  // A shape holds paragraphs and nothing else: a nested `columns` renders as a
  // table, which has nowhere to go inside one.
  if (children.some((child) => child.kind !== 'paragraph')) {
    warnOnce(
      ctx,
      'text-box',
      '[core-docx] text-box renderAs "shape" requires paragraph-only content; falling back to table rendering.'
    );
    return undefined;
  }

  if (width.resolvedPercentage || height.resolvedPercentage) {
    warnOnce(
      ctx,
      'text-box',
      '[core-docx] text-box renderAs "shape" resolves percentage sizes at generation time, against the current page content box; the shape will not reflow if the page size changes.'
    );
  }
  if (outline.ignoredSides.length > 0) {
    warnOnce(
      ctx,
      'text-box',
      `[core-docx] text-box renderAs "shape" has one uniform outline; using the first declared border side and ignoring ${outline.ignoredSides.join(', ')}.`
    );
  }

  // A shape cannot carry both: the two fill groups come out in the wrong order
  // for CT_ShapeProperties and Word rejects the document. The fill wins.
  const fill = style?.shading?.fill as string | undefined;
  const dropOutline = Boolean(fill) && Boolean(outline.outline);
  if (dropOutline) {
    warnOnce(
      ctx,
      'text-box',
      '[core-docx] text-box renderAs "shape" cannot carry a fill and a border at once (docx emits invalid shape properties); keeping the fill and dropping the border.'
    );
  }

  ctx.features.require('text-boxes', path);
  if (props.floating) ctx.features.require('floating-images', path);

  const insets = shapeInsets(
    style?.padding as Record<string, number> | undefined
  );

  return [
    {
      kind: 'paragraph',
      id: scope.id,
      path,
      formatting: { spacing: { beforeTwips: 0, afterTwips: 0 } },
      children: [
        {
          kind: 'shape',
          widthPx: width.pixels,
          heightPx: height.pixels,
          children: children as DocxIrParagraph[],
          ...(fill ? { fill: irColor(resolveColor(fill, ctx.theme)) } : {}),
          ...(outline.outline && !dropOutline
            ? { outline: outline.outline }
            : {}),
          ...(insets ? { insetsEmu: insets } : {}),
          ...(props.floating
            ? { floating: compileFloating(props.floating, ctx, path) }
            : {}),
        },
      ],
    },
  ];
}

/**
 * A shape's `width`/`height`, in whole pixels.
 *
 * A shape carries an absolute size in the file, so a percentage cannot stay
 * lazy the way a table's `w:tblW` can: it is resolved against the page's
 * content box and frozen here.
 */
function shapeSize(
  value: unknown,
  axis: 'width' | 'height',
  ctx: CompileContext
): { pixels?: number; resolvedPercentage: boolean } {
  if (typeof value === 'number') {
    return { pixels: Math.round(value), resolvedPercentage: false };
  }
  if (typeof value !== 'string') return { resolvedPercentage: false };

  const fraction = parseFloat(value) / 100;
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return { resolvedPercentage: false };
  }
  const availableTwips =
    axis === 'width'
      ? getAvailableWidthTwips(ctx.theme, ctx.themeName)
      : getAvailableHeightTwips(ctx.theme, ctx.themeName);
  return {
    pixels: Math.round((availableTwips * fraction) / TWIPS_PER_PIXEL),
    resolvedPercentage: true,
  };
}

/**
 * The per-side border config collapsed into the single outline a shape has.
 *
 * Sides are read in top/left/bottom/right order; when they disagree, the first
 * one wins and the caller is told which were dropped. A dash pattern has no
 * DrawingML equivalent at all, so it is reported instead of flattened.
 */
function shapeOutline(
  style: Record<string, any> | undefined,
  ctx: CompileContext
): {
  outline?: { color: DocxIrColor; widthEmu?: number };
  ignoredSides: string[];
  unsupportedStyles: string[];
} {
  const border = style?.border as Record<string, any> | undefined;
  if (!border) return { ignoredSides: [], unsupportedStyles: [] };

  const declared = (['top', 'left', 'bottom', 'right'] as const)
    .map((side) => [side, border[side]] as const)
    .filter((entry) => Boolean(entry[1]));
  if (declared.length === 0) return { ignoredSides: [], unsupportedStyles: [] };

  const unsupportedStyles = [
    ...new Set(
      declared
        .map(([, config]) => config.style)
        .filter(
          (value) =>
            value === 'dashed' || value === 'dotted' || value === 'double'
        )
    ),
  ] as string[];
  if (unsupportedStyles.length > 0) {
    return { ignoredSides: [], unsupportedStyles };
  }

  const [, used] = declared[0];
  const ignoredSides = declared
    .slice(1)
    .filter(
      ([, config]) =>
        config.style !== used.style ||
        config.width !== used.width ||
        config.color !== used.color
    )
    .map(([side]) => side as string);

  if (used.style === 'none') return { ignoredSides, unsupportedStyles };

  return {
    outline: {
      color: irColor(
        used.color ? resolveColor(used.color, ctx.theme) : '000000'
      ),
      ...(used.width !== undefined
        ? { widthEmu: Math.round(used.width * EMU_PER_PIXEL) }
        : {}),
    },
    ignoredSides,
    unsupportedStyles,
  };
}

/** `bodyPr` insets are EMU, like every other DrawingML length. */
function shapeInsets(
  padding: Record<string, number> | undefined
):
  | { top?: number; bottom?: number; left?: number; right?: number }
  | undefined {
  if (!padding) return undefined;
  const toEmu = (value: number | undefined) =>
    value === undefined ? undefined : Math.round(value * EMU_PER_PIXEL);
  return {
    ...(padding.top !== undefined ? { top: toEmu(padding.top)! } : {}),
    ...(padding.bottom !== undefined ? { bottom: toEmu(padding.bottom)! } : {}),
    ...(padding.left !== undefined ? { left: toEmu(padding.left)! } : {}),
    ...(padding.right !== undefined ? { right: toEmu(padding.right)! } : {}),
  };
}

/** Every side off, which is how the container stays invisible. */
const NO_BORDERS = {
  top: { style: 'none', sizeEighthPoints: 0, color: { hex: '000000' } },
  right: { style: 'none', sizeEighthPoints: 0, color: { hex: '000000' } },
  bottom: { style: 'none', sizeEighthPoints: 0, color: { hex: '000000' } },
  left: { style: 'none', sizeEighthPoints: 0, color: { hex: '000000' } },
  insideHorizontal: {
    style: 'none',
    sizeEighthPoints: 0,
    color: { hex: '000000' },
  },
  insideVertical: {
    style: 'none',
    sizeEighthPoints: 0,
    color: { hex: '000000' },
  },
} as const;

/**
 * How wide a text box is.
 *
 * An inline one always fills the measure — the cell inside it is what has a
 * size. A floating one is as wide as it says: a number is pixels, a percentage
 * stays one, and saying nothing means about 3.5 inches.
 */
function textBoxWidth(props: Record<string, any>): DocxIrTableWidth {
  if (!props.floating) return { kind: 'percent', value: 100 };

  const raw = props.width ?? props.floating?.width;
  if (raw === undefined) {
    return { kind: 'twips', value: DEFAULT_TEXT_BOX_WIDTH_TWIPS };
  }
  if (typeof raw === 'string' && raw.endsWith('%')) {
    return { kind: 'percent', value: parseFloat(raw) };
  }
  return {
    kind: 'twips',
    value:
      typeof raw === 'number'
        ? raw * TWIPS_PER_PIXEL
        : DEFAULT_TEXT_BOX_WIDTH_TWIPS,
  };
}

/** Per-side borders as the authoring surface states them. */
function compileBorders(
  border: Record<string, any> | undefined,
  ctx: CompileContext
): DocxIrBorders | undefined {
  if (!border) return undefined;
  const side = (value: Record<string, any> | undefined) =>
    value
      ? {
          style: String(value.style ?? 'single'),
          // Points to eighths of a point, never thinner than the hairline a
          // reader can actually see.
          sizeEighthPoints:
            value.width !== undefined
              ? Math.max(1, Math.round(value.width * 8))
              : 1,
          color: irColor(
            value.color ? resolveColor(value.color, ctx.theme) : '000000'
          ),
        }
      : undefined;

  const borders: DocxIrBorders = {
    ...(side(border.top) ? { top: side(border.top)! } : {}),
    ...(side(border.right) ? { right: side(border.right)! } : {}),
    ...(side(border.bottom) ? { bottom: side(border.bottom)! } : {}),
    ...(side(border.left) ? { left: side(border.left)! } : {}),
  };
  return Object.keys(borders).length > 0 ? borders : undefined;
}

/**
 * Where a floating table sits.
 *
 * A table anchors differently from a drawing: in twips against an anchor rather
 * than in EMU against a frame of reference, and with clearance distances rather
 * than wrap margins.
 */
function compileTableFloat(
  floating: Record<string, any>,
  ctx: CompileContext
): DocxIrTableFloating {
  const anchor = (relative: unknown): string | undefined =>
    relative === 'margin' || relative === 'page'
      ? relative
      : relative
        ? 'text'
        : undefined;

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

  const horizontal = floating.horizontalPosition;
  const vertical = floating.verticalPosition;
  const pageWidth = getPageWidthTwips(ctx.theme, ctx.themeName);
  const pageHeight = getPageHeightTwips(ctx.theme, ctx.themeName);
  const margins = floating.wrap?.margins as Record<string, any> | undefined;

  return {
    ...(anchor(hRelative) ? { horizontalAnchor: anchor(hRelative)! } : {}),
    ...(anchor(vRelative) ? { verticalAnchor: anchor(vRelative)! } : {}),
    ...(horizontal?.offset !== undefined
      ? {
          absoluteHorizontalPositionTwips: resolveOffsetTwips(
            horizontal.offset,
            hRef
          ),
        }
      : horizontal?.align
        ? { relativeHorizontalPosition: horizontal.align }
        : {}),
    ...(vertical?.offset !== undefined
      ? {
          absoluteVerticalPositionTwips: resolveOffsetTwips(
            vertical.offset,
            vRef
          ),
        }
      : vertical?.align
        ? { relativeVerticalPosition: vertical.align }
        : {}),
    ...(margins?.top !== undefined
      ? { topFromTextTwips: resolveOffsetTwips(margins.top, pageHeight) }
      : {}),
    ...(margins?.right !== undefined
      ? { rightFromTextTwips: resolveOffsetTwips(margins.right, pageWidth) }
      : {}),
    ...(margins?.bottom !== undefined
      ? { bottomFromTextTwips: resolveOffsetTwips(margins.bottom, pageHeight) }
      : {}),
    ...(margins?.left !== undefined
      ? { leftFromTextTwips: resolveOffsetTwips(margins.left, pageWidth) }
      : {}),
    overlap: 'overlap',
  };
}

/* ------------------------------------------------------------------ *
 * Table of contents
 * ------------------------------------------------------------------ */

/**
 * A table of contents: an optional title paragraph, then the field itself.
 *
 * The field is a top-level block rather than a paragraph's child. Wrapping it
 * in one produces an empty structured-document-tag above the entries in Word.
 */
function compileToc(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  const field = resolveTocField(props, ctx.theme, {
    ...(scope.sectionBookmarkName
      ? { sectionBookmarkId: scope.sectionBookmarkName }
      : {}),
    collected: ctx.tocEntries,
  });
  for (const message of field.warnings) warnOnce(ctx, 'toc', message);

  const blocks: DocxIrBlock[] = [];

  if (props.title) {
    blocks.push({
      kind: 'paragraph',
      id: `${scope.id}:title`,
      path: `${path}.title`,
      // No style, not even Normal: a title with an outline level would collect
      // itself into the very list it introduces. It carries its own weight and
      // size instead.
      children: [
        {
          kind: 'text',
          text: String(props.title),
          formatting: { bold: true, sizeHalfPoints: 28 },
        },
      ],
      formatting: {
        alignment: 'left',
        spacing: {
          beforeTwips:
            (ctx.theme.componentDefaults as any)?.heading?.spacing?.before ??
            240,
          // ~9pt, which separates the title from the list clearly enough to
          // read as a heading rather than a first entry.
          afterTwips: 180,
        },
      },
    });
  }

  ctx.features.require('toc', path);
  if (field.entries.length > 0) ctx.features.require('cached-toc', path);

  blocks.push({
    kind: 'toc',
    id: scope.id,
    path,
    alias: String(props.title ?? 'Table of Contents'),
    headingRange: field.headingRange,
    ...(field.styleLevels.length > 0 ? { styleLevels: field.styleLevels } : {}),
    ...(field.bookmarkScope ? { bookmarkScope: field.bookmarkScope } : {}),
    hyperlink: true,
    ...(field.omitPageNumbersForLevels.length > 0
      ? { omitPageNumbersForLevels: field.omitPageNumbersForLevels }
      : {}),
    entrySeparator: field.entrySeparator,
    ...(field.entries.length > 0 ? { cachedEntries: field.entries } : {}),
  });

  return blocks;
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
  scope: ComponentScope,
  referencePrefix = 'list',
  /** Levels to use as written, instead of deriving them from the props. */
  explicitLevels?: ListLevelConfig[]
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  const items = (props.items ?? []) as ListItem[];
  if (items.length === 0) return [];

  // One binding for the whole list: ids are declared on the list, and markers
  // may appear in any item.
  const notes = createNoteBinding(props.footnotes, props.endnotes, ctx);

  // A markdown list states its levels in full rather than deriving them: it
  // always defines three, however few the text actually uses.
  const reference = declareNumbering(
    props,
    ctx,
    referencePrefix,
    explicitLevels
  );
  const blocks: DocxIrBlock[] = [];

  // A list-level comment spans the whole list, so its range opens on the first
  // item that actually renders and closes on the last. Empty items are skipped
  // below, so neither end can be read off the item index.
  const rendersAt = items.map((item) => {
    const text = typeof item === 'string' ? item : String(item.text ?? '');
    const revision = typeof item === 'object' ? item.revision : undefined;
    return Boolean(text.trim()) || revision !== undefined;
  });
  const firstRendered = rendersAt.indexOf(true);
  const lastRendered = rendersAt.lastIndexOf(true);
  const commentIds =
    firstRendered !== -1 && props.comment
      ? declareComment(props.comment, ctx, path)
      : undefined;

  items.forEach((item, index) => {
    const text = typeof item === 'string' ? item : String(item.text ?? '');
    const level = typeof item === 'object' ? item.level ?? 0 : 0;
    const revision = typeof item === 'object' ? item.revision : undefined;
    const itemPath = `${path}.items[${index}]`;

    // An item with nothing in it is not a bullet with no text; it is not an
    // item at all — unless it is a deletion, whose new text is empty by
    // definition and which still has to render its struck-through runs.
    if (!text.trim() && revision === undefined) return;

    if (revision === undefined) {
      const syntax = containsUnsupportedSyntax(text);
      if (syntax) {
        ctx.unsupported.push({ name: 'list', path: itemPath, detail: syntax });
        return;
      }
    } else {
      ctx.features.require('revisions', itemPath);
    }

    blocks.push(
      paragraphNode(
        { ctx, path: itemPath, id: `${scope.id}:i${index}` },
        revision === undefined
          ? parseInline(text, {
              base: {},
              hyperlinks: true,
              ...(notes ? { resolveNote: notes.resolve } : {}),
              resolvePlaceholder: placeholderResolver(ctx),
              resolveCrossReference: crossReferenceResolver(ctx, itemPath),
            })
          : compileRevision(revision as Record<string, any>, {}, ctx),
        {
          styleId: 'Normal',
          formatting: {
            alignment: compileAlignment(props.alignment) ?? 'left',
            spacing: itemSpacing(props.spacing, index, items.length),
          },
          ...(commentIds && index === firstRendered
            ? { commentOpen: commentIds }
            : {}),
          ...(commentIds && index === lastRendered
            ? { commentClose: commentIds }
            : {}),
          ...(typeof item === 'object' && typeof item.id === 'string'
            ? { bookmarkName: item.id }
            : {}),
          numbering: { reference, level },
        }
      )
    );
  });

  notes?.reportUnemitted(
    items
      .map((item) =>
        typeof item === 'string' ? item : String(item.text ?? '')
      )
      .join('\n')
  );

  if (blocks.length > 0) ctx.features.require('numbering', path);
  return blocks;
}

type ListItem =
  | string
  | {
      text?: string;
      level?: number;
      id?: string;
      revision?: Record<string, unknown>;
    };

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
  ctx: CompileContext,
  prefix = 'list',
  explicitLevels?: ListLevelConfig[]
): string {
  const reference =
    typeof props.reference === 'string' && props.reference
      ? props.reference
      : `${prefix}-${++ctx.listCounter}`;

  if (ctx.numberingByReference.has(reference)) return reference;

  const numbering: DocxIrNumbering = {
    reference,
    levels: (explicitLevels ?? resolveListLevels(props as ListLevelSource)).map(
      (level) => compileNumberingLevel(level, ctx)
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
    /** Position this paragraph as a floating box. */
    frame?: DocxIrFrame;
    /** Ids of a comment thread anchored over this paragraph's content. */
    commentIds?: readonly number[];
    /**
     * Halves of a range that spans more than this paragraph.
     *
     * A comment on a whole list opens on its first item and closes on its
     * last, so the two ends land on different paragraphs.
     */
    commentOpen?: readonly number[];
    commentClose?: readonly number[];
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

  const opening = options.commentIds ?? options.commentOpen;
  const closing = options.commentIds ?? options.commentClose;
  if (opening?.length || closing?.length) {
    // The range opens after a leading break so it covers exactly the commented
    // content, and closes around the bookmark rather than inside it.
    const breakCount = content.findIndex((c) => c.kind !== 'columnBreak');
    const split = breakCount === -1 ? content.length : breakCount;
    content = [
      ...content.slice(0, split),
      ...(opening ?? []).map((id) => ({
        kind: 'commentRangeStart' as const,
        id,
      })),
      ...content.slice(split),
      ...(closing ? closeComment(closing) : []),
    ];
    ctx.features.require('comments', scope.path);
  }

  return {
    kind: 'paragraph',
    id: scope.id,
    path: scope.path,
    children: content,
    // Body text always names a style; leaving it out is how a table cell says
    // it has none.
    styleId: options.styleId ?? 'Normal',
    ...(options.frame ? { frame: options.frame } : {}),
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
  void props;
  const syntax = containsUnsupportedSyntax(text);
  if (syntax) {
    scope.ctx.unsupported.push({
      name: component.name,
      path: scope.path,
      detail: syntax,
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

  const notes = createNoteBinding(props.footnotes, props.endnotes, ctx);

  if (props.revision) {
    // Revision segments render literally, so a `[^id]` marker inside them
    // stays literal text and its body is never emitted. Report that rather
    // than dropping the declared notes in silence.
    reportNotesInRevision(props, ctx);
    ctx.features.require('revisions', path);
    return [
      ...(props.columnBreak ? [{ kind: 'columnBreak' as const }] : []),
      ...compileRevision(props.revision, base, ctx),
    ];
  }

  const parseOptions = {
    base,
    ...(props.boldColor
      ? { boldColor: irColor(resolveColor(props.boldColor, ctx.theme)) }
      : {}),
    ...(words ? { noProofWords: words } : {}),
    resolvePlaceholder: placeholderResolver(ctx),
    ...(notes ? { resolveNote: notes.resolve } : {}),
    resolveCrossReference: (
      id: string,
      format: CrossReferenceFormat,
      token: string
    ) => resolveCrossReference(id, format, token, ctx, path),
  };
  children.push(
    ...(mode === 'literal'
      ? parseLiteral(text, parseOptions)
      : parseInline(text, { ...parseOptions, hyperlinks: true }))
  );
  if (mode === 'inline' && containsLink(text)) {
    ctx.features.require('hyperlinks', path);
  }
  if (mode === 'inline' && containsPlaceholder(text)) {
    ctx.features.require('fields', path);
  }
  notes?.reportUnemitted(text);

  return children;
}

/** Bind the placeholder resolver to one compilation's generation date. */
function placeholderResolver(
  ctx: CompileContext
): (name: string) => PlaceholderResolution | undefined {
  return (name) => resolvePlaceholder(name, ctx.generatedAt);
}

/** Bind the cross-reference resolver to one compilation and one path. */
function crossReferenceResolver(
  ctx: CompileContext,
  path: string
): (
  id: string,
  format: CrossReferenceFormat,
  token: string
) => DocxIrInline | undefined {
  return (id, format, token) =>
    resolveCrossReference(id, format, token, ctx, path);
}

/** OOXML's REF switches, by the format an author asks for. */
const REFERENCE_SWITCH: Readonly<Record<CrossReferenceFormat, string>> = {
  relative: '\\r',
  no_context: '\\n',
  full_context: '\\w',
  none: '',
};

/**
 * Turn one `[@id]` token into a REF field.
 *
 * The cached value is what makes the reference readable outside Word: headless
 * LibreOffice — and therefore the PDF export path — never updates fields, so an
 * uncached REF exports blank. Word recomputes it on open (the document sets
 * `updateFields`), so an approximate cached value is corrected there.
 *
 * `relative` caches the full number: Word resolves it against the reference's
 * own position in the numbering, which generation does not know.
 */
function resolveCrossReference(
  id: string,
  format: CrossReferenceFormat,
  token: string,
  ctx: CompileContext,
  path: string
): DocxIrInline | undefined {
  const info = ctx.numberedItems.get(id);
  if (!info) {
    warnOnce(
      ctx,
      'cross-reference',
      `[core-docx] Cross-reference ${token} has no target: no heading or list item declares the id "${id}". Rendering the token as literal text.`
    );
    return undefined;
  }

  const cachedText =
    format === 'none'
      ? info.text
      : format === 'no_context'
        ? info.own
        : info.full;

  if (format !== 'none' && cachedText === undefined) {
    warnOnce(
      ctx,
      'cross-reference',
      `[core-docx] Cross-reference ${token} targets an unnumbered ${info.kind} ("${id}"), so the field carries no cached number and reads blank until the reader updates fields. Use [@${id}:none] to reference its text instead.`
    );
  }

  ctx.features.require('cross-references', path);
  return {
    kind: 'field',
    // `\\h` makes the field a hyperlink to its target, which is what lets a
    // reader click through to the thing being referenced.
    instruction: `REF ${id} ${['\\h', REFERENCE_SWITCH[format]].filter(Boolean).join(' ')}`,
    ...(cachedText !== undefined ? { cachedText } : {}),
  };
}

/**
 * Bind a component's declared note bodies to the `[^id]` markers in its text.
 *
 * Footnotes and endnotes share the marker syntax and differ only in where Word
 * puts the body, so one resolver serves both: an id is looked up in `footnotes`
 * first, then `endnotes`. Registration is lazy — a body reaches its part only
 * when a marker actually resolves to it — and memoised, so repeating `[^id]`
 * points both references at one note rather than duplicating the body.
 */
function createNoteBinding(
  footnotes: unknown,
  endnotes: unknown,
  ctx: CompileContext
): NoteBinding | undefined {
  const declared = new Map<string, { text: string; endnote: boolean }>();

  /**
   * First declaration wins, in both directions: within one array and across
   * the two. `[^id]` can only mean one note, and letting the last entry win
   * would make the outcome depend on authoring order while silently discarding
   * a body.
   */
  const declare = (note: { id: string; text: string }, endnote: boolean) => {
    const existing = declared.get(note.id);
    if (existing) {
      warnOnce(
        ctx,
        endnote ? 'endnote' : 'footnote',
        existing.endnote === endnote
          ? `Note id "${note.id}" is declared twice in the same ` +
              `${endnote ? 'endnotes' : 'footnotes'} array. Using the first ` +
              'declaration and ignoring the rest.'
          : `Note id "${note.id}" is declared as both a footnote and an ` +
              'endnote in the same paragraph. Using the footnote and ignoring ' +
              'the endnote.'
      );
      return;
    }
    declared.set(note.id, { text: note.text, endnote });
  };

  for (const note of (footnotes ?? []) as { id: string; text: string }[]) {
    declare(note, false);
  }
  for (const note of (endnotes ?? []) as { id: string; text: string }[]) {
    declare(note, true);
  }
  if (declared.size === 0) return undefined;

  const registered = new Map<
    string,
    { id: number; noteKind: 'footnote' | 'endnote' }
  >();

  return {
    resolve(id: string) {
      const existing = registered.get(id);
      if (existing !== undefined) return existing;

      const note = declared.get(id);
      if (note === undefined) {
        // The component declares notes, so `[^id]` was meant as a marker.
        // Leave it literal rather than dropping text, but say so.
        warnOnce(
          ctx,
          'footnote',
          `Note marker "[^${id}]" has no matching entry in this paragraph's ` +
            `footnotes or endnotes (declared: ${[...declared.keys()].join(', ')}). ` +
            'Rendering the marker as literal text.'
        );
        return undefined;
      }

      const bodies = note.endnote ? ctx.endnotes : ctx.footnotes;
      const resolved = {
        id: bodies.length + 1,
        noteKind: note.endnote ? ('endnote' as const) : ('footnote' as const),
      };
      bodies.push({
        id: resolved.id,
        // One paragraph per line, so an author can write a short list.
        children: normalizeUnicodeText(note.text)
          .split('\n')
          .map((line, index) => ({
            kind: 'paragraph' as const,
            id: `${note.endnote ? 'endnote' : 'footnote'}${resolved.id}:p${index}`,
            path: `${note.endnote ? 'endnotes' : 'footnotes'}[${resolved.id}].children[${index}]`,
            styleId: note.endnote ? 'EndnoteText' : 'FootnoteText',
            children: [{ kind: 'text' as const, text: line }],
          })),
      });
      registered.set(id, resolved);
      ctx.features.require(note.endnote ? 'endnotes' : 'footnotes', 'notes');
      return resolved;
    },

    reportUnemitted(text: string) {
      for (const [id, note] of declared) {
        if (registered.has(id)) continue;
        const kind = note.endnote ? 'Endnote' : 'Footnote';
        warnOnce(
          ctx,
          note.endnote ? 'endnote' : 'footnote',
          text.includes(`[^${id}]`)
            ? `${kind} "${id}" is declared and its marker appears in the text, ` +
                'but the marker was not resolved — markers are not recognised ' +
                'in text that also contains {PLACEHOLDER} substitutions. ' +
                'The note will not appear in the document.'
            : `${kind} "${id}" is declared but never referenced as [^${id}] ` +
                'in this paragraph. It will not appear in the document.'
        );
      }
    },
  };
}

/**
 * Say why a revised paragraph's declared notes will not appear.
 *
 * Tracked-change text renders literally, so a marker inside it is never
 * resolved and the body it names is never emitted. Naming the markers that are
 * actually present makes the difference between "you declared a note you never
 * used" and "your note is in the document but will not render".
 */
function reportNotesInRevision(
  props: Record<string, any>,
  ctx: CompileContext
): void {
  const declared = [
    ...((props.footnotes ?? []) as { id: string }[]),
    ...((props.endnotes ?? []) as { id: string }[]),
  ];
  if (declared.length === 0) return;

  const text = ((props.revision?.segments ?? []) as { text?: string }[])
    .map((segment) => segment.text ?? '')
    .join('');
  const referenced = declared.filter((note) => text.includes(`[^${note.id}]`));

  warnOnce(
    ctx,
    'footnote',
    `Paragraph declares ${declared.length} note(s) (${declared
      .map((note) => note.id)
      .join(', ')}) alongside a \`revision\`. Tracked-change text renders ` +
      'literally, so note markers are not resolved there' +
      (referenced.length > 0
        ? ` — the marker(s) ${referenced
            .map((note) => `[^${note.id}]`)
            .join(', ')} will render as literal text`
        : '') +
      '. The notes will not appear in the document.'
  );
}

interface NoteBinding {
  resolve: (
    id: string
  ) => { id: number; noteKind: 'footnote' | 'endnote' } | undefined;
  reportUnemitted: (text: string) => void;
}

/**
 * Register a comment thread and return the ids its anchors must carry.
 *
 * Every comment in a thread anchors over the same range — root first, then
 * each reply in order — which is how Word writes threads and how it groups
 * them in the review pane.
 */
function declareComment(
  comment: Record<string, any>,
  ctx: CompileContext,
  path: string
): number[] {
  const resolved = comment.resolved as boolean | undefined;
  const replies = (comment.replies ?? []) as Record<string, any>[];
  // A reply and a resolved state both live in `word/commentsExtended.xml`,
  // which a backend has to write on purpose. Requiring the feature is what
  // stops one that cannot from flattening a thread into unrelated comments.
  if (replies.length > 0 || resolved !== undefined) {
    ctx.features.require('comment-threads', path);
  }
  const rootId = ++ctx.commentCounter;
  const toComment = (
    source: Record<string, any>,
    id: number,
    parentId?: number
  ): DocxIrComment => {
    const author = (source.author as string) || DEFAULT_COMMENT_AUTHOR;
    return {
      id,
      author,
      initials: (source.initials as string) || deriveInitials(author),
      date: String(source.date || DEFAULT_COMMENT_DATE),
      // One paragraph per line, so an author can write a short list.
      children: normalizeUnicodeText(String(source.text ?? ''))
        .split('\n')
        .map((line, index) => ({
          kind: 'paragraph' as const,
          id: `comment${id}:p${index}`,
          path: `comments[${id}].children[${index}]`,
          children: [{ kind: 'text' as const, text: line }],
        })),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(resolved !== undefined ? { resolved } : {}),
    };
  };

  ctx.comments.push(toComment(comment, rootId));
  const ids = [rootId];
  for (const reply of replies) {
    const replyId = ++ctx.commentCounter;
    // Word resolves a thread as a whole, so the flag rides every member.
    ctx.comments.push(toComment(reply, replyId, rootId));
    ids.push(replyId);
  }

  if (resolved !== undefined) ctx.hasResolvedComment = true;
  return ids;
}

/**
 * Initials shown on the comment bubble.
 *
 * Word derives them from the author when the file omits them; doing it here
 * makes the value stable across viewers instead of viewer-dependent.
 */
function deriveInitials(author: string): string {
  const initials = author
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);
  return initials || author.slice(0, 2).toUpperCase();
}

/** The anchors that close a comment range: each end, then its reference run. */
function closeComment(ids: readonly number[]): DocxIrInline[] {
  return ids.flatMap((id) => [
    { kind: 'commentRangeEnd' as const, id },
    { kind: 'commentReference' as const, id },
  ]);
}

/**
 * Tracked-change segments, as revision ranges and plain runs.
 *
 * Segment text is literal — no decorators. A `**` opened in one segment could
 * close in another, so per-segment decorator parsing cannot work; the diff
 * engine strips markdown before diffing for the same reason. Placeholders are
 * still resolved, but only in unchanged text: inside an insertion or a deletion
 * they stay as written, because what was changed is the token, not its value.
 *
 * Each emitted run gets its own range, and so its own id, which is what the
 * pipeline has always produced.
 */
function compileRevision(
  revision: Record<string, any>,
  base: DocxIrRunFormatting,
  ctx: CompileContext
): DocxIrInline[] {
  const author = revision.author || DEFAULT_REVISION_AUTHOR;
  const date = revision.date || DEFAULT_REVISION_DATE;
  const out: DocxIrInline[] = [];

  for (const segment of (revision.segments ?? []) as {
    type?: string;
    text?: string;
  }[]) {
    if (!segment.text) continue;
    const text = normalizeUnicodeText(segment.text);

    if (segment.type === 'insert' || segment.type === 'delete') {
      for (const line of literalLines(text, base)) {
        out.push({
          kind: 'revision',
          type: segment.type,
          id: ctx.nextRevisionId++,
          author,
          date,
          children: line,
        });
      }
      continue;
    }

    // Unchanged text is literal too — the same segment rule applies — unless it
    // carries a placeholder, which is resolved as it would be anywhere else.
    if (containsPlaceholder(text)) {
      out.push(
        ...parseInline(text, {
          base,
          resolvePlaceholder: placeholderResolver(ctx),
        })
      );
      continue;
    }
    for (const line of literalLines(text, base)) out.push(...line);
  }

  return out;
}

/**
 * One run per line, character for character.
 *
 * A revision segment carries no mini-language at all: a `**` opened in one
 * segment could close in another, so nothing inside one can be parsed. Even an
 * empty line becomes a run, because the break is what makes it visible.
 */
function literalLines(
  text: string,
  base: DocxIrRunFormatting
): DocxIrInline[][] {
  const formatting = Object.keys(base).length > 0 ? base : undefined;
  return text.split('\n').map((line, index) => [
    ...(index > 0 ? [{ kind: 'lineBreak' as const }] : []),
    {
      kind: 'text' as const,
      text: line,
      ...(formatting ? { formatting } : {}),
    },
  ]);
}

/**
 * What each built-in `{PLACEHOLDER}` stands for.
 *
 * A page number is a field: only Word knows which page a run lands on, so the
 * document carries the instruction and Word computes it. A date is not — it is
 * resolved once, at generation time, so the document says when it was made
 * rather than when it was opened. An unrecognised name resolves to nothing and
 * stays as the characters the author typed.
 */
function resolvePlaceholder(
  name: string,
  generatedAt: Date
): PlaceholderResolution | undefined {
  switch (name.toUpperCase()) {
    case 'PAGE':
      return { kind: 'field', instruction: 'PAGE' };
    case 'TOTAL_PAGES':
      return { kind: 'field', instruction: 'NUMPAGES' };
    case 'DATE':
      return { kind: 'text', text: isoDate(generatedAt) };
    case 'DATETIME':
      return { kind: 'text', text: isoDateTime(generatedAt) };
    case 'YEAR':
      return { kind: 'text', text: String(generatedAt.getUTCFullYear()) };
    default:
      return undefined;
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDateTime(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, 'Z');
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

/**
 * A native `visual`, and the caption paragraph that may follow it.
 *
 * Only a native one reaches here: a raster visual became an `image` during
 * desugaring, long before compilation. One that did not is a pipeline bug, and
 * is refused rather than drawn as an empty box.
 *
 * The drawing itself is lowered in `./nativeVisual`; what happens here is the
 * placement — the page-side size, the anchor, the caption — which is `image`'s
 * job done again, because a visual is placed exactly like an image.
 */
function compileVisual(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  if (!isNativeVisualProps(props as VisualProps)) {
    ctx.unsupported.push({
      name: 'visual',
      path,
      detail:
        'a raster visual reached the compiler; it should have been rasterized during desugaring',
    });
    return [];
  }

  const group = compileNativeVisualGroup(
    props as VisualNativeProps,
    nativeVisualDeps(ctx, path)
  );
  if (!group) return [];

  const size = visualPlacementPixels(props, group.canvas, {
    widthPx: Math.round(twipsToPixels(getAvailableWidthTwips(ctx.theme))),
    heightPx: Math.round(twipsToPixels(getAvailableHeightTwips(ctx.theme))),
  });

  const drawing: DocxIrDrawingGroupRun = {
    kind: 'drawingGroup',
    widthEmu: pixelsToEmu(size.width),
    heightEmu: pixelsToEmu(size.height),
    canvasWidthEmu: group.canvas.widthEmu,
    canvasHeightEmu: group.canvas.heightEmu,
    children: group.children,
    ...(typeof props.alt === 'string' && props.alt
      ? { altText: props.alt }
      : {}),
    ...(props.floating
      ? { floating: compileFloating(props.floating, ctx, path) }
      : {}),
  };

  ctx.features.require('drawing-groups', path);
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
      children: [drawing],
      formatting: {
        // A floating drawing is anchored, so aligning its paragraph would move
        // the anchor rather than the graphic — the same rule an image follows.
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

  const caption = captionBlock(props.caption, scope, 'visual');
  if (caption === undefined) return [];
  if (caption) blocks.push(caption);

  return blocks;
}

/**
 * What lowering a native visual needs from the compiler.
 *
 * Built once here rather than at each call site so a visual in a table cell
 * declares its resources, resolves its colours and reports its refusals
 * exactly as one in the body does.
 */
function nativeVisualDeps(ctx: CompileContext, path: string): NativeVisualDeps {
  return {
    color: (value) => {
      try {
        return irColor(resolveColor(value, ctx.theme));
      } catch {
        // An unresolvable token is the author's, not the pipeline's: report it
        // against the property that holds it rather than throwing from here.
        return undefined;
      }
    },
    picture: (source) => {
      const loaded = ctx.images.get(source);
      if (!loaded) return undefined;
      const mediaType = detectImageType(source, loaded.contentType);
      if (mediaType === 'svg') ctx.features.require('svg-images', path);
      return {
        resourceId: declareResource(loaded, mediaType, ctx),
        mediaType,
        ...(loaded.intrinsic ? { intrinsic: loaded.intrinsic } : {}),
      };
    },
    reject: (detail) => ctx.unsupported.push({ name: 'visual', path, detail }),
    warn: (message) => warnOnce(ctx, `visual:${message}`, message),
  };
}

/**
 * The size a visual is drawn at, in pixels.
 *
 * Defaults to the canvas's own physical size — a 6×3 inch canvas prints 6×3 —
 * which is what the raster path does through `defaultVisualWidthPx`. Stating
 * one axis scales the other with it; stating both allows a deliberate
 * distortion, exactly as an image does.
 *
 * `reference` is what a percentage resolves against: the page's content box in
 * the body, and a nominal box inside a table cell, whose real width is not
 * known until Word lays the table out.
 */
function visualPlacementPixels(
  props: Record<string, any>,
  canvas: { widthEmu: number; heightEmu: number },
  reference: { widthPx: number; heightPx: number }
): { width: number; height: number } {
  const canvasWidthPx = Math.round(emuToPixels(canvas.widthEmu));
  const canvasHeightPx = Math.round(emuToPixels(canvas.heightEmu));

  const targetWidth =
    props.width !== undefined
      ? parseWidthValue(props.width, reference.widthPx)
      : undefined;
  const targetHeight =
    props.height !== undefined
      ? parseDimensionValue(props.height, reference.heightPx)
      : undefined;

  if (targetWidth === undefined && targetHeight === undefined) {
    return { width: canvasWidthPx, height: canvasHeightPx };
  }
  return calculateMissingDimension(
    canvasWidthPx,
    canvasHeightPx,
    targetWidth,
    targetHeight
  );
}

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

  const caption = captionBlock(props.caption, scope, 'image');
  if (caption === undefined) return [];
  if (caption) blocks.push(caption);

  return blocks;
}

/** A chart with no explicit height is this tall, in inches. */
const DEFAULT_CHART_HEIGHT_INCHES = 3;

/**
 * Lower a `chart` component to a chart run.
 *
 * Strict about data, because a chart is the one figure whose content cannot be
 * eyeballed in the JSON: a series missing `values`, or carrying fewer than it
 * has labels, stops the document naming that series. The alternative — drawing
 * the series that happened to be complete — ships a chart that looks finished
 * and states something the author never wrote.
 */
function compileChart(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  // Refused by the schema too, which is where an authoring mistake should
  // land. Stated again here because a caller can skip validation, and the
  // failure without this is a TypeError raised from inside `@office-open`'s
  // own bundle: it spells a bubble series as `xValues`/`yValues`/`bubbleSize`
  // rather than categories and values.
  if (props.type === 'bubble') {
    throw new Error(
      `Chart at ${path} is a bubble chart, which no docx renderer draws; ` +
        'use the pptx `chart` component on the pptxgenjs renderer for one.'
    );
  }

  const rawSeries = Array.isArray(props.data) ? props.data : [];
  if (rawSeries.length === 0) {
    throw new Error(`Chart at ${path} has no data series.`);
  }

  const series: DocxIrChartSeries[] = rawSeries.map((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const label = typeof raw.name === 'string' ? raw.name : `series ${index}`;
    const labels = raw.labels;
    const values = raw.values;
    if (!Array.isArray(labels) || !Array.isArray(values)) {
      throw new Error(
        `Chart series "${label}" at ${path} needs both "labels" and "values"; ` +
          'every series carries its own, not just the first.'
      );
    }
    if (labels.length !== values.length) {
      throw new Error(
        `Chart series "${label}" at ${path} has ${labels.length} labels and ` +
          `${values.length} values; they must be the same length.`
      );
    }
    return {
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      labels: labels.map((value) => String(value)),
      values: values.map((value) => Number(value)),
    };
  });

  // A chart has one category axis, and it is drawn from the first series'
  // labels. A later series labelled differently would be plotted against
  // categories it never named — every point shifted onto the wrong label, with
  // nothing in the file to show for it. Refuse instead.
  const categories = series[0].labels;
  for (const [index, entry] of series.entries()) {
    if (index === 0) continue;
    // Length first: `some` walks only the shorter array, so a series whose
    // labels are a strict prefix of the first's used to pass here and then be
    // padded with a value the author never wrote.
    if (
      entry.labels.length !== categories.length ||
      entry.labels.some((label, i) => label !== categories[i])
    ) {
      throw new Error(
        `Chart series "${entry.name ?? `series ${index}`}" at ${path} has ` +
          'different labels from the first series. A chart has one category ' +
          'axis, so every series must name the same categories in the same order.'
      );
    }
  }

  // An explicit palette is the author's and is resolved verbatim, semantic
  // names included — naming a token that resolves to nothing throws, which is
  // the docx rule everywhere else. The implicit palette instead *skips* what
  // the theme leaves unset, so it shrinks to fit rather than repeating
  // `primary`; see DEFAULT_CHART_THEME_COLORS.
  const colors: string[] = Array.isArray(props.chartColors)
    ? props.chartColors.map((color: unknown) =>
        resolveColor(String(color), ctx.theme)
      )
    : DEFAULT_CHART_THEME_COLORS.map((token) => {
        const value = (
          ctx.theme?.colors as Record<string, string | undefined>
        )?.[token];
        if (typeof value !== 'string' || value.length === 0) return undefined;
        try {
          return resolveColor(token, ctx.theme);
        } catch {
          // A slot reaching no colour is dropped, never handed on: Word
          // answers an unparseable colour by drawing the series black.
          return undefined;
        }
      }).filter((color): color is string => color !== undefined);

  const page = getPageSetup(ctx.theme);
  const contentWidthInches =
    (page.size.width - page.margin.left - page.margin.right) / 1440;
  const widthInches =
    typeof props.width === 'number' ? props.width : contentWidthInches;
  const heightInches =
    typeof props.height === 'number'
      ? props.height
      : DEFAULT_CHART_HEIGHT_INCHES;

  const chart: DocxIrChartRun = {
    kind: 'chart',
    chartType: props.type as DocxIrChartType,
    series,
    colors,
    widthEmu: inchesToEmu(widthInches),
    heightEmu: inchesToEmu(heightInches),
    ...(typeof props.title === 'string' ? { title: props.title } : {}),
    ...(props.showTitle !== undefined ? { showTitle: props.showTitle } : {}),
    ...(props.showLegend !== undefined ? { showLegend: props.showLegend } : {}),
    ...(props.legendPos
      ? { legendPosition: props.legendPos as DocxIrChartLegendPosition }
      : {}),
    ...(typeof props.catAxisTitle === 'string'
      ? { categoryAxisTitle: props.catAxisTitle }
      : {}),
    ...(typeof props.valAxisTitle === 'string'
      ? { valueAxisTitle: props.valAxisTitle }
      : {}),
    ...(typeof props.alt === 'string' && props.alt
      ? { altText: props.alt }
      : {}),
    ...(props.floating
      ? { floating: compileFloating(props.floating, ctx, path) }
      : {}),
  };

  ctx.features.require('charts', path);
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
      children: [chart],
      formatting: {
        // An anchored chart moves with its anchor, so aligning the paragraph
        // would move the anchor rather than the chart — the same reasoning as
        // a floating image.
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

  const caption = captionBlock(props.caption, scope, 'chart');
  if (caption === undefined) return [];
  if (caption) blocks.push(caption);

  return blocks;
}

/**
 * The caption paragraph that follows a figure, if it has one.
 *
 * Three outcomes rather than two: a paragraph, `null` for no caption, and
 * `undefined` for a caption the compiler refuses — which the caller turns into
 * dropping the whole figure, because a figure whose caption was silently
 * discarded is worse than one that fails.
 */
function captionBlock(
  value: unknown,
  scope: ComponentScope,
  componentName: string
): DocxIrParagraph | null | undefined {
  if (!value) return null;
  const { ctx, path } = scope;
  const caption = String(value);
  const syntax = containsUnsupportedSyntax(caption);
  if (syntax) {
    ctx.unsupported.push({ name: componentName, path, detail: syntax });
    return undefined;
  }
  return {
    kind: 'paragraph',
    id: `${scope.id}:caption`,
    path: `${path}.caption`,
    styleId: 'Normal',
    // Captions default to left alignment, whatever the figure did.
    formatting: { alignment: 'left' },
    // A caption reaches the parser only when it carries a decorator, which
    // is why a link in an otherwise plain caption stays literal.
    children: DECORATED.test(caption)
      ? parseInline(caption, {
          base: {},
          hyperlinks: true,
          resolvePlaceholder: placeholderResolver(ctx),
          resolveCrossReference: crossReferenceResolver(ctx, path),
        })
      : parseLiteral(caption, { base: {} }),
  };
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
 * A paragraph positioned as a floating box (`w:framePr`).
 *
 * Distinct from a floating drawing: this positions the paragraph itself, so it
 * is measured in twips rather than EMU and has no wrap margins of its own.
 * Exactly one positioning mode applies — absolute if either axis states an
 * offset, alignment otherwise — because OOXML cannot mix them on one frame.
 */
function compileFrame(
  floating: Record<string, any>,
  ctx: CompileContext,
  path: string
): DocxIrFrame {
  ctx.features.require('text-frames', path);
  const hasHorizontalOffset = floating.horizontalPosition?.offset !== undefined;
  const hasVerticalOffset = floating.verticalPosition?.offset !== undefined;
  const useAbsolute = hasHorizontalOffset || hasVerticalOffset;

  const frame: DocxIrFrame = {
    // 2in by 1in when the author gave no size.
    widthTwips: floating.width || 2880,
    heightTwips: floating.height || 1440,
    anchorHorizontal: floating.horizontalPosition?.relative || 'page',
    anchorVertical: floating.verticalPosition?.relative || 'page',
    ...(floating.wrap?.type ? { wrap: floating.wrap.type } : {}),
  };

  const anchorLock = floating.lockAnchor ?? floating.anchorLock;
  if (anchorLock !== undefined) frame.anchorLock = anchorLock;

  if (useAbsolute) {
    const rawX = floating.horizontalPosition?.offset ?? 0;
    const rawY = floating.verticalPosition?.offset ?? 0;
    if (typeof rawX === 'string' || typeof rawY === 'string') {
      const hRelative = floating.horizontalPosition?.relative;
      const vRelative = floating.verticalPosition?.relative;
      frame.xTwips = resolveOffsetTwips(
        rawX,
        hRelative && hRelative !== 'page'
          ? getAvailableWidthTwips(ctx.theme, ctx.themeName)
          : getPageWidthTwips(ctx.theme, ctx.themeName)
      );
      frame.yTwips = resolveOffsetTwips(
        rawY,
        vRelative && vRelative !== 'page'
          ? getAvailableHeightTwips(ctx.theme, ctx.themeName)
          : getPageHeightTwips(ctx.theme, ctx.themeName)
      );
    } else {
      frame.xTwips = rawX;
      frame.yTwips = rawY;
    }
    return frame;
  }

  frame.xAlign = floating.horizontalPosition?.align ?? 'left';
  frame.yAlign = floating.verticalPosition?.align ?? 'top';
  return frame;
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
    { onWarning: (code, message) => warnOnce(ctx, 'table', message, code) }
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
    for (const [colIndex, cell] of row.cells.entries()) {
      const cellPath = `${rowPath}.cells[${colIndex}]`;
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
      // An image or a paragraph is rendered; anything else falls back to a
      // placeholder run, which is content in its own right — the cell says
      // what it could not render rather than going blank.
      if (content.name !== 'paragraph') continue;
      const text = String((content.props as { text?: unknown })?.text ?? '');
      const syntax = containsUnsupportedSyntax(text);
      if (syntax) return { path: cellPath, detail: syntax };
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
  const { ctx } = scope;
  const rowRevision = row.revision as RowRevision | undefined;

  // Ids are allocated in the order the pipeline has always allocated them:
  // the row's own mark first, then one per cell for the paragraph marks, and
  // only then whatever the cell contents need.
  const rowMark = rowRevision
    ? {
        type: rowRevision.type,
        id: ctx.nextRevisionId++,
        author: rowRevision.author || DEFAULT_REVISION_AUTHOR,
        date: rowRevision.date || DEFAULT_REVISION_DATE,
      }
    : undefined;
  const paragraphMarks = rowRevision
    ? row.cells.map(() => ({
        type: rowRevision.type,
        id: ctx.nextRevisionId++,
        author: rowRevision.author || DEFAULT_REVISION_AUTHOR,
        date: rowRevision.date || DEFAULT_REVISION_DATE,
      }))
    : undefined;
  if (rowRevision) ctx.features.require('revisions', scope.path);

  return {
    cells: row.cells.map((cell, colIndex) =>
      compileTableCell(
        cell,
        spacing,
        baseStyle,
        row.keepNext,
        {
          ctx: scope.ctx,
          path: `${scope.path}.cells[${colIndex}]`,
          id: `${scope.id}:c${colIndex}`,
        },
        rowRevision,
        paragraphMarks?.[colIndex]
      )
    ),
    ...(rowMark ? { revision: rowMark } : {}),
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

/** A structural tracked change on a table row. */
interface RowRevision {
  type: 'insert' | 'delete';
  author?: string;
  date?: string;
}

function compileTableCell(
  cell: ResolvedCell<unknown, unknown>,
  spacing: ReturnType<typeof getTableStyle>['cellParagraph'],
  baseStyle: TableBaseStyle,
  keepNext: boolean,
  scope: ComponentScope,
  rowRevision?: RowRevision,
  markRevision?: DocxIrParagraphMarkRevision
): DocxIrTableCell {
  const paragraph: DocxIrParagraph = {
    kind: 'paragraph',
    id: scope.id,
    path: scope.path,
    // A cell paragraph names no style: it takes its run properties from the
    // cell, not from Normal, so naming one would layer body-prose spacing back
    // on top of the dense table spacing.
    children: cellChildren(cell, baseStyle, scope, rowRevision),
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
    ...(markRevision ? { markRevision } : {}),
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
 * A cell's runs.
 *
 * A cell inside an inserted or deleted row renders as runs marked the same
 * way: a `w:trPr/w:del` alone leaves the text un-struck, and accepting the
 * change would leave an empty row behind rather than removing it. A cell that
 * carries its own revision states it directly.
 */
function cellChildren(
  cell: ResolvedCell<unknown, unknown>,
  baseStyle: TableBaseStyle,
  scope: ComponentScope,
  rowRevision?: RowRevision
): DocxIrInline[] {
  const { ctx } = scope;
  // A comment on an empty cell still has to anchor somewhere: Word writes a
  // zero-length range plus the reference, so the anchors are placed before the
  // content is known to exist.
  const comment = cell.comment as Record<string, any> | undefined;
  const commentIds = comment
    ? declareComment(comment, ctx, scope.path)
    : undefined;
  const wrap = (children: DocxIrInline[]): DocxIrInline[] =>
    commentIds
      ? [
          ...commentIds.map((id) => ({
            kind: 'commentRangeStart' as const,
            id,
          })),
          ...children,
          ...closeComment(commentIds),
        ]
      : children;

  if (cell.missing) return wrap([]);

  const content = cell.content;
  const base = cellRunFormatting(cell, baseStyle, ctx);
  if (content !== undefined && typeof content !== 'string') {
    if (content.name === 'image') {
      return wrap(cellImage(content, base, ctx));
    }
    if (content.name === 'visual') {
      return wrap(cellVisual(content, scope));
    }
    if (content.name !== 'paragraph') {
      // The cell says what it could not render, in the same grey the missing
      // image placeholder uses.
      return wrap([
        {
          kind: 'text',
          text: `[Unsupported component type: ${content.name}]`,
          formatting: placeholderFormatting(base),
        },
      ]);
    }
  }

  const text = cellText(cell);
  if (text === undefined) return wrap([]);

  const revision =
    (cell.revision as Record<string, any> | undefined) ??
    cellComponentRevision(cell);
  if (revision) {
    ctx.features.require('revisions', '');
    return wrap(compileRevision(revision, base, ctx));
  }
  if (rowRevision) {
    return wrap(
      compileRevision(
        {
          author: rowRevision.author,
          date: rowRevision.date,
          segments: [{ type: rowRevision.type, text }],
        },
        base,
        ctx
      )
    );
  }
  return wrap(
    parseInline(text, {
      base,
      hyperlinks: true,
      resolvePlaceholder: placeholderResolver(ctx),
      resolveCrossReference: crossReferenceResolver(ctx, 'table'),
    })
  );
}

/**
 * An image inside a table cell.
 *
 * Sized against a notional 300×200 box rather than the page: a cell has no
 * width the compiler can see, and those are the reference dimensions this path
 * has always used. An image that cannot be loaded leaves a placeholder naming
 * its source rather than an empty cell.
 */
/**
 * A native visual inside a table cell.
 *
 * A cell holds runs, and a drawing group is one — so this is the same lowering
 * the body path uses, minus the things a cell has nowhere to put: no caption
 * paragraph, no anchor, no paragraph alignment. A *raster* visual never gets
 * here, because it became an `image` during desugaring.
 */
function cellVisual(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrInline[] {
  const { ctx, path } = scope;
  const props = (component.props ?? {}) as Record<string, any>;

  if (!isNativeVisualProps(props as VisualProps)) {
    ctx.unsupported.push({
      name: 'visual',
      path,
      detail:
        'a raster visual reached the compiler; it should have been rasterized during desugaring',
    });
    return [];
  }

  const group = compileNativeVisualGroup(
    props as VisualNativeProps,
    nativeVisualDeps(ctx, path)
  );
  if (!group) return [];

  // A cell's real width is decided by the table layout, so a percentage has no
  // page box to resolve against; the nominal box matches `cellImage`'s.
  const size = visualPlacementPixels(props, group.canvas, {
    widthPx: CELL_DRAWING_REFERENCE.width,
    heightPx: CELL_DRAWING_REFERENCE.height,
  });

  ctx.features.require('drawing-groups', path);

  return [
    {
      kind: 'drawingGroup',
      widthEmu: pixelsToEmu(size.width),
      heightEmu: pixelsToEmu(size.height),
      canvasWidthEmu: group.canvas.widthEmu,
      canvasHeightEmu: group.canvas.heightEmu,
      children: group.children,
      ...(typeof props.alt === 'string' && props.alt
        ? { altText: props.alt }
        : {}),
    },
  ];
}

/** The nominal box a percentage size resolves against inside a cell. */
const CELL_DRAWING_REFERENCE = { width: 300, height: 200 } as const;

function cellImage(
  component: ComponentDefinition,
  base: DocxIrRunFormatting,
  ctx: CompileContext
): DocxIrInline[] {
  const props = (component.props ?? {}) as Record<string, any>;
  const source = resolveImageSource(props);
  const loaded = source ? ctx.images.get(source) : undefined;

  if (!source || !loaded) {
    const preview = String(
      props.svg?.trim() ? 'inline-svg' : props.base64 || props.path || 'unknown'
    );
    return [
      {
        kind: 'text',
        text: `[IMAGE: ${preview.substring(0, 50)}${preview.length > 50 ? '...' : ''}]`,
        formatting: placeholderFormatting(base),
      },
    ];
  }

  const targetWidth =
    typeof props.width === 'string'
      ? parseWidthValue(props.width, 300)
      : (props.width as number | undefined);
  const targetHeight =
    typeof props.height === 'string'
      ? parseWidthValue(props.height, 200)
      : (props.height as number | undefined);

  const size = loaded.intrinsic
    ? calculateMissingDimension(
        loaded.intrinsic.width,
        loaded.intrinsic.height,
        targetWidth,
        targetHeight
      )
    : fallbackSize(targetWidth, targetHeight, { width: 60, height: 20 });

  const mediaType = detectImageType(source, loaded.contentType);
  if (mediaType === 'svg') ctx.features.require('svg-images', 'table');
  ctx.features.require('images', 'table');

  return [
    {
      kind: 'image',
      resourceId: declareResource(loaded, mediaType, ctx),
      widthEmu: pixelsToEmu(size.width),
      heightEmu: pixelsToEmu(size.height),
    },
  ];
}

/** The grey a cell uses to say what it could not render. */
function placeholderFormatting(base: DocxIrRunFormatting): DocxIrRunFormatting {
  return {
    ...(base.fontFamily ? { fontFamily: base.fontFamily } : {}),
    ...(base.sizeHalfPoints !== undefined
      ? { sizeHalfPoints: base.sizeHalfPoints }
      : {}),
    color: irColor('#999999'),
  };
}

/** A revision stated on the `paragraph` component inside a cell. */
function cellComponentRevision(
  cell: ResolvedCell<unknown, unknown>
): Record<string, any> | undefined {
  const content = cell.content;
  if (content === undefined || typeof content === 'string') return undefined;
  return (content.props as { revision?: Record<string, any> })?.revision;
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

/**
 * Report a warning once per compilation, keyed by its message.
 *
 * Collected either way, and echoed to the console when the caller supplied no
 * collector of its own — the same contract `reportWarning` gives every other
 * leaf in the pipeline. Without the echo a warning a caller never asked to
 * collect would simply disappear.
 */
function warnOnce(
  ctx: CompileContext,
  component: string,
  message: string,
  code?: string
): void {
  if (ctx.warnedMessages.has(message)) return;
  ctx.warnedMessages.add(message);
  ctx.warnings.push({
    component,
    message,
    severity: 'warning',
    ...(code ? { context: { code } } : {}),
  });
  if (ctx.echoWarnings) {
    // eslint-disable-next-line no-console
    console.warn(code ? `[json-to-docx] ${code}: ${message}` : message);
  }
}

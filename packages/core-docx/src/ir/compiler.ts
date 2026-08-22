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
import type {
  ListLevelConfig,
  ListMarkerFontConfig,
} from '../utils/numberingConfig';
import { containsUnsupportedSyntax, parseInline } from './inline';
import type { DocxFeature } from './features';
import {
  DOCX_IR_SCHEMA_VERSION,
  type DocxIR,
  type DocxIrAlignment,
  type DocxIrBlock,
  type DocxIrHeaderFooter,
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
  type DocxIrTable,
  type DocxIrTableCell,
  type DocxIrTableRow,
} from './types';
import {
  blockId,
  headerFooterBlockId,
  inchesToTwips,
  irColor,
  pointsToHalfPoints,
  pointsToTwips,
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
}

export function compileDocument(
  structure: ProcessedDocument,
  layout: LayoutPlan,
  warnings: GenerationWarning[] = []
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
  if (props.numbering === true) {
    ctx.unsupported.push({
      name: 'heading',
      path,
      detail: 'numbering',
    });
    return [];
  }

  const level = headingLevel(props.level);
  const children = compileRuns(props, text, ctx, path);

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
        parseInline(text, { base: {} }),
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
    ...(options.styleId ? { styleId: options.styleId } : {}),
    ...(options.formatting ? { formatting: options.formatting } : {}),
    ...(options.numberingNone
      ? { numbering: { reference: '', level: 0, none: true } }
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
  path: string
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

  children.push(
    ...parseInline(text, {
      base,
      ...(props.boldColor
        ? { boldColor: irColor(resolveColor(props.boldColor, ctx.theme)) }
        : {}),
      ...(words ? { noProofWords: words } : {}),
    })
  );

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

function compileImage(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  scope.ctx.unsupported.push({ name: 'image', path: scope.path });
  return [];
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

function compileTable(
  component: ComponentDefinition,
  scope: ComponentScope
): DocxIrBlock[] {
  scope.ctx.unsupported.push({ name: 'table', path: scope.path });
  return [];
}

/** Referenced once the table and image compilers land; keeps their types live. */
export type { DocxIrTable, DocxIrTableRow, DocxIrTableCell };

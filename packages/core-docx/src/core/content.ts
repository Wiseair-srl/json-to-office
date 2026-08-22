/**
 * Content Creation Functions
 * Pure functions for creating Word document elements without layout concerns
 */

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  ImageRun,
  PageBreak,
  WidthType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  ColumnBreak,
  TableLayoutType,
  VerticalAlign,
} from 'docx';
import type { ParagraphChild } from 'docx';
import {
  calculateImageDimensions,
  getImageBuffer,
  parseWidthValue,
  parseDimensionValue,
  detectImageType,
  createTypedImageRun,
  resolveImageSource,
} from '../utils/imageUtils';
import { ThemeConfig } from '../styles';
import { getTableStyle } from '../styles';
import { getThemeColors, getThemeFonts } from '../themes/defaults';
import {
  parseTextWithDecorators,
  splitByNoProofWords,
  hasCrossReference,
} from '../utils/textParser';
import {
  processTextWithPlaceholders,
  type PlaceholderChild,
} from '../utils/placeholderProcessor';
import { normalizeUnicodeText } from '../utils/unicode';
import { getStyleIdForLevel } from '../styles/themeToDocxAdapter';
import {
  globalBookmarkRegistry,
  createBookmarkedContent,
} from '../utils/bookmarkRegistry';
import {
  createMarkedTextRuns,
  createRevisionMark,
  createRevisionRuns,
} from '../utils/revisionUtils';
import { openCommentRange, closeCommentRange } from '../utils/commentAnchors';
import { createNoteResolver } from '../utils/noteResolver';
import {
  resolveTableModel,
  type ResolvedBorder,
  type ResolvedCell,
  type TableSource,
} from './tableModel';
import type {
  Comment,
  Note,
  Revision,
  RevisionMark,
} from '@json-to-office/shared-docx';
import { resolveFontFamily } from '../styles/utils/styleHelpers';
import { synthesizeFamilyName } from '@json-to-office/shared';
import {
  ComponentDefinition,
  isParagraphComponent,
  ParagraphComponentDefinition,
  isImageComponent,
  ImageComponentDefinition,
} from '../types';
import { resolveColor } from '../styles/utils/colorUtils';
import {
  pointsToTwips,
  convertLineSpacing as convertLineSpacingToDocx,
} from '../styles/utils/styleHelpers';
import {
  resolveOffsetTwips,
  getPageWidthTwips,
  getPageHeightTwips,
  getAvailableWidthTwips,
  getAvailableHeightTwips,
} from '../utils/widthUtils';

/**
 * Resolve (family, bold, italic, fontWeight) into the values the docx lib
 * should receive. For non-RIBBI weights (anything other than 400/700),
 * rewrite the family to the canonical sub-family name (e.g. "Inter Light")
 * so Word / LibreOffice can resolve the matching installed face.
 * `bold: true` without fontWeight is shorthand for weight 700.
 */
function applyFontWeightAlias(opts: {
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: number;
}): { font?: string; bold?: boolean; italics?: boolean } {
  if (!opts.fontFamily) {
    return { font: undefined, bold: opts.bold, italics: opts.italic };
  }
  const weight = opts.fontWeight ?? (opts.bold === true ? 700 : undefined);
  const synth = synthesizeFamilyName(
    opts.fontFamily,
    weight,
    opts.italic === true
  );
  return { font: synth.family, bold: synth.bold, italics: synth.italic };
}

/**
 * Combine the document-level known-words allowlist (carried on the theme) with
 * any component-level list, de-duplicated. Returns undefined when empty.
 */
function resolveNoProofWords(
  theme: ThemeConfig,
  optionWords?: string[]
): string[] | undefined {
  const themeWords = theme.noProofWords;
  const merged = [...(themeWords || []), ...(optionWords || [])];
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

export interface TextOptions {
  style?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
  lineSpacing?:
    | number
    | {
        type: 'single' | 'atLeast' | 'exactly' | 'double' | 'multiple';
        value?: number;
      };
  boldColor?: string;
  columnBreak?: boolean;
  // Font properties
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  /**
   * Per-run weight (100–900). Renderer picks the closest embedded variant
   * via the font-alias registry and emits the run under a synthetic family
   * (e.g. "Inter Light" for 300). Overrides `bold` when set.
   */
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  // Character width scaling in percent (w:w). 100 is normal.
  scale?: number;
  // Letter tracking (w:spacing) — value in twentieths of a point.
  characterSpacing?: { type: 'condensed' | 'expanded'; value: number };
  // Per-run language (BCP-47) for spell/grammar checking. Overrides the
  // document default for these runs.
  language?: string;
  // Disable spell/grammar checking for these runs
  noProof?: boolean;
  // Known-words allowlist: whole-word occurrences are emitted as no-proof runs.
  // Merged with any document-level list carried on the theme.
  noProofWords?: string[];
  // Additional children to prepend (e.g., bookmarks)
  prependChildren?: any[];
  // Outline level for TOC
  outlineLevel?: number;
  /**
   * Paragraph-level numbering (`w:numPr`). `false` is the explicit opt-out
   * docx writes as numId 0 — the only way a single heading escapes a numbering
   * turned on for every heading through componentDefaults.
   */
  numbering?: { reference: string; level: number } | false;
  // Bookmark ID for internal linking
  bookmarkId?: string;
  // Floating frame properties
  floating?: {
    horizontalPosition?: {
      relative?: 'margin' | 'page' | 'text';
      align?: 'left' | 'center' | 'right' | 'inside' | 'outside';
      offset?: number | string;
    };
    verticalPosition?: {
      relative?: 'margin' | 'page' | 'text';
      align?: 'top' | 'center' | 'bottom' | 'inside' | 'outside' | 'inline';
      offset?: number | string;
    };
    wrap?: {
      type: 'around' | 'none' | 'notBeside' | 'through' | 'tight' | 'auto';
    };
    lockAnchor?: boolean;
    width?: number;
    height?: number;
  };
  // Keep paragraph with next paragraph
  keepNext?: boolean;
  // Keep all lines of paragraph together
  keepLines?: boolean;
  // Paragraph indentation (w:ind) in twips. hanging and firstLine are
  // mutually exclusive (validated upstream).
  indent?: {
    left?: number;
    right?: number;
    hanging?: number;
    firstLine?: number;
  };
  // Tab stops (w:tabs). Tab characters (\t) in text jump to these positions.
  tabStops?: {
    type: 'left' | 'right' | 'center' | 'decimal' | 'bar';
    position: number;
    leader?: 'dot' | 'hyphen' | 'underscore' | 'middleDot' | 'none';
  }[];
  // Tracked-change segments: when present, text is rendered from these
  // (as native Word revisions) instead of the plain content string
  revision?: Revision;
  // Review comment anchored to this text. The text itself is unchanged; the
  // runs are wrapped in a comment range and followed by a reference.
  comment?: Comment;
  // Note bodies bound to `[^id]` markers in this text. Without them a marker
  // is left as literal text.
  footnotes?: readonly Note[];
  endnotes?: readonly Note[];
}

export interface ImageOptions {
  caption?: string;
  width?: number | string;
  height?: number | string;
  widthRelativeTo?: 'content' | 'page';
  heightRelativeTo?: 'content' | 'page';
  alignment?: 'left' | 'center' | 'right';
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
  floating?: {
    horizontalPosition?: {
      relative?: 'character' | 'column' | 'margin' | 'page' | 'text';
      align?: 'left' | 'center' | 'right' | 'inside' | 'outside';
      offset?: number | string;
    };
    verticalPosition?: {
      relative?: 'margin' | 'page' | 'paragraph' | 'line' | 'text';
      align?: 'top' | 'center' | 'bottom' | 'inside' | 'outside';
      offset?: number | string;
    };
    wrap?: {
      // 'tight', 'around', 'through' are VML-style; only 'none', 'square', 'topAndBottom' are supported for images
      type: 'none' | 'square' | 'topAndBottom' | 'around' | 'tight' | 'through';
      side?: 'bothSides' | 'left' | 'right' | 'largest';
      margins?: {
        top?: number | string;
        bottom?: number | string;
        left?: number | string;
        right?: number | string;
      };
    };
    allowOverlap?: boolean;
    behindDocument?: boolean;
    lockAnchor?: boolean;
    layoutInCell?: boolean;
    zIndex?: number;
    rotation?: number;
    visibility?: 'hidden' | 'inherit';
  };
  // Keep paragraph with next paragraph
  keepNext?: boolean;
  // Keep all lines of paragraph together
  keepLines?: boolean;
}

export interface TableOptions {
  style?: 'minimal' | 'classic' | 'minimal';
}

export interface StatisticData {
  number: string;
  description: string;
  alignment?: 'left' | 'center' | 'right';
}

export interface StatisticOptions {
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
}

export interface ListOptions {
  // Reference to the numbering configuration in the Document
  numberingReference?: string;
  // Review comment spanning the whole list: the range opens on the first
  // rendered item and closes on the last.
  comment?: Comment;
  // Note bodies bound to `[^id]` markers in the item text.
  footnotes?: readonly Note[];
  endnotes?: readonly Note[];
  spacing?: {
    before?: number; // in points
    after?: number; // in points
    item?: number; // in points
  };
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

/**
 * Warn when a paragraph declares notes but renders through the revision path,
 * where markers cannot resolve.
 *
 * Supporting note references inside tracked-change runs would mean threading
 * the resolver through `createRevisionRuns` and deciding what an inserted or
 * deleted reference even means on accept/reject. Until that exists, the
 * combination is announced rather than swallowed.
 */
function reportNotesUnsupportedInRevision(
  footnotes: readonly Note[] | undefined,
  endnotes: readonly Note[] | undefined,
  revision: Revision
): void {
  const declared = [...(footnotes ?? []), ...(endnotes ?? [])];
  if (declared.length === 0) return;

  const text = revision.segments.map((segment) => segment.text).join('');
  const referenced = declared.filter((note) => text.includes(`[^${note.id}]`));
  console.warn(
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

/**
 * Wrap paragraph children in a comment range, or return them untouched when
 * there is no comment.
 *
 * Empty `children` is deliberately allowed: a comment on an empty table cell
 * anchors as a zero-length range plus its reference, which is what Word writes
 * for a comment on an empty selection. Dropping the comment instead would lose
 * both the anchor and the body.
 */
function wrapInComment(
  children: ParagraphChild[],
  comment: Comment | undefined
): ParagraphChild[] {
  const anchor = openCommentRange(comment);
  if (!anchor) return children;
  return [...anchor.start, ...children, ...closeCommentRange(anchor.ids)];
}

/**
 * Create a text paragraph
 */
export function createText(
  content: string,
  theme: ThemeConfig,
  themeName: string,
  options: TextOptions = {}
): Paragraph {
  const normalizedContent = normalizeUnicodeText(content);
  // Always use Normal style for consistent formatting
  const style = options.style || 'Normal';

  // Convert points to twips for spacing
  const spacing: any = {};
  if (options.spacing?.before !== undefined) {
    spacing.before = pointsToTwips(options.spacing.before);
  }
  if (options.spacing?.after !== undefined) {
    spacing.after = pointsToTwips(options.spacing.after);
  }
  // Add line spacing if provided
  const lineSpacingConfig = convertLineSpacingToDocx(options.lineSpacing);
  if (lineSpacingConfig) {
    spacing.line = lineSpacingConfig.line;
    spacing.lineRule = lineSpacingConfig.lineRule;
  }

  // Build children array
  const children: ParagraphChild[] = [];

  // Add column break if requested
  if (options.columnBreak) {
    children.push(new ColumnBreak());
  }

  // Open the comment range before the text runs so the anchor covers exactly
  // the commented content (and not a preceding column break).
  const commentAnchor = openCommentRange(options.comment);
  if (commentAnchor) {
    children.push(...commentAnchor.start);
  }

  // Resolve the effective family so fontWeight can be aliased even when the
  // run relies on the theme's body font (no inline `family` override). Without
  // this, `{ font: { fontWeight: 300 } }` would fall through with no family
  // for the alias registry to look up.
  const hasWeightRequest = options.fontWeight != null || options.bold === true;
  const effectiveFamily =
    options.fontFamily ??
    (hasWeightRequest ? resolveFontFamily(theme, 'body') : undefined);
  const weighted = applyFontWeightAlias({
    fontFamily: effectiveFamily,
    bold: options.bold,
    italic: options.italic,
    fontWeight: options.fontWeight,
  });
  const baseTextStyle = {
    // Only emit `font` when it came from the caller or from an alias —
    // emitting the theme body family on every run would be a behavior change.
    ...((options.fontFamily ||
      (weighted.font && weighted.font !== effectiveFamily)) && {
      font: weighted.font,
    }),
    ...(options.fontSize && { size: options.fontSize * 2 }), // Convert points to half-points
    ...(options.fontColor && {
      color: resolveColor(options.fontColor, theme),
    }),
    ...(weighted.bold !== undefined && { bold: weighted.bold }),
    ...(weighted.italics !== undefined && { italics: weighted.italics }),
    ...(options.underline !== undefined && {
      underline: options.underline ? { type: 'single' as const } : undefined,
    }),
    // Character width scaling in percent (w:w)
    ...(options.scale && { scale: options.scale }),
    // Letter tracking (w:spacing, twentieths of a point; negative = condensed)
    ...(options.characterSpacing && {
      characterSpacing:
        options.characterSpacing.type === 'condensed'
          ? -options.characterSpacing.value
          : options.characterSpacing.value,
    }),
    // Proofing: per-run language and/or no-proof. Omitting language lets the
    // run inherit the document default set on docDefaults.
    ...(options.language && { language: { value: options.language } }),
    ...(options.noProof !== undefined && { noProof: options.noProof }),
  };

  if (options.revision) {
    // Tracked changes: render revision segments as native w:ins/w:del runs
    // (literal text, no markdown parsing). Bookmarks are preserved so
    // internal hyperlinks targeting this paragraph keep working.
    //
    // Revision segments render literally, so a `[^id]` marker inside them stays
    // literal text and its body is never emitted. Report that rather than
    // dropping the declared notes in silence.
    reportNotesUnsupportedInRevision(
      options.footnotes,
      options.endnotes,
      options.revision
    );
    const revisionRuns = createRevisionRuns(options.revision, baseTextStyle);
    if (options.bookmarkId) {
      globalBookmarkRegistry.register(
        options.bookmarkId,
        normalizedContent,
        'paragraph'
      );
      children.push(
        ...createBookmarkedContent(options.bookmarkId, revisionRuns)
      );
    } else {
      children.push(...revisionRuns);
    }
  } else {
    // Note bodies reach word/footnotes.xml or word/endnotes.xml only when a
    // marker resolves to them, so the resolver is built once per paragraph,
    // consulted by the parser as it walks the text, and asked afterwards what
    // went unused.
    const noteResolver = createNoteResolver(
      options.footnotes,
      options.endnotes
    );

    // Add text content - parseTextWithDecorators handles both decorators and newlines
    const textRuns = parseTextWithDecorators(normalizedContent, baseTextStyle, {
      boldColor: options.boldColor
        ? resolveColor(options.boldColor, theme)
        : undefined,
      enableHyperlinks: true,
      noProofWords: resolveNoProofWords(theme, options.noProofWords),
      noteRef: noteResolver?.resolve,
    });
    noteResolver?.reportUnemitted(normalizedContent);

    // If bookmarkId is provided, wrap text runs in a bookmark
    if (options.bookmarkId) {
      // Register bookmark
      globalBookmarkRegistry.register(
        options.bookmarkId,
        normalizedContent,
        'paragraph'
      );

      // Wrap text runs in bookmark
      children.push(...createBookmarkedContent(options.bookmarkId, textRuns));
    } else {
      // No bookmark, add text runs directly
      children.push(...textRuns);
    }
  }

  if (commentAnchor) {
    children.push(...closeCommentRange(commentAnchor.ids));
  }

  // Build frame options for floating text
  const isFloating = !!options.floating;
  const frameOptions =
    isFloating && options.floating
      ? mapFrameOptions(options.floating, theme, themeName)
      : undefined;

  return new Paragraph({
    children,
    style,
    alignment: options.alignment ? getAlignment(options.alignment) : undefined,
    spacing,
    ...(options.outlineLevel !== undefined && {
      outlineLevel: options.outlineLevel,
    }),
    ...(frameOptions && { frame: frameOptions }),
    ...(options.keepNext !== undefined && { keepNext: options.keepNext }),
    ...(options.keepLines !== undefined && { keepLines: options.keepLines }),
    ...(options.indent && { indent: options.indent }),
    ...(options.tabStops &&
      options.tabStops.length > 0 && { tabStops: options.tabStops }),
  });
}

/**
 * Map floating frame configuration to docx.js IFrameOptions
 * IFrameOptions can be either IXYFrameOptions (absolute positioning) or IAlignmentFrameOptions (aligned positioning)
 *
 * Supports mixed positioning: alignment on one axis, offset on the other.
 * When mixing, calculates the position for the aligned axis.
 */
function mapFrameOptions(
  floating: NonNullable<TextOptions['floating']>,
  theme?: ThemeConfig,
  themeName?: string
): any {
  const hasHorizontalOffset = floating.horizontalPosition?.offset !== undefined;
  const hasVerticalOffset = floating.verticalPosition?.offset !== undefined;
  const hasHorizontalAlign = floating.horizontalPosition?.align !== undefined;
  const hasVerticalAlign = floating.verticalPosition?.align !== undefined;

  // Choose exactly one mode: absolute if any offset is present; otherwise alignment
  const useAbsolute = hasHorizontalOffset || hasVerticalOffset;

  // Base frame options
  const frameWidth = floating.width || 2880; // 2in default
  const frameHeight = floating.height || 1440; // 1in default

  const baseOptions: any = {
    width: frameWidth,
    height: frameHeight,
    anchor: {
      horizontal: floating.horizontalPosition?.relative || 'page',
      vertical: floating.verticalPosition?.relative || 'page',
    },
  };

  if (floating.wrap?.type) {
    baseOptions.wrap = floating.wrap.type;
  }

  // Config lockAnchor maps to docx anchorLock
  if (floating.lockAnchor !== undefined) {
    baseOptions.anchorLock = floating.lockAnchor;
  } else if ((floating as any).anchorLock !== undefined) {
    baseOptions.anchorLock = (floating as any).anchorLock;
  }

  if (useAbsolute) {
    const rawX = floating.horizontalPosition?.offset ?? 0;
    const rawY = floating.verticalPosition?.offset ?? 0;
    let x: number;
    let y: number;
    if (typeof rawX === 'string' || typeof rawY === 'string') {
      const hRelative = floating.horizontalPosition?.relative;
      const vRelative = floating.verticalPosition?.relative;
      const hRef =
        hRelative && hRelative !== 'page'
          ? getAvailableWidthTwips(theme, themeName)
          : getPageWidthTwips(theme, themeName);
      const vRef =
        vRelative && vRelative !== 'page'
          ? getAvailableHeightTwips(theme, themeName)
          : getPageHeightTwips(theme, themeName);
      x = resolveOffsetTwips(rawX, hRef);
      y = resolveOffsetTwips(rawY, vRef);
    } else {
      x = rawX;
      y = rawY;
    }
    return {
      type: 'absolute',
      position: { x, y },
      ...baseOptions,
    };
  }

  // Alignment positioning: use provided aligns; default missing axis
  const xAlign = hasHorizontalAlign
    ? floating.horizontalPosition!.align!
    : 'left';
  const yAlign = hasVerticalAlign ? floating.verticalPosition!.align! : 'top';
  return {
    type: 'alignment',
    alignment: { x: xAlign, y: yAlign },
    ...baseOptions,
  };
}

/**
 * Create a header paragraph
 */
export function createHeading(
  text: string,
  level: number,
  theme: ThemeConfig,
  _themeName: string,
  options: TextOptions = {}
): Paragraph {
  const normalizedText = normalizeUnicodeText(text);
  const styleId = getStyleIdForLevel(level);

  // Only apply spacing if explicitly provided in options
  // This allows theme style spacing to be used by default
  const spacing: any = {};
  let hasExplicitSpacing = false;

  if (options.spacing?.before !== undefined) {
    spacing.before = pointsToTwips(options.spacing.before);
    hasExplicitSpacing = true;
  }
  if (options.spacing?.after !== undefined) {
    spacing.after = pointsToTwips(options.spacing.after);
    hasExplicitSpacing = true;
  }
  // Add line spacing if provided
  const lineSpacingConfig = convertLineSpacingToDocx(options.lineSpacing);
  if (lineSpacingConfig) {
    spacing.line = lineSpacingConfig.line;
    spacing.lineRule = lineSpacingConfig.lineRule;
    hasExplicitSpacing = true;
  }

  // Build children array
  const children: any[] = [];

  // Add prepended children first (e.g., bookmarks)
  if (options.prependChildren) {
    children.push(...options.prependChildren);
  }

  // Add column break if requested
  if (options.columnBreak) {
    children.push(new ColumnBreak());
  }

  // Open the comment range around the heading text only.
  const commentAnchor = openCommentRange(options.comment);
  if (commentAnchor) {
    children.push(...commentAnchor.start);
  }

  // Anything the inline parser has to see: markdown decorators, or a `[@id]`
  // cross-reference. Simple headings take the cheaper run builder below, which
  // treats every character as literal text.
  const hasInlineSyntax =
    /(\*\*\*|___|(\*\*|__)|(\*|_))/.test(normalizedText) ||
    hasCrossReference(normalizedText);

  // Headings default to theme.fonts.heading when no explicit family is given.
  // Resolve it so fontWeight can be aliased through the same path as body runs.
  const headingHasWeightRequest =
    options.fontWeight != null || options.bold === true;
  const headingEffectiveFamily =
    options.fontFamily ??
    (headingHasWeightRequest ? resolveFontFamily(theme, 'heading') : undefined);
  const headingWeighted = applyFontWeightAlias({
    fontFamily: headingEffectiveFamily,
    bold: options.bold,
    italic: options.italic,
    fontWeight: options.fontWeight,
  });
  // Build base text style from options (overrides theme style at run level)
  const baseTextStyle = {
    ...((options.fontFamily ||
      (headingWeighted.font &&
        headingWeighted.font !== headingEffectiveFamily)) && {
      font: headingWeighted.font,
    }),
    ...(options.fontSize && { size: options.fontSize * 2 }), // points to half-points
    ...(options.fontColor && { color: resolveColor(options.fontColor, theme) }),
    ...(headingWeighted.bold !== undefined && { bold: headingWeighted.bold }),
    ...(headingWeighted.italics !== undefined && {
      italics: headingWeighted.italics,
    }),
    ...(options.underline !== undefined && {
      underline: options.underline ? { type: 'single' as const } : undefined,
    }),
    // Character width scaling in percent (w:w)
    ...(options.scale && { scale: options.scale }),
    // Letter tracking (w:spacing, twentieths of a point; negative = condensed)
    ...(options.characterSpacing && {
      characterSpacing:
        options.characterSpacing.type === 'condensed'
          ? -options.characterSpacing.value
          : options.characterSpacing.value,
    }),
    // Proofing: per-run language and/or no-proof (see createText).
    ...(options.language && { language: { value: options.language } }),
    ...(options.noProof !== undefined && { noProof: options.noProof }),
  };

  // Known-words allowlist (document + component) and a run builder that marks
  // matched words as no-proof. Used by the simple (no-decorator) heading paths;
  // the decorator paths route through parseTextWithDecorators instead.
  const headingNoProofWords = resolveNoProofWords(theme, options.noProofWords);
  const makeHeadingRuns = (value: string): TextRun[] =>
    splitByNoProofWords(
      value,
      (segment, matched) =>
        new TextRun({
          text: segment,
          ...baseTextStyle,
          ...(matched && { noProof: true }),
        }),
      headingNoProofWords
    );

  if (options.revision) {
    // Tracked changes: revision segments replace text rendering. The TOC
    // bookmark is preserved so TOC links and cross-references keep working.
    const revisionRuns = createRevisionRuns(options.revision, baseTextStyle);
    if (options.bookmarkId) {
      globalBookmarkRegistry.register(
        options.bookmarkId,
        normalizedText,
        'heading'
      );
      children.push(
        ...createBookmarkedContent(options.bookmarkId, revisionRuns)
      );
    } else {
      children.push(...revisionRuns);
    }
  } else if (options.bookmarkId) {
    // Register bookmark
    globalBookmarkRegistry.register(
      options.bookmarkId,
      normalizedText,
      'heading'
    );

    // Wrap heading text in bookmark
    const headingTextChildren: (TextRun | any)[] = [];

    if (hasInlineSyntax) {
      // For headings with decorators, parse text runs first
      const textRuns = parseTextWithDecorators(normalizedText, baseTextStyle, {
        boldColor: options.boldColor
          ? resolveColor(options.boldColor, theme)
          : undefined,
        enableHyperlinks: true,
        noProofWords: headingNoProofWords,
      });
      headingTextChildren.push(...textRuns);
    } else {
      // For simple headings, add single text run (split on known words)
      headingTextChildren.push(...makeHeadingRuns(normalizedText));
    }

    // Wrap in bookmark
    children.push(
      ...createBookmarkedContent(options.bookmarkId, headingTextChildren)
    );
  } else {
    // No bookmark, add text directly
    if (hasInlineSyntax) {
      // For headings with decorators, parse and add text runs
      const textRuns = parseTextWithDecorators(normalizedText, baseTextStyle, {
        boldColor: options.boldColor
          ? resolveColor(options.boldColor, theme)
          : undefined,
        enableHyperlinks: true,
        noProofWords: headingNoProofWords,
      });
      children.push(...textRuns);
    } else {
      // For simple headings, add single text run (split on known words)
      children.push(...makeHeadingRuns(normalizedText));
    }
  }

  if (commentAnchor) {
    children.push(...closeCommentRange(commentAnchor.ids));
  }

  return new Paragraph({
    children,
    style: styleId,
    alignment: getAlignment(options.alignment || 'left'),
    // Only override spacing if explicitly provided
    spacing: hasExplicitSpacing ? spacing : undefined,
    ...(options.keepNext !== undefined && { keepNext: options.keepNext }),
    ...(options.keepLines !== undefined && { keepLines: options.keepLines }),
    ...(options.indent && { indent: options.indent }),
    // docx creates the concrete numbering instance for the reference itself,
    // in ParagraphProperties.prepForXml.
    ...(options.numbering !== undefined && { numbering: options.numbering }),
  });
}

/**
 * Create title page content
 */
export function createTitleContent(
  title?: string,
  subtitle?: string
): Paragraph[] {
  // If no title, return empty array (skip title section entirely)
  if (!title) {
    return [];
  }

  const normalizedTitle = normalizeUnicodeText(title);
  const elements: Paragraph[] = [];

  elements.push(
    new Paragraph({
      text: normalizedTitle,
      style: 'Title',
    })
  );

  if (subtitle) {
    const normalizedSubtitle = normalizeUnicodeText(subtitle);
    elements.push(
      new Paragraph({
        text: normalizedSubtitle,
        style: 'Subtitle',
      })
    );
  }

  elements.push(new Paragraph({ children: [new PageBreak()] }));

  return elements;
}

/**
 * Create an image with optional caption
 */
export async function createImage(
  path: string,
  theme: ThemeConfig,
  themeName?: string,
  options: ImageOptions = {}
): Promise<Paragraph[]> {
  const elements: Paragraph[] = [];
  const isFloating = !!options.floating;
  const alignment = isFloating
    ? undefined
    : getAlignment(options.alignment || 'center');

  let imagePath = path;
  let imageBuffer: Buffer;
  let responseContentType: string | undefined;

  try {
    // Try to use the provided path first
    const imageResult = await getImageBuffer(imagePath);
    imageBuffer = imageResult.buffer;
    responseContentType = imageResult.contentType;

    // Calculate available document width/height for percentage calculations
    const {
      getAvailableWidthTwips,
      getPageWidthTwips,
      getAvailableHeightTwips,
      getPageHeightTwips,
    } = await import('../utils/widthUtils');
    const widthRef = options.widthRelativeTo || 'content';
    const heightRef = options.heightRelativeTo || 'content';
    const availableWidthTwips =
      widthRef === 'page'
        ? getPageWidthTwips(theme)
        : getAvailableWidthTwips(theme);
    const availableHeightTwips =
      heightRef === 'page'
        ? getPageHeightTwips(theme)
        : getAvailableHeightTwips(theme);
    // Convert twips to pixels: 1 twip = 1/1440 inch, 1 inch = 96 pixels (screen DPI)
    const availableWidthPx = Math.round((availableWidthTwips / 1440) * 96);
    const availableHeightPx = Math.round((availableHeightTwips / 1440) * 96);

    // Default size calculations (fallback)
    const columnWidthCm = 7.36;
    const pixelsPerCm = 37.795275591;
    const columnWidthPx = Math.round(columnWidthCm * pixelsPerCm);
    const fallbackHeight = Math.round(columnWidthPx * 0.6);

    // Parse width value (handles both number and percentage string)
    // Default to 100% if no width is specified
    const parsedWidth = parseWidthValue(
      options.width ?? '100%',
      availableWidthPx
    );

    // Parse height value if provided
    const parsedHeight =
      options.height !== undefined
        ? parseDimensionValue(options.height, availableHeightPx)
        : undefined;

    // Calculate dimensions with aspect ratio preservation
    const dimensions = await calculateImageDimensions(
      imagePath,
      parsedWidth,
      parsedHeight,
      columnWidthPx,
      fallbackHeight
    );

    // Build ImageRun configuration with optional floating
    const { mapFloatingOptions } = await import(
      '../utils/docxImagePositioning'
    );
    const floating = isFloating
      ? mapFloatingOptions(options.floating, theme, themeName)
      : undefined;

    // Detect image type from response Content-Type, path, or base64 data URI
    const imageType = detectImageType(imagePath, responseContentType);

    // Create ImageRun based on image type
    const imageRun = await createTypedImageRun({
      type: imageType,
      data: imageBuffer,
      transformation: { width: dimensions.width, height: dimensions.height },
      ...(floating && { floating }),
    });

    // Convert spacing from points to twips
    const spacing: any = {};
    if (options.spacing?.before !== undefined) {
      spacing.before = pointsToTwips(options.spacing.before);
    }
    if (options.spacing?.after !== undefined) {
      spacing.after = pointsToTwips(options.spacing.after);
    }

    elements.push(
      new Paragraph({
        children: [imageRun],
        alignment,
        ...(Object.keys(spacing).length > 0 && { spacing }),
        ...(options.keepNext !== undefined && { keepNext: options.keepNext }),
        ...(options.keepLines !== undefined && {
          keepLines: options.keepLines,
        }),
      })
    );
  } catch (error) {
    // If the image cannot be loaded, try the placeholder
    throw new Error(`Failed to load image from ${imagePath}`);
  }

  if (options.caption) {
    // Check if caption has decorators (bold/italic markers)
    const hasDecorators = /(\*\*\*|___|(\*\*|__)|(\*|_))/.test(options.caption);

    if (!hasDecorators) {
      // No decorators - use Normal style for font inheritance
      elements.push(
        new Paragraph({
          text: normalizeUnicodeText(options.caption),
          style: 'Normal',
          alignment: AlignmentType.LEFT, // Captions default to left alignment
        })
      );
    } else {
      // Has decorators - use parseTextWithDecorators (same as text component)
      const textRuns = parseTextWithDecorators(
        options.caption,
        {},
        {
          enableHyperlinks: true,
        }
      );

      elements.push(
        new Paragraph({
          children: textRuns,
          style: 'Normal', // Use Normal style for consistent font inheritance
          alignment: AlignmentType.LEFT, // Captions default to left alignment
        })
      );
    }
  }

  return elements;
}

/**
 * Create a statistic display
 */
export function createStatistic(
  data: StatisticData,
  options: StatisticOptions = {}
): Paragraph[] {
  const alignment = getAlignment(data.alignment || 'center');
  const normalizedNumber = normalizeUnicodeText(data.number);
  const normalizedDescription = normalizeUnicodeText(data.description);

  return [
    new Paragraph({
      text: normalizedNumber,
      style: 'StatisticNumber',
      alignment,
      spacing: options.spacing,
    }),
    new Paragraph({
      text: normalizedDescription,
      style: 'StatisticDescription',
      alignment,
    }),
  ];
}

/**
 * Create a list of items using proper docx numbering
 */
export function createList(
  items: (
    | string
    | { text: string; level?: number; id?: string; revision?: Revision }
  )[],
  _theme: ThemeConfig,
  _themeName: string,
  options: ListOptions = {}
): Paragraph[] {
  if (!items || items.length === 0) {
    return [];
  }

  const paragraphs: Paragraph[] = [];

  // A list-level comment spans the whole list, so its range opens on the first
  // paragraph that actually renders and closes on the last. Empty items are
  // skipped below, so neither end can be read off the item index — and docx
  // copies `children` at construction, so both ends must be known up front.
  // One resolver for the whole list: ids are declared on the list, and markers
  // may appear in any item.
  const noteResolver = createNoteResolver(options.footnotes, options.endnotes);

  const rendersAt = items.map((item) => {
    const text = typeof item === 'string' ? item : item.text;
    const revision = typeof item === 'object' ? item.revision : undefined;
    return Boolean(text.trim()) || Boolean(revision);
  });
  const firstRendered = rendersAt.indexOf(true);
  const lastRendered = rendersAt.lastIndexOf(true);
  const commentAnchor =
    firstRendered === -1 ? undefined : openCommentRange(options.comment);

  items.forEach((item, index) => {
    // Handle both string and object items
    const itemText = typeof item === 'string' ? item : item.text;
    const itemLevel = typeof item === 'object' ? item.level || 0 : 0;
    const itemRevision = typeof item === 'object' ? item.revision : undefined;

    // Skip empty items — unless they carry revision data (a fully deleted
    // item has empty new text but must still render its w:del runs)
    if (!itemText.trim() && !itemRevision) {
      return;
    }

    // Parse rich text decorators for each item
    // Don't pass font/size/color - let list items inherit from Normal paragraph style
    const textRuns = itemRevision
      ? createRevisionRuns(itemRevision, {})
      : parseTextWithDecorators(
          itemText,
          {},
          {
            enableHyperlinks: true,
            noteRef: noteResolver?.resolve,
          }
        );

    // Calculate spacing for this item (convert points to twips)
    const spacing: { before?: number; after?: number } = {};
    if (index === 0 && options.spacing?.before) {
      spacing.before = pointsToTwips(options.spacing.before);
    }
    if (index === items.length - 1 && options.spacing?.after) {
      spacing.after = pointsToTwips(options.spacing.after);
    } else if (options.spacing?.item) {
      spacing.after = pointsToTwips(options.spacing.item);
    }

    // A bookmarked item is a cross-reference target (`[@id]`) and an internal
    // link target. The bookmark wraps the text runs only — the comment range
    // stays outside it, as it does on a heading.
    const itemId = typeof item === 'object' ? item.id : undefined;
    let itemContent: ParagraphChild[] = textRuns;
    if (itemId) {
      globalBookmarkRegistry.register(itemId, itemText, 'list-item');
      itemContent = createBookmarkedContent(itemId, textRuns);
    }

    // Create the paragraph with proper numbering reference
    const paragraphChildren: ParagraphChild[] = [
      ...(commentAnchor && index === firstRendered ? commentAnchor.start : []),
      ...itemContent,
      ...(commentAnchor && index === lastRendered
        ? closeCommentRange(commentAnchor.ids)
        : []),
    ];

    const paragraph = new Paragraph({
      style: 'Normal', // Apply Normal style for font inheritance
      children: paragraphChildren,
      alignment: options.alignment
        ? getAlignment(options.alignment)
        : AlignmentType.LEFT,
      spacing,
      // Use proper docx numbering instead of prepending text
      ...(options.numberingReference && {
        numbering: {
          reference: options.numberingReference,
          level: itemLevel,
        },
      }),
    });

    paragraphs.push(paragraph);
  });

  noteResolver?.reportUnemitted(
    items
      .map((item) => (typeof item === 'string' ? item : item.text))
      .join('\n')
  );

  return paragraphs;
}

/**
 * Create a table.
 *
 * Every cascade — cell over column over table, per border side — is resolved by
 * `resolveTableModel`, which the DocxIR compiler shares. What is left here is
 * the translation into docx objects plus the one thing the model cannot do:
 * turning cell content into runs, which may have to load an image.
 */
export type { TableSource as TableConfigSource } from './tableModel';

export async function createTable(
  columns: TableSource<Comment, Revision, RevisionMark>['columns'],
  tableConfig: TableSource<Comment, Revision, RevisionMark>,
  theme: ThemeConfig,
  themeName: string,
  _options: TableOptions = {}
): Promise<Table> {
  // Note: _options parameter is available for future table customization
  const tableStyle = getTableStyle(theme, themeName);

  // No warning collector reaches createTable (the render path passes only
  // theme/themeName), so use the prefixed console.warn fallback the generator
  // uses when no collector is present. Deduped so a column of cells sharing the
  // same bad value warns once per table.
  const warned = new Set<string>();
  const warn = (code: string, message: string): void => {
    if (warned.has(message)) return;
    warned.add(message);
    // eslint-disable-next-line no-console
    console.warn(`[json-to-docx] ${code}: ${message}`);
  };

  const model = resolveTableModel<Comment, Revision, RevisionMark>(
    { ...tableConfig, columns },
    theme,
    themeName,
    { onWarning: warn }
  );

  if (model.overflow) {
    // eslint-disable-next-line no-console
    console.warn(
      `[json-to-office] Column widths total (${model.overflow.totalTwips} twips) exceeds available table width (${model.overflow.availableTwips} twips). Table may overflow.`
    );
  }

  const createBorder = (border: ResolvedBorder) => {
    if (border.size === 0 || border.hidden) {
      return { style: BorderStyle.NONE, size: 0, color: '000000' };
    }
    return {
      style: BorderStyle.SINGLE,
      size: border.size * 8, // Convert points to eighths of a point
      color: border.color || '000000',
    };
  };

  const cellBorders = (cell: ResolvedCell<Comment, Revision>) => ({
    top: createBorder(cell.borders.top),
    bottom: createBorder(cell.borders.bottom),
    left: createBorder(cell.borders.left),
    right: createBorder(cell.borders.right),
  });

  const cellMargins = (cell: ResolvedCell<Comment, Revision>) =>
    cell.padding === undefined
      ? undefined
      : {
          marginUnitType: WidthType.DXA, // Specify that values are in twips
          top: cell.padding.top * 20,
          bottom: cell.padding.bottom * 20,
          left: cell.padding.left * 20,
          right: cell.padding.right * 20,
        };

  /**
   * Turn one cell's content into runs.
   *
   * `rowMark` is set when the whole row is inserted or deleted. The cell's own
   * text then renders as runs marked the same way: a `w:trPr/w:del` alone
   * leaves the text un-struck, and accepting the change would leave an empty
   * row rather than remove it.
   */
  // ParagraphChild rather than PlaceholderChild: a revised or commented cell
  // paragraph contributes w:ins / w:del and comment-range elements, which sit
  // outside the placeholder union.
  const processCellContent = async (
    cell: ResolvedCell<Comment, Revision>,
    baseCellStyle: typeof tableStyle.tableCell,
    rowMark?: RevisionMark
  ): Promise<ParagraphChild[]> => {
    let cellChildren: ParagraphChild[] = [];
    const content = cell.content;
    const { comment, revision } = cell;

    // Handle undefined or empty content. A comment on an empty cell still has
    // to anchor somewhere: Word writes a zero-length range plus the reference,
    // which is what `wrapInComment` produces for an empty child list.
    if (!content) {
      return wrapInComment(cellChildren, comment);
    }

    // Create merged style with config overrides
    const cellWeighted = applyFontWeightAlias({
      fontFamily: cell.font?.family || baseCellStyle.font,
      bold: cell.font?.bold ?? false,
      italic: cell.font?.italic ?? false,
      fontWeight: cell.font?.fontWeight,
    });
    const mergedStyle = {
      font: cellWeighted.font,
      size: cell.font?.size ? cell.font.size * 2 : baseCellStyle.size, // half-points
      bold: cellWeighted.bold ?? false,
      italics: cellWeighted.italics ?? false,
      underline: cell.font?.underline ? { type: 'single' as const } : undefined,
      color: cell.color || baseCellStyle.color,
    };

    if (
      typeof content === 'object' &&
      'name' in content &&
      'props' in content
    ) {
      // Handle ComponentDefinition
      if (isParagraphComponent(content)) {
        const textComp = content as ParagraphComponentDefinition;
        const paragraphFont = textComp.props.font;
        const paraWeighted = applyFontWeightAlias({
          fontFamily: paragraphFont?.family ?? mergedStyle.font,
          bold: paragraphFont?.bold,
          italic: paragraphFont?.italic,
          fontWeight: paragraphFont?.fontWeight,
        });
        const paragraphStyle = {
          ...mergedStyle,
          ...(paraWeighted.font && { font: paraWeighted.font }),
          ...(paragraphFont?.size && { size: paragraphFont.size * 2 }),
          ...(paraWeighted.bold !== undefined && {
            bold: paraWeighted.bold,
          }),
          ...(paraWeighted.italics !== undefined && {
            italics: paraWeighted.italics,
          }),
          ...(paragraphFont?.underline !== undefined && {
            underline: paragraphFont.underline
              ? { type: 'single' as const }
              : undefined,
          }),
          ...(paragraphFont?.color && {
            color: resolveColor(paragraphFont.color, theme),
          }),
        };
        // Tracked changes take the same revision-aware path createText uses:
        // segments render as native w:ins/w:del runs (literal text, no markdown
        // parsing) instead of being silently dropped in favour of props.text.
        const paragraphRevision = revision ?? textComp.props.revision;
        cellChildren = paragraphRevision
          ? createRevisionRuns(paragraphRevision, paragraphStyle)
          : rowMark
            ? createMarkedTextRuns(textComp.props.text, rowMark, paragraphStyle)
            : parseTextWithDecorators(textComp.props.text, paragraphStyle, {
                enableHyperlinks: true,
              });
      } else if (isImageComponent(content)) {
        const imageComp = content as ImageComponentDefinition;
        try {
          // Get image source (svg, base64, or path)
          const imageSource = resolveImageSource(imageComp.props);
          if (!imageSource) {
            throw new Error(
              'Image component requires one of "path", "base64", or "svg" property'
            );
          }

          // Read from local file, URL, or base64
          const imageResult = await getImageBuffer(imageSource);

          // Parse width value if it's a string percentage (like "90%")
          const parsedWidth =
            typeof imageComp.props.width === 'string'
              ? parseWidthValue(imageComp.props.width, 300) // Use a reasonable default for table context
              : imageComp.props.width;

          // Parse height value if it's a string percentage (like "90%")
          const parsedHeight =
            typeof imageComp.props.height === 'string'
              ? parseWidthValue(imageComp.props.height, 200) // Use a reasonable default for table context
              : imageComp.props.height;

          // Calculate dimensions with aspect ratio preservation
          const dimensions = await calculateImageDimensions(
            imageSource,
            parsedWidth,
            parsedHeight,
            60, // fallback width
            20 // fallback height
          );

          const imgType = detectImageType(imageSource, imageResult.contentType);
          const imageRun = await createTypedImageRun({
            type: imgType,
            data: imageResult.buffer,
            transformation: {
              width: dimensions.width,
              height: dimensions.height,
            },
          });
          cellChildren = [imageRun];
        } catch (error) {
          // Fallback for missing images
          const imageSource = imageComp.props.svg?.trim()
            ? 'inline-svg'
            : imageComp.props.base64 || imageComp.props.path || 'unknown';
          cellChildren = [
            new TextRun({
              text: `[IMAGE: ${imageSource.substring(0, 50)}${imageSource.length > 50 ? '...' : ''}]`,
              font: mergedStyle.font,
              size: mergedStyle.size,
              color: '#999999',
            }),
          ];
        }
      } else {
        // Unsupported component type in table cell
        cellChildren = [
          new TextRun({
            text: `[Unsupported component type: ${content.name}]`,
            font: mergedStyle.font,
            size: mergedStyle.size,
            color: '#999999',
          }),
        ];
      }
    } else {
      // Handle plain string
      cellChildren = revision
        ? createRevisionRuns(revision, mergedStyle)
        : rowMark
          ? createMarkedTextRuns(content as string, rowMark, mergedStyle)
          : parseTextWithDecorators(content as string, mergedStyle, {
              enableHyperlinks: true,
            });
    }

    // The comment lives on the cell, so it wraps whatever the cell rendered —
    // string, paragraph or image alike.
    return wrapInComment(cellChildren, comment);
  };

  const headerRow = new TableRow({
    // Headers repeat across page breaks unless explicitly disabled
    tableHeader: model.repeatHeader,
    height:
      model.header.height !== undefined
        ? { value: model.header.height * 20, rule: 'atLeast' as const }
        : undefined,
    children: await Promise.all(
      model.header.cells.map(async (cell) => {
        const cellChildren = await processCellContent(
          cell,
          tableStyle.tableHeader
        );

        return new TableCell({
          children: [
            new Paragraph({
              ...(model.header.keepNext && { keepNext: true }),
              spacing: tableStyle.headerParagraph,
              alignment: getAlignment(cell.horizontalAlignment),
              children: cellChildren,
            }),
          ],

          verticalAlign: getVerticalAlignment(cell.verticalAlignment),
          ...(cell.backgroundColor !== 'transparent' && {
            shading: {
              fill: cell.backgroundColor,
            },
          }),
          margins: cellMargins(cell),
          borders: cellBorders(cell),
        });
      })
    ),
  });

  const dataRows = await Promise.all(
    model.rows.map(async (row) => {
      // Allocate every revision id for this row here, in the synchronous
      // prefix of the callback: `map` invokes callbacks in order and this runs
      // before any await, so ids follow document order rather than I/O
      // completion. Each emitted w:ins/w:del gets its own id, as Word's own
      // output does.
      const rowRevision = row.revision;
      const rowRevisionAttributes = rowRevision
        ? createRevisionMark(rowRevision)
        : undefined;

      /**
       * Each cell's closing paragraph mark carries the same change. Without it
       * an accepted deletion leaves an empty row behind, and an accepted
       * insertion leaves the row's paragraph marks untracked.
       */
      const paragraphMarks = rowRevision
        ? row.cells.map(() => ({ run: createRevisionMark(rowRevision) }))
        : undefined;

      return new TableRow({
        height:
          row.height !== undefined
            ? { value: row.height * 20, rule: 'atLeast' as const }
            : undefined,
        ...(row.cantSplit !== undefined && { cantSplit: row.cantSplit }),
        ...(row.tableHeader !== undefined && { tableHeader: row.tableHeader }),
        // w:trPr/w:ins | w:del — the row itself was inserted or deleted.
        ...rowRevisionAttributes,
        children: await Promise.all(
          row.cells.map(async (cell, colIndex) => {
            if (cell.missing) {
              return new TableCell({
                children: [
                  new Paragraph({
                    ...(row.keepNext ? { keepNext: true } : {}),
                    spacing: tableStyle.cellParagraph,
                    alignment: AlignmentType.LEFT,
                    ...paragraphMarks?.[colIndex],
                    children: [],
                  }),
                ],
                borders: cellBorders(cell),
              });
            }

            const cellChildren = await processCellContent(
              cell,
              tableStyle.tableCell,
              rowRevision
            );

            return new TableCell({
              children: [
                new Paragraph({
                  ...(row.keepNext ? { keepNext: true } : {}),
                  spacing: tableStyle.cellParagraph,
                  alignment: getAlignment(cell.horizontalAlignment),
                  ...paragraphMarks?.[colIndex],
                  children: cellChildren,
                }),
              ],
              verticalAlign: getVerticalAlignment(cell.verticalAlignment),
              ...(cell.backgroundColor !== 'transparent' && {
                shading: {
                  fill: cell.backgroundColor,
                },
              }),
              margins: cellMargins(cell),
              borders: cellBorders(cell),
            });
          })
        ),
      });
    })
  );

  return new Table({
    width: {
      size: model.width.size,
      type: model.width.unit === 'twips' ? WidthType.DXA : WidthType.PERCENTAGE,
    },
    layout: TableLayoutType.FIXED,
    columnWidths: model.columnGrid.values,
    rows: [headerRow, ...dataRows],
  });
}

/**
 * Convert alignment string to docx AlignmentType
 */
function getAlignment(
  alignment: string
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (alignment) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

/**
 * Convert vertical alignment string to docx VerticalAlign
 */
function getVerticalAlignment(
  alignment: string | undefined
):
  | typeof VerticalAlign.TOP
  | typeof VerticalAlign.CENTER
  | typeof VerticalAlign.BOTTOM
  | undefined {
  if (!alignment) return undefined;

  switch (alignment) {
    case 'top':
      return VerticalAlign.TOP;
    case 'middle':
      return VerticalAlign.CENTER;
    case 'bottom':
      return VerticalAlign.BOTTOM;
    default:
      return undefined;
  }
}

/**
 * Create header element from content
 */
export function createHeaderElement(
  children: (Paragraph | Table)[],
  _options?: {
    position?: 'left' | 'center' | 'right';
  }
): Header {
  return new Header({
    children: children,
  });
}

/**
 * Create footer element from content
 */
export function createFooterElement(
  children: (Paragraph | Table)[],
  _options?: {
    position?: 'left' | 'center' | 'right';
  }
): Footer {
  return new Footer({
    children: children,
  });
}

/**
 * Create page number element
 */
export function createPageNumberElement(
  format?: string,
  alignment?: 'left' | 'center' | 'right'
): Paragraph {
  const children: PlaceholderChild[] = [];

  if (format) {
    // Use placeholder processor to handle {PAGE} and other placeholders
    children.push(...processTextWithPlaceholders(format, {}));
  } else {
    // Default: just page number
    children.push(
      new TextRun({
        children: [PageNumber.CURRENT],
      })
    );
  }

  return new Paragraph({
    alignment: getAlignment(alignment || 'center'),
    children,
  });
}

/**
 * Create mixed content paragraph with text and image elements
 */
export async function createMixedContentParagraph(
  textContent: string,
  textOptions: {
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
  },
  imagePath?: string,
  imageOptions?: {
    width?: number;
    height?: number;
  },
  alignment?: 'left' | 'center' | 'right',
  theme?: import('../styles').ThemeConfig
): Promise<Paragraph> {
  const children: (TextRun | ImageRun)[] = [];
  const normalizedTextContent = normalizeUnicodeText(textContent);

  // Add text content
  if (normalizedTextContent) {
    children.push(
      new TextRun({
        text: normalizedTextContent,
        font: theme ? getThemeFonts(theme).body.family : undefined,
        size: textOptions.fontSize ? textOptions.fontSize * 2 : 20, // Convert to half-points
        color:
          textOptions.color ||
          (theme ? getThemeColors(theme).textPrimary : undefined),
        bold: textOptions.bold || false,
        italics: textOptions.italic || false,
      })
    );
  }

  // Add image if provided
  if (imagePath) {
    try {
      const imageResult = await getImageBuffer(imagePath);

      // Calculate dimensions with aspect ratio preservation
      const dimensions = await calculateImageDimensions(
        imagePath,
        imageOptions?.width,
        imageOptions?.height,
        60, // fallback width
        20 // fallback height
      );

      const imgType = detectImageType(imagePath, imageResult.contentType);
      const imageRun = await createTypedImageRun({
        type: imgType,
        data: imageResult.buffer,
        transformation: { width: dimensions.width, height: dimensions.height },
      });

      // Add some spacing before the image
      children.push(new TextRun({ text: '  ' }));
      children.push(imageRun);
    } catch (error) {
      // Fallback for missing images
      children.push(
        new TextRun({
          text: ` [IMAGE: ${imagePath}]`,
          font: theme ? getThemeFonts(theme).body.family : undefined,
          size: (textOptions.fontSize || 10) * 2,
          color: theme ? getThemeColors(theme).secondary : undefined,
          bold: true,
        })
      );
    }
  }

  return new Paragraph({
    alignment: getAlignment(alignment || 'left'),
    children,
  });
}

/**
 * Create a table specifically for headers/footers with custom styling
 */

export async function createHeaderFooterTable(
  rows: (string | ComponentDefinition)[][],
  options: {
    cellAlignments?: ('left' | 'center' | 'right')[];
    fontSize?: number;
    bold?: boolean;
    color?: string;
    noBorders?: boolean;
    cellStyling?: {
      [rowIndex: number]: {
        [cellIndex: number]: {
          bold?: boolean;
          color?: string;
          fontSize?: number;
        };
      };
    };
    theme?: ThemeConfig;
    themeName?: string;
  } = {}
): Promise<Table> {
  const {
    cellAlignments = ['left', 'right'],
    fontSize = 10,
    bold = false,
    color = '#000000',
    noBorders = true,
    cellStyling = {},
    theme,
  } = options;

  // Use theme's normal style for header/footer text since header/footer styles are removed
  const normalStyle = theme?.styles?.normal;

  const defaultFont = theme
    ? resolveFontFamily(theme, normalStyle?.font)
    : 'Arial';
  const defaultSize = normalStyle?.size || fontSize;
  const defaultColor =
    normalStyle?.color && theme
      ? resolveColor(normalStyle.color, theme)
      : color;

  const tableRows = await Promise.all(
    rows.map(
      async (row, rowIndex) =>
        new TableRow({
          children: await Promise.all(
            row.map(async (cell, cellIndex) => {
              const alignment = cellAlignments[cellIndex] || 'left';
              const cellStyle = cellStyling[rowIndex]?.[cellIndex] || {};

              let paragraphChildren: (PlaceholderChild | ImageRun)[] = [];

              // Handle ComponentDefinition first
              if (
                typeof cell === 'object' &&
                'name' in cell &&
                'props' in cell
              ) {
                // This is a ComponentDefinition
                if (isParagraphComponent(cell)) {
                  const textComp = cell as ParagraphComponentDefinition;
                  // Use parseTextWithDecorators to support rich text formatting
                  const textStyle = {
                    font:
                      textComp.props.font?.family || (defaultFont as string),
                    size:
                      ((textComp.props.font?.size || defaultSize) as number) *
                      2, // Convert to half-points
                    bold: textComp.props.font?.bold ?? false,
                    color:
                      (textComp.props.font?.color && theme
                        ? resolveColor(textComp.props.font.color, theme)
                        : undefined) || defaultColor,
                  } as const;
                  paragraphChildren = parseTextWithDecorators(
                    textComp.props.text,
                    textStyle,
                    { enableHyperlinks: true }
                  );
                } else if (isImageComponent(cell)) {
                  const imageComp = cell as ImageComponentDefinition;
                  try {
                    // Get image source (svg, base64, or path)
                    const imageSource = resolveImageSource(imageComp.props);
                    if (!imageSource) {
                      throw new Error(
                        'Image component requires one of "path", "base64", or "svg" property'
                      );
                    }

                    // Read from local file, URL, or base64
                    const imageResult = await getImageBuffer(imageSource);

                    // Parse width value if it's a string percentage (like "90%")
                    const parsedWidth =
                      typeof imageComp.props.width === 'string'
                        ? parseWidthValue(imageComp.props.width, 300) // Use a reasonable default for table context
                        : imageComp.props.width;

                    // Parse height value if it's a string percentage (like "90%")
                    const parsedHeight =
                      typeof imageComp.props.height === 'string'
                        ? parseWidthValue(imageComp.props.height, 200) // Use a reasonable default for table context
                        : imageComp.props.height;

                    // Calculate dimensions with aspect ratio preservation
                    const dimensions = await calculateImageDimensions(
                      imageSource,
                      parsedWidth,
                      parsedHeight,
                      60, // fallback width
                      20 // fallback height
                    );

                    const imgType = detectImageType(
                      imageSource,
                      imageResult.contentType
                    );
                    const imageRun = await createTypedImageRun({
                      type: imgType,
                      data: imageResult.buffer,
                      transformation: {
                        width: dimensions.width,
                        height: dimensions.height,
                      },
                    });
                    paragraphChildren = [imageRun];
                  } catch (error) {
                    // Fallback for missing images
                    const imageSource = imageComp.props.svg?.trim()
                      ? 'inline-svg'
                      : imageComp.props.base64 ||
                        imageComp.props.path ||
                        'unknown';
                    paragraphChildren = [
                      new TextRun({
                        text: `[IMAGE: ${imageSource.substring(0, 50)}${imageSource.length > 50 ? '...' : ''}]`,
                        size: fontSize * 2,
                        bold: true,
                        color: '#999999',
                      }),
                    ];
                  }
                } else {
                  // Unsupported component type in table cell
                  paragraphChildren = [
                    new TextRun({
                      text: `[Unsupported component type: ${cell.name}]`,
                      size: fontSize * 2,
                      color: '#999999',
                    }),
                  ];
                }
              } else if (typeof cell === 'string') {
                // Handle plain string text (including placeholders)
                const textStyle = {
                  font: defaultFont,
                  size: (cellStyle.fontSize || defaultSize) * 2,
                  bold: cellStyle.bold !== undefined ? cellStyle.bold : bold,
                  color: cellStyle.color || defaultColor,
                };

                // Use parseTextWithDecorators which now handles both decorators and placeholders
                paragraphChildren = parseTextWithDecorators(cell, textStyle, {
                  enableHyperlinks: true,
                });
              }

              return new TableCell({
                children: [
                  new Paragraph({
                    alignment: getAlignment(alignment),
                    children: paragraphChildren,
                  }),
                ],
                margins: {
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                },
                borders: noBorders
                  ? {
                      top: { style: BorderStyle.NONE, size: 0 },
                      bottom: { style: BorderStyle.NONE, size: 0 },
                      left: { style: BorderStyle.NONE, size: 0 },
                      right: { style: BorderStyle.NONE, size: 0 },
                    }
                  : undefined,
              });
            })
          ),
        })
    )
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED, // Lock column widths to prevent horizontal resizing
    rows: tableRows,
    borders: noBorders
      ? {
          top: { style: BorderStyle.NONE, size: 0 },
          bottom: { style: BorderStyle.NONE, size: 0 },
          left: { style: BorderStyle.NONE, size: 0 },
          right: { style: BorderStyle.NONE, size: 0 },
          insideHorizontal: { style: BorderStyle.NONE, size: 0 },
          insideVertical: { style: BorderStyle.NONE, size: 0 },
        }
      : undefined,
  });
}

/**
 * DocxIR — the renderer-neutral description of a finished Word document.
 *
 * Plain data only: no docx.js objects, no functions, no raw OOXML, no
 * backend-specific shapes. A renderer adapter is the only thing that turns
 * these nodes into a library call.
 *
 * By the time a document reaches this form, all of the following have happened
 * upstream (see `docs/architecture/office-renderer-ir.md`):
 *
 * - schema validation and structural conflict checks
 * - custom-component expansion
 * - theme resolution — every colour here is an explicit hex value
 * - component defaults
 * - font resolution/substitution, including synthesized weight aliases
 * - the inline text mini-language: `**bold**`, `[text](url)`, `[@ref]`,
 *   `[^note]`, `{PAGE}` and friends are already inline nodes, not markup
 * - section and column layout resolution
 * - authoring-only expansion: `statistic`, `visual` and `highcharts` are gone,
 *   replaced by the paragraphs and images they mean
 *
 * Units — stated in every property name, never implied:
 *
 * | Concern | Unit |
 * | --- | --- |
 * | page size, margins, indents, tab stops, spacing, table widths | twips (1/1440 in) |
 * | font size | half-points |
 * | drawing offsets and extents | EMU (1/914400 in) |
 * | image intrinsic size | pixels |
 * | border width | eighths of a point |
 * | character tracking | twentieths of a point |
 * | timestamps | ISO 8601 strings |
 */

/** Twips per inch. */
export const TWIPS_PER_INCH = 1440;
/** Twips per point. */
export const TWIPS_PER_POINT = 20;
/** English Metric Units per inch. */
export const EMU_PER_INCH = 914400;
/** English Metric Units per twip. */
export const EMU_PER_TWIP = EMU_PER_INCH / TWIPS_PER_INCH;

export const DOCX_IR_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */

export interface DocxIR {
  schemaVersion: typeof DOCX_IR_SCHEMA_VERSION;
  metadata: DocxIrMetadata;
  settings: DocxIrSettings;
  /** Resolved paragraph and character styles, in registration order. */
  styles: DocxIrStyles;
  /** Numbering definitions referenced by list paragraphs. */
  numbering: DocxIrNumbering[];
  /** Deduplicated binary assets, in first-use order. */
  resources: DocxIrResource[];
  sections: DocxIrSection[];
  /** Comment bodies, referenced by id from comment range nodes. */
  comments: DocxIrComment[];
  footnotes: DocxIrNote[];
  endnotes: DocxIrNote[];
}

export interface DocxIrMetadata {
  title?: string;
  subject?: string;
  author?: string;
  description?: string;
  keywords?: string;
  lastModifiedBy?: string;
  /** ISO 8601. Pinned by deterministic generation. */
  createdAt?: string;
  modifiedAt?: string;
  /** Custom document properties, in declaration order. */
  custom?: DocxIrCustomProperty[];
}

export interface DocxIrCustomProperty {
  name: string;
  value: string;
}

export interface DocxIrSettings {
  /** Default proofing language (BCP-47). */
  language?: string;
  /** Ask the reader to refresh fields on open. */
  updateFields: boolean;
  /** Turn on Word's track-changes mode in the produced document. */
  trackRevisions: boolean;
  /** Words the proofer should skip, applied as `w:noProof` on matching runs. */
  noProofWords?: string[];
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

export interface DocxIrStyles {
  /** Formatting every paragraph and run starts from. */
  defaults: DocxIrStyleDefaults;
  paragraph: DocxIrParagraphStyle[];
  character: DocxIrCharacterStyle[];
}

export interface DocxIrStyleDefaults {
  run: DocxIrRunFormatting;
  paragraph: DocxIrParagraphFormatting;
}

export interface DocxIrParagraphStyle {
  /** Style id as referenced by `DocxIrParagraph.styleId`. */
  id: string;
  /** Display name, which is what a TOC `\t` switch matches on. */
  name: string;
  basedOn?: string;
  next?: string;
  /** 0-8; present only when the style participates in the outline. */
  outlineLevel?: number;
  quickFormat?: boolean;
  run?: DocxIrRunFormatting;
  paragraph?: DocxIrParagraphFormatting;
}

export interface DocxIrCharacterStyle {
  id: string;
  name: string;
  basedOn?: string;
  run: DocxIrRunFormatting;
}

/* ------------------------------------------------------------------ *
 * Numbering
 * ------------------------------------------------------------------ */

export interface DocxIrNumbering {
  /** Reference name used by `DocxIrParagraph.numbering.reference`. */
  reference: string;
  levels: DocxIrNumberingLevel[];
}

export interface DocxIrNumberingLevel {
  /** 0-based. */
  level: number;
  /** OOXML `numFmt`, e.g. `decimal`, `bullet`, `lowerRoman`. */
  format: string;
  /** OOXML `lvlText`, e.g. `%1.` or `•`. */
  text: string;
  start?: number;
  alignment?: DocxIrAlignment;
  /** What follows the marker before the text. */
  suffix?: 'tab' | 'space' | 'nothing';
  indent?: DocxIrIndent;
  /** Formatting of the marker glyph itself. */
  run?: DocxIrRunFormatting;
  /** Bind this level to a paragraph style, so Word's numbering UI follows. */
  paragraphStyleId?: string;
}

/* ------------------------------------------------------------------ *
 * Resources
 * ------------------------------------------------------------------ */

/**
 * A binary asset.
 *
 * Images are held as bytes because a DOCX embeds them by value; the identity
 * used for deduplication and for debug snapshots is the content hash.
 */
export interface DocxIrResource {
  /** Deterministic: `res${n}` in first-use order. */
  id: string;
  kind: 'image';
  mediaType: string;
  bytes: Uint8Array;
  byteLength: number;
  /** Lowercase hex SHA-256 of `bytes`. */
  sha256: string;
  intrinsic?: DocxIrPixelSize;
  /**
   * Raster fallback for a vector image.
   *
   * Word before 2016 draws the fallback rather than the SVG, so a vector
   * resource carries one. It is a resource in its own right, referenced here.
   */
  fallbackResourceId?: string;
}

export interface DocxIrPixelSize {
  widthPx: number;
  heightPx: number;
}

/* ------------------------------------------------------------------ *
 * Shared value types
 * ------------------------------------------------------------------ */

export type DocxIrAlignment =
  | 'left'
  | 'center'
  | 'right'
  | 'justified'
  | 'start'
  | 'end';

export type DocxIrVerticalAlign = 'top' | 'center' | 'bottom';

/**
 * A resolved colour: bare 6-digit hex without `#`, never a theme token.
 *
 * Case is preserved rather than normalised. OOXML reads hex case-insensitively,
 * so normalising would change nothing a reader can see while changing the bytes
 * of every document that ever stated a colour in lower case.
 */
export interface DocxIrColor {
  hex: string;
}

export interface DocxIrIndent {
  leftTwips?: number;
  rightTwips?: number;
  firstLineTwips?: number;
  hangingTwips?: number;
}

export interface DocxIrSpacing {
  beforeTwips?: number;
  afterTwips?: number;
  /** Line height in twips, with `lineRule` deciding how it is applied. */
  lineTwips?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
}

export interface DocxIrTabStop {
  positionTwips: number;
  type: 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear';
  leader?: 'none' | 'dot' | 'hyphen' | 'underscore' | 'middleDot';
}

export interface DocxIrBorder {
  style: string;
  color?: DocxIrColor;
  /** Eighths of a point, which is the OOXML unit for `w:sz` on a border. */
  sizeEighthPoints?: number;
  spaceTwips?: number;
}

export interface DocxIrBorders {
  top?: DocxIrBorder;
  bottom?: DocxIrBorder;
  left?: DocxIrBorder;
  right?: DocxIrBorder;
  insideHorizontal?: DocxIrBorder;
  insideVertical?: DocxIrBorder;
}

export interface DocxIrShading {
  fill: DocxIrColor;
  pattern?: string;
  color?: DocxIrColor;
}

/* ------------------------------------------------------------------ *
 * Run formatting
 * ------------------------------------------------------------------ */

export interface DocxIrRunFormatting {
  /** Post-substitution family, possibly a synthesized weight alias. */
  fontFamily?: string;
  /** Half-points. */
  sizeHalfPoints?: number;
  color?: DocxIrColor;
  bold?: boolean;
  italic?: boolean;
  underline?: DocxIrUnderline;
  strike?: boolean;
  doubleStrike?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  smallCaps?: boolean;
  allCaps?: boolean;
  highlight?: string;
  shading?: DocxIrShading;
  /** Horizontal scale, percent. */
  scalePercent?: number;
  /** Tracking, in twentieths of a point; negative condenses. */
  characterSpacingTwentieths?: number;
  /** BCP-47. */
  language?: string;
  /** Exclude from proofing. */
  noProof?: boolean;
}

export interface DocxIrUnderline {
  type: string;
  color?: DocxIrColor;
}

/* ------------------------------------------------------------------ *
 * Paragraph formatting
 * ------------------------------------------------------------------ */

export interface DocxIrParagraphFormatting {
  alignment?: DocxIrAlignment;
  spacing?: DocxIrSpacing;
  indent?: DocxIrIndent;
  tabStops?: DocxIrTabStop[];
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
  borders?: DocxIrBorders;
  shading?: DocxIrShading;
  /** 0-8. Set explicitly when a paragraph should join the outline. */
  outlineLevel?: number;
  bidirectional?: boolean;
}

/* ------------------------------------------------------------------ *
 * Inline nodes
 * ------------------------------------------------------------------ */

export type DocxIrInline =
  | DocxIrTextRun
  | DocxIrLineBreak
  | DocxIrPageBreakRun
  | DocxIrColumnBreakRun
  | DocxIrTabRun
  | DocxIrImageRun
  | DocxIrHyperlink
  | DocxIrBookmarkStart
  | DocxIrBookmarkEnd
  | DocxIrFieldRun
  | DocxIrNoteReference
  | DocxIrCommentRangeStart
  | DocxIrCommentRangeEnd
  | DocxIrCommentReference
  | DocxIrRevisionRange;

export interface DocxIrTextRun {
  kind: 'text';
  text: string;
  formatting?: DocxIrRunFormatting;
  /** Character style applied on top of `formatting`. */
  styleId?: string;
}

export interface DocxIrLineBreak {
  kind: 'lineBreak';
  /** `textWrapping` is a plain newline; the others clear a floating object. */
  clear?: 'none' | 'left' | 'right' | 'all';
}

export interface DocxIrPageBreakRun {
  kind: 'pageBreak';
}

export interface DocxIrColumnBreakRun {
  kind: 'columnBreak';
}

/**
 * A tab, as its own run.
 *
 * A tab character inside `<w:t>` is dropped by Word and paragraph tab stops
 * only bind to real tab runs — and the run carries formatting like any other,
 * because the space it advances through is drawn in that font.
 */
export interface DocxIrTabRun {
  kind: 'tab';
  formatting?: DocxIrRunFormatting;
}

/**
 * An image placed inline in a paragraph.
 *
 * Floating placement lives on the paragraph, not here: OOXML anchors a floating
 * drawing to a paragraph, and modelling it on the run would misdescribe that.
 */
export interface DocxIrImageRun {
  kind: 'image';
  resourceId: string;
  widthEmu: number;
  heightEmu: number;
  altText?: string;
  /** Present when the drawing is anchored rather than inline. */
  floating?: DocxIrFloating;
}

export interface DocxIrHyperlink {
  kind: 'hyperlink';
  target: DocxIrHyperlinkTarget;
  children: DocxIrInline[];
}

export type DocxIrHyperlinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'bookmark'; anchor: string };

/**
 * Bookmark boundaries.
 *
 * Emitted as explicit paired nodes with compiler-allocated ids rather than a
 * wrapper, because a bookmark range can legitimately cross paragraph and even
 * table boundaries.
 */
export interface DocxIrBookmarkStart {
  kind: 'bookmarkStart';
  id: number;
  name: string;
}

export interface DocxIrBookmarkEnd {
  kind: 'bookmarkEnd';
  id: number;
}

/**
 * A Word field.
 *
 * `cachedText` is what a reader shows before it refreshes the field — headless
 * converters never refresh, so caching is the difference between a rendered
 * value and a blank.
 */
export interface DocxIrFieldRun {
  kind: 'field';
  /** Field instruction, e.g. `PAGE`, `NUMPAGES`, `REF _Ref123 \\r \\h`. */
  instruction: string;
  cachedText?: string;
  formatting?: DocxIrRunFormatting;
}

export interface DocxIrNoteReference {
  kind: 'noteReference';
  noteKind: 'footnote' | 'endnote';
  /** Matches an entry in `DocxIR.footnotes` / `DocxIR.endnotes`. */
  id: number;
}

export interface DocxIrCommentRangeStart {
  kind: 'commentRangeStart';
  id: number;
}

export interface DocxIrCommentRangeEnd {
  kind: 'commentRangeEnd';
  id: number;
}

export interface DocxIrCommentReference {
  kind: 'commentReference';
  id: number;
}

/**
 * Inserted or deleted content.
 *
 * A range rather than a run flag, because a revision covers a span and its
 * `id`/`author`/`date` belong to the span, not to each run inside it.
 */
export interface DocxIrRevisionRange {
  kind: 'revision';
  type: 'insert' | 'delete';
  id: number;
  author: string;
  /** ISO 8601. */
  date: string;
  children: DocxIrInline[];
}

/* ------------------------------------------------------------------ *
 * Floating placement
 * ------------------------------------------------------------------ */

export interface DocxIrFloating {
  /**
   * Where the drawing sits on each axis.
   *
   * Both are optional because an author may float an image purely to change
   * how text wraps around it, stating no position at all; the anchor then
   * keeps whatever position its container gives it.
   */
  horizontal?: DocxIrFloatingPosition;
  vertical?: DocxIrFloatingPosition;
  /** Distance kept clear of surrounding text, in EMU. */
  margins?: DocxIrFloatingMargins;
  wrap?: DocxIrTextWrap;
  /** Always emitted: some backends otherwise derive it from the height. */
  zIndex: number;
  behindDocument?: boolean;
  allowOverlap?: boolean;
  /** Keep the anchor with the paragraph it is attached to. */
  lockAnchor?: boolean;
  /** Position the drawing inside its table cell rather than the page. */
  layoutInCell?: boolean;
}

export interface DocxIrFloatingPosition {
  /**
   * OOXML's `relativeFrom`. Absent when the author named a frame of reference
   * OOXML has no element for, in which case the backend's own default applies.
   */
  relativeTo?: string;
  /** Offset in EMU. Mutually exclusive with `align`. */
  offsetEmu?: number;
  align?: string;
}

export interface DocxIrFloatingMargins {
  topEmu?: number;
  bottomEmu?: number;
  leftEmu?: number;
  rightEmu?: number;
}

export interface DocxIrTextWrap {
  /**
   * OOXML's own vocabulary.
   *
   * `tight` is reachable only from the authoring values `around` and `through`,
   * which have no OOXML equivalent of their own; asking for `tight` directly is
   * rejected at compile time because it needs polygon geometry no backend here
   * emits.
   */
  type: 'none' | 'square' | 'tight' | 'topAndBottom';
  side?: 'bothSides' | 'left' | 'right' | 'largest';
}

/* ------------------------------------------------------------------ *
 * Block nodes
 * ------------------------------------------------------------------ */

export type DocxIrBlock = DocxIrParagraph | DocxIrTable | DocxIrTableOfContents;

export interface DocxIrParagraph {
  kind: 'paragraph';
  /** Deterministic, path-derived: e.g. `s0.b3`, `s0.b3.r1.c0.b0`. */
  id: string;
  /** IR path for diagnostics: e.g. `sections[0].children[3]`. */
  path: string;
  children: DocxIrInline[];
  styleId?: string;
  formatting?: DocxIrParagraphFormatting;
  numbering?: DocxIrParagraphNumbering;
  /** Revision applied to the paragraph mark itself. */
  markRevision?: DocxIrParagraphMarkRevision;
  /** Anchor for a floating drawing carried by this paragraph's runs. */
  frame?: DocxIrFrame;
}

/**
 * A paragraph's place in a numbering sequence.
 *
 * `none` is not "no numbering stated" — that is expressed by leaving the whole
 * field out. It is an explicit detachment (OOXML `numId 0`), which is how a
 * single heading opts out of a numbering its style applies.
 */
export type DocxIrParagraphNumbering =
  | { none: true }
  | {
      none?: false;
      reference: string;
      /** 0-based. */
      level: number;
    };

export interface DocxIrParagraphMarkRevision {
  type: 'insert' | 'delete';
  id: number;
  author: string;
  date: string;
}

/**
 * A text frame: a paragraph positioned as a floating box.
 *
 * Distinct from `DocxIrFloating`, which positions a drawing. A frame positions
 * the paragraph itself.
 */
export interface DocxIrFrame {
  widthTwips: number;
  heightTwips: number;
  anchorHorizontal: string;
  anchorVertical: string;
  xTwips?: number;
  yTwips?: number;
  xAlign?: string;
  yAlign?: string;
  wrap?: string;
  rule?: 'auto' | 'exact' | 'atLeast';
  /** Keep the frame with the paragraph it is anchored to. */
  anchorLock?: boolean;
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

export interface DocxIrTable {
  kind: 'table';
  id: string;
  path: string;
  rows: DocxIrTableRow[];
  columnGrid: DocxIrColumnGrid;
  width: DocxIrTableWidth;
  /** Fixed layout is what the pipeline has always produced. */
  layout: 'fixed' | 'autofit';
  borders?: DocxIrBorders;
  alignment?: DocxIrAlignment;
  /** Default cell margins in twips. */
  cellMargins?: DocxIrCellMargins;
  /** Keep the whole table on one page where the format allows. */
  keepInOnePage?: boolean;
  /** Float the table out of the text flow. */
  floating?: DocxIrTableFloating;
}

/**
 * The table's column grid (`w:tblGrid`).
 *
 * `twips` is the real OOXML unit. `percent` is what the pipeline writes when no
 * column states a width: the grid then carries a percentage per column rather
 * than a width, which Word tolerates because the table itself is sized in
 * percent.
 */
export interface DocxIrColumnGrid {
  unit: 'twips' | 'percent';
  values: number[];
}

export type DocxIrTableWidth =
  | { kind: 'twips'; value: number }
  | { kind: 'percent'; value: number }
  | { kind: 'auto' };

export interface DocxIrCellMargins {
  topTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
  rightTwips?: number;
}

export interface DocxIrTableRow {
  cells: DocxIrTableCell[];
  /** Row height in twips. */
  heightTwips?: number;
  heightRule?: 'auto' | 'exact' | 'atLeast';
  /** Repeat this row at the top of each page the table spans. */
  isHeader?: boolean;
  cantSplit?: boolean;
  /**
   * A revision on the row.
   *
   * Word needs both this and a matching revision on every run inside, or
   * accepting a deletion leaves an empty row behind.
   */
  revision?: DocxIrParagraphMarkRevision;
}

export interface DocxIrTableCell {
  /** Cells hold blocks, so a cell can contain a paragraph, image or table. */
  children: DocxIrBlock[];
  columnSpan?: number;
  /** `restart` begins a vertical merge, `continue` extends it. */
  rowSpan?: 'restart' | 'continue';
  widthTwips?: number;
  verticalAlign?: DocxIrVerticalAlign;
  borders?: DocxIrBorders;
  shading?: DocxIrShading;
  margins?: DocxIrCellMargins;
  /** Rotate the cell's text. */
  textDirection?: string;
}

export interface DocxIrTableFloating {
  horizontalAnchor?: string;
  verticalAnchor?: string;
  absoluteHorizontalPositionTwips?: number;
  absoluteVerticalPositionTwips?: number;
  relativeHorizontalPosition?: string;
  relativeVerticalPosition?: string;
  topFromTextTwips?: number;
  bottomFromTextTwips?: number;
  leftFromTextTwips?: number;
  rightFromTextTwips?: number;
  overlap?: 'never' | 'overlap';
}

/* ------------------------------------------------------------------ *
 * Table of contents
 * ------------------------------------------------------------------ */

export interface DocxIrTableOfContents {
  kind: 'toc';
  id: string;
  path: string;
  /** Heading outline levels to include, inclusive. */
  headingRange?: { from: number; to: number };
  /** Additional paragraph styles, by display name, with their outline level. */
  styleLevels?: Array<{ styleName: string; level: number }>;
  /** Restrict the TOC to a bookmarked region. */
  bookmarkScope?: string;
  hyperlink?: boolean;
  /** The field's alias, shown while the entries are collapsed. */
  alias?: string;
  /**
   * Outline level ranges whose entries omit a page number.
   *
   * Ranges rather than a level list because that is what OOXML's `\n` switch
   * takes, and because the levels omitted are always contiguous blocks either
   * side of the range that keeps its numbers.
   */
  omitPageNumbersForLevels?: Array<{ from: number; to: number }>;
  /** Separator between entry text and page number. */
  entrySeparator?: string;
  /**
   * Entries baked in so a reader that never refreshes fields still shows a
   * table of contents. Headless converters never refresh.
   */
  cachedEntries?: DocxIrTocEntry[];
}

export interface DocxIrTocEntry {
  text: string;
  level: number;
  /**
   * The bookmark the entry links to, when one is known.
   *
   * A cached entry does not need one: Word rebuilds the links the moment it
   * refreshes the field, and a reader that never refreshes shows the text
   * without following it anywhere.
   */
  bookmark?: string;
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

export interface DocxIrSection {
  id: string;
  path: string;
  children: DocxIrBlock[];
  properties: DocxIrSectionProperties;
  headers?: DocxIrHeaderFooterSet;
  footers?: DocxIrHeaderFooterSet;
  /**
   * A bookmark covering this section's content.
   *
   * OOXML has no notion of a bookmarked section, so a section that something
   * can point at — a table of contents scoped to it, an internal link — is a
   * bookmark range around its content. One authored section can be split into
   * several layout sections, which is why `opens` and `closes` are separate:
   * the range starts in the first and ends in the last, and they share an id.
   */
  bookmark?: DocxIrSectionBookmark;
}

export interface DocxIrSectionBookmark {
  id: number;
  name: string;
  opens: boolean;
  closes: boolean;
}

export interface DocxIrSectionProperties {
  page: DocxIrPageSetup;
  columns?: DocxIrColumns;
  /** Where this section starts relative to the previous one. */
  type?: 'nextPage' | 'nextColumn' | 'continuous' | 'evenPage' | 'oddPage';
  pageNumbers?: DocxIrPageNumbering;
  borders?: DocxIrPageBorders;
  /** Distinct first-page header/footer. */
  titlePage?: boolean;
}

export interface DocxIrPageSetup {
  widthTwips: number;
  heightTwips: number;
  orientation: 'portrait' | 'landscape';
  /**
   * OOXML `w:pgSz/@w:code` — the paper code a printer driver keys off.
   * Present only for a named size; a custom width/height has none.
   */
  code?: number;
  margins: DocxIrPageMargins;
}

export interface DocxIrPageMargins {
  topTwips: number;
  bottomTwips: number;
  leftTwips: number;
  rightTwips: number;
  headerTwips?: number;
  footerTwips?: number;
  gutterTwips?: number;
}

export interface DocxIrColumns {
  count: number;
  spaceTwips?: number;
  separator?: boolean;
  equalWidth?: boolean;
  /** Explicit per-column widths; length matches `count` when present. */
  widths?: Array<{ widthTwips: number; spaceTwips?: number }>;
}

export interface DocxIrPageNumbering {
  start?: number;
  formatType?: string;
}

export interface DocxIrPageBorders {
  display?: string;
  offsetFrom?: 'page' | 'text';
  borders?: DocxIrBorders;
}

export interface DocxIrHeaderFooterSet {
  default?: DocxIrHeaderFooter;
  first?: DocxIrHeaderFooter;
  even?: DocxIrHeaderFooter;
}

export interface DocxIrHeaderFooter {
  /** Deterministic: `header:s0:default`. */
  id: string;
  children: DocxIrBlock[];
}

/* ------------------------------------------------------------------ *
 * Comments and notes
 * ------------------------------------------------------------------ */

export interface DocxIrComment {
  id: number;
  author: string;
  initials?: string;
  /** ISO 8601. */
  date: string;
  children: DocxIrBlock[];
  /** Threading: the comment this one replies to. */
  parentId?: number;
  resolved?: boolean;
}

export interface DocxIrNote {
  id: number;
  children: DocxIrBlock[];
}

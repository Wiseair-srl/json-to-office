/**
 * PptxIR — the renderer-neutral description of a finished presentation.
 *
 * Everything here is plain data: no PptxGenJS objects, no functions, no raw
 * OOXML, no backend-specific shapes. A renderer adapter is the only thing that
 * turns these nodes into a library call.
 *
 * By the time a document reaches this form, all of the following have already
 * happened upstream (see `docs/architecture/office-renderer-ir.md`):
 *
 * - schema validation and structural conflict checks
 * - custom-component expansion
 * - theme resolution — every colour here is an explicit 6-digit hex
 * - component defaults
 * - font resolution/substitution, including synthesized weight aliases
 * - grid and placeholder layout resolution — every position here is EMU
 * - text parsing
 *
 * Units: EMU for geometry, points for font sizes, degrees for angles,
 * percent (0-100) for transparency, ISO 8601 strings for timestamps.
 */

/** English Metric Units per inch. */
export const EMU_PER_INCH = 914400;
/** English Metric Units per point (72 points per inch). */
export const EMU_PER_POINT = EMU_PER_INCH / 72;

export const PPTX_IR_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */

export interface PptxIR {
  schemaVersion: typeof PPTX_IR_SCHEMA_VERSION;
  metadata: PptxIrMetadata;
  size: PptxIrSlideSize;
  theme: PptxIrTheme;
  /** Right-to-left reading order for the whole deck. */
  rtl: boolean;
  /** Deck-wide default proofing language (BCP-47). */
  language?: string;
  /** Deduplicated binary/external assets, in first-use order. */
  resources: PptxIrResource[];
  /** Reusable slide masters compiled from authored templates. */
  masters: PptxIrMaster[];
  slides: PptxIrSlide[];
}

export interface PptxIrMetadata {
  title?: string;
  author?: string;
  subject?: string;
  company?: string;
}

export interface PptxIrSlideSize {
  widthEmu: number;
  heightEmu: number;
}

/**
 * What survives theme resolution.
 *
 * Colours are already resolved into the elements that use them; the two font
 * families remain because they are set on the presentation itself (the OOXML
 * `<a:fontScheme>` major/minor faces), not per element. `palette` is the
 * resolved colour scheme, kept so an adapter able to emit a real `<a:clrScheme>`
 * can do so.
 */
export interface PptxIrTheme {
  name: string;
  headingFont: string;
  bodyFont: string;
  /** Resolved scheme colours, bare uppercase hex, keyed by project-owned slot. */
  palette: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ *
 * Resources
 * ------------------------------------------------------------------ */

/**
 * An asset referenced by one or more slide elements.
 *
 * `origin` records how the bytes are obtained. Inline sources (base64, raw SVG)
 * are decoded at compile time and carry `bytes` plus a content hash, which is
 * what deduplication and debug snapshots key on. File and remote sources keep
 * their location so the adapter can stream them, exactly as the pipeline did
 * before the IR existed; their identity is the normalised location.
 */
export interface PptxIrResource {
  /** Deterministic: `res${n}` in first-use order. */
  id: string;
  kind: 'image';
  origin: PptxIrResourceOrigin;
  /** IANA media type when known, e.g. `image/png`. */
  mediaType?: string;
  /** Intrinsic pixel size, when the compiler probed it. */
  intrinsic?: PptxIrPixelSize;
}

export type PptxIrResourceOrigin =
  | PptxIrInlineOrigin
  | PptxIrFileOrigin
  | PptxIrRemoteOrigin;

/** Bytes the compiler already holds (authored base64 or raw SVG markup). */
export interface PptxIrInlineOrigin {
  kind: 'inline';
  bytes: Uint8Array;
  byteLength: number;
  /** Lowercase hex SHA-256 of `bytes`; the dedup and snapshot identity. */
  sha256: string;
}

/** An absolute local path already checked against the allowed roots. */
export interface PptxIrFileOrigin {
  kind: 'file';
  path: string;
}

/** An `http(s)` URL the adapter fetches. */
export interface PptxIrRemoteOrigin {
  kind: 'remote';
  url: string;
}

export interface PptxIrPixelSize {
  widthPx: number;
  heightPx: number;
}

/* ------------------------------------------------------------------ *
 * Geometry, colour, fills, lines
 * ------------------------------------------------------------------ */

/**
 * Absolute placement on a slide, in EMU, with optional rotation and flips.
 *
 * `autoWidth` / `autoHeight` mark an axis the author did not constrain. The
 * EMU value is still present as a fallback, but a renderer able to size that
 * axis itself — an OOXML table sizes from its columns — should. "Unstated" is
 * information; inventing a number and forgetting that it was invented is how a
 * layout silently stops adapting.
 */
export interface PptxIrTransform {
  xEmu: number;
  yEmu: number;
  widthEmu: number;
  heightEmu: number;
  autoWidth?: boolean;
  autoHeight?: boolean;
  /** Clockwise degrees. Omitted means 0. */
  rotationDegrees?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

/**
 * A resolved colour: bare uppercase 6-digit hex, never a theme token.
 *
 * `transparency` is 0-100 where 0 is opaque, matching the authoring surface.
 */
export interface PptxIrColor {
  hex: string;
  transparency?: number;
}

export type PptxIrFill =
  | PptxIrNoFill
  | PptxIrSolidFill
  | PptxIrGradientFill
  | PptxIrPatternFill
  | PptxIrImageFill;

export interface PptxIrNoFill {
  kind: 'none';
}

export interface PptxIrSolidFill {
  kind: 'solid';
  color: PptxIrColor;
}

/**
 * A gradient described semantically. Each adapter decides how to realise it —
 * PptxGenJS cannot express one directly and splices XML during packaging;
 * another backend may have a first-class API. Neither concern belongs here.
 */
export interface PptxIrGradientFill {
  kind: 'gradient';
  gradient: PptxIrGradient;
}

export type PptxIrGradient = PptxIrLinearGradient | PptxIrRadialGradient;

export interface PptxIrLinearGradient {
  type: 'linear';
  /** Degrees, normalised to [0, 360). */
  angleDegrees: number;
  stops: PptxIrGradientStop[];
}

export interface PptxIrRadialGradient {
  type: 'radial';
  focus: PptxIrRadialFocus;
  stops: PptxIrGradientStop[];
}

export type PptxIrRadialFocus =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export interface PptxIrGradientStop {
  /** Percent along the gradient, 0-100. */
  position: number;
  color: PptxIrColor;
}

export interface PptxIrPatternFill {
  kind: 'pattern';
  /** OOXML `prst` preset name, validated at compile time. */
  preset: string;
  foreground: PptxIrColor;
  background: PptxIrColor;
}

export interface PptxIrImageFill {
  kind: 'image';
  resourceId: string;
}

export interface PptxIrLine {
  color?: PptxIrColor;
  /** Stroke width in points. */
  widthPoints?: number;
  dash?: PptxIrLineDash;
}

export type PptxIrLineDash =
  | 'solid'
  | 'dash'
  | 'dashDot'
  | 'lgDash'
  | 'lgDashDot'
  | 'lgDashDotDot'
  | 'sysDash'
  | 'sysDashDot'
  | 'sysDashDotDot'
  | 'sysDot'
  | 'dot';

export interface PptxIrShadow {
  type: 'outer' | 'inner' | 'none';
  color: PptxIrColor;
  /** Blur radius in points. */
  blurPoints: number;
  /** Offset distance in points. */
  offsetPoints: number;
  angleDegrees: number;
  /** 0-1, as the authoring surface expresses it. */
  opacity: number;
}

/* ------------------------------------------------------------------ *
 * Hyperlinks
 * ------------------------------------------------------------------ */

export type PptxIrHyperlink = PptxIrExternalHyperlink | PptxIrSlideHyperlink;

export interface PptxIrExternalHyperlink {
  kind: 'external';
  url: string;
  tooltip?: string;
}

/** A jump to another slide, already rebased onto generated slide numbering. */
export interface PptxIrSlideHyperlink {
  kind: 'slide';
  /** 1-based index into `PptxIR.slides`. */
  slideIndex: number;
  tooltip?: string;
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

export type PptxIrHorizontalAlign = 'left' | 'center' | 'right' | 'justify';
export type PptxIrVerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * One run of uniformly-formatted text.
 *
 * Every inherited value has already been cascaded down (component props →
 * named style → theme defaults), so a run states its own formatting outright
 * rather than relying on a parent. `fontFamily` is post-substitution and may be
 * a synthesized weight alias such as `Inter Light`.
 */
export interface PptxIrTextRun {
  text: string;
  fontFamily: string;
  /** Points. */
  fontSize: number;
  color: PptxIrColor;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: PptxIrUnderline;
  superscript?: boolean;
  subscript?: boolean;
  /** Points; positive tracks wider. */
  characterSpacing?: number;
  /** BCP-47 proofing language. */
  language?: string;
  /** End this run with a hard line break. */
  breakAfter?: boolean;
  /** Points of space before the paragraph this run starts. */
  spaceBeforePoints?: number;
  /** Points of space after the paragraph this run ends. */
  spaceAfterPoints?: number;
  hyperlink?: PptxIrHyperlink;
}

export interface PptxIrUnderline {
  style: string;
  color?: PptxIrColor;
}

/**
 * Formatting a text body applies by default.
 *
 * OOXML keeps body-level defaults (`lstStyle`, `endParaRPr`) separate from run
 * properties, and so does this: `PptxIrTextRun` states its own formatting
 * outright — a backend with no body-default concept can render from runs alone
 * — while `defaults` is what an empty paragraph, or a backend that does have
 * the concept, should use.
 */
export interface PptxIrRunFormatting {
  fontFamily: string;
  /** Points. */
  fontSize: number;
  color: PptxIrColor;
  bold?: boolean;
  italic?: boolean;
  /** BCP-47 proofing language. */
  language?: string;
}

/** Paragraph-level settings shared by every run in a text body. */
export interface PptxIrTextBodyStyle {
  align?: PptxIrHorizontalAlign;
  verticalAlign: PptxIrVerticalAlign;
  /** Exact line height in points. Mutually exclusive with `lineSpacingMultiple`. */
  lineSpacingPoints?: number;
  /** Line height as a multiple of the font size. */
  lineSpacingMultiple?: number;
  spaceBeforePoints?: number;
  spaceAfterPoints?: number;
  bullet?: PptxIrBullet;
  /**
   * Inset in points: a single value or [top, right, bottom, left].
   *
   * The four-value order is CSS's, which is what the authoring schema states
   * and what the default backend already reads — an adapter that rotates it
   * moves content to the wrong side of the box.
   *
   * Absent means "no inset stated" — the format's own default applies. That is
   * a real distinction: a text box states `0` so it aligns exactly to its
   * position, while a shape leaves it unstated and keeps OOXML's default
   * padding.
   */
  insetPoints?: number | [number, number, number, number];
  /** Let the shape grow to fit its text instead of clipping. */
  autoFit?: boolean;
  /** Body-level run defaults. */
  defaults: PptxIrRunFormatting;
}

export interface PptxIrBullet {
  /**
   * `bullet` for a glyph, `number` for an ordered list, `none` for a paragraph
   * that states it has no bullet.
   *
   * `none` is not the same as leaving `bullet` unset. Unset inherits whatever
   * the list style or the backend's default provides; `none` is the author
   * saying so, and lowers to `<a:buNone/>` — which is what overriding an
   * inherited bullet takes.
   */
  type: 'bullet' | 'number' | 'none';
  /** Glyph character or numbering style, as OOXML names it. */
  style?: string;
  startAt?: number;
}

/* ------------------------------------------------------------------ *
 * Slide elements
 * ------------------------------------------------------------------ */

export type PptxIrElement =
  | PptxIrTextBoxElement
  | PptxIrShapeElement
  | PptxIrImageElement
  | PptxIrTableElement
  | PptxIrChartElement
  | PptxIrGroupElement;

/** Fields every element carries. */
interface PptxIrElementBase {
  /** Deterministic, path-derived: e.g. `s1.e3`, `s1.e3.g0`. */
  id: string;
  /** IR path for diagnostics: e.g. `slides[0].elements[3]`. */
  path: string;
  transform: PptxIrTransform;
  /** Accessibility description. */
  altText?: string;
}

export interface PptxIrTextBoxElement extends PptxIrElementBase {
  kind: 'textBox';
  runs: PptxIrTextRun[];
  style: PptxIrTextBodyStyle;
  fill?: PptxIrFill;
  line?: PptxIrLine;
  shadow?: PptxIrShadow;
  hyperlink?: PptxIrHyperlink;
}

/**
 * A preset-geometry shape, optionally carrying text.
 *
 * `geometry` is a project-owned name (see `PPTX_IR_GEOMETRY`), not a PptxGenJS
 * enum member; adapters map it to whatever their backend calls it.
 */
export interface PptxIrShapeElement extends PptxIrElementBase {
  kind: 'shape';
  geometry: PptxIrGeometry;
  fill?: PptxIrFill;
  line?: PptxIrLine;
  shadow?: PptxIrShadow;
  /** Corner radius in inches. `roundRect` and friends only. */
  cornerRadius?: number;
  /** Start/end angle in degrees for arc-like geometries. */
  angleRangeDegrees?: [number, number];
  runs?: PptxIrTextRun[];
  style?: PptxIrTextBodyStyle;
  hyperlink?: PptxIrHyperlink;
}

export const PPTX_IR_GEOMETRY = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star5',
  'star6',
  'line',
  'rightArrow',
  'chevron',
  'cloud',
  'heart',
  'lightningBolt',
] as const;

export type PptxIrKnownGeometry = (typeof PPTX_IR_GEOMETRY)[number];

/**
 * A geometry name. Known names are checked at compile time; anything else is
 * carried through as `{ custom }` so an adapter that supports a wider preset
 * set can use it and one that does not can fail with a precise diagnostic.
 */
export type PptxIrGeometry = PptxIrKnownGeometry | { custom: string };

export interface PptxIrImageElement extends PptxIrElementBase {
  kind: 'image';
  resourceId: string;
  /** Cropping/scaling already resolved by the compiler where it could be. */
  sizing?: PptxIrImageSizing;
  rounding?: boolean;
  shadow?: PptxIrShadow;
  hyperlink?: PptxIrHyperlink;
}

export interface PptxIrImageSizing {
  /**
   * `contain` survives only when the fit could not be computed — the compiler
   * normally resolves it into the transform and drops the sizing.
   */
  type: 'contain' | 'cover' | 'crop';
  widthEmu: number;
  heightEmu: number;
  /** Crop origin in EMU, `crop` only. */
  xEmu?: number;
  yEmu?: number;
}

/**
 * A table.
 *
 * The authoring surface gives each cell a single string plus its own
 * formatting, so that is what the IR models — not a rich-text body per cell.
 * `defaults` holds the table-level formatting cells inherit; a cell states only
 * what it overrides, which mirrors how OOXML layers `tblPr` under `tcPr`.
 */
export interface PptxIrTableElement extends PptxIrElementBase {
  kind: 'table';
  rows: PptxIrTableRow[];
  /** Column widths in EMU. Empty lets the renderer distribute them. */
  columnWidthsEmu: number[];
  /** Row heights in EMU, positionally. Empty lets the renderer auto-size. */
  rowHeightsEmu: number[];
  defaults: PptxIrTableFormatting;
  /** Uniform border applied to the whole table. */
  border?: PptxIrTableBorder;
  /** Table-level background fill. */
  fill?: PptxIrColor;
  /**
   * Corner radius in inches.
   *
   * A semantic request for rounded table corners. OOXML tables have no such
   * property, so each adapter decides how to honour it; the IR does not
   * describe the technique.
   */
  cornerRadiusInches?: number;
  /** Let the table flow onto further slides when it overruns. */
  autoPage?: boolean;
  /** Repeat the first row as a header on each continuation slide. */
  autoPageRepeatHeader?: boolean;
}

/** Formatting a table applies to every cell that does not override it. */
export interface PptxIrTableFormatting {
  fontFamily: string;
  /** Points. */
  fontSize: number;
  color?: PptxIrColor;
  bold?: boolean;
  align?: PptxIrHorizontalAlign;
  verticalAlign: PptxIrVerticalAlign;
  /** Inset in points: one value or [top, right, bottom, left]. */
  insetPoints?: number | [number, number, number, number];
}

export interface PptxIrTableRow {
  cells: PptxIrTableCell[];
}

export interface PptxIrTableCell {
  text: string;
  /** Only what this cell overrides; everything else comes from `defaults`. */
  formatting?: PptxIrTableCellFormatting;
  fill?: PptxIrColor;
  /** Per-side borders, in [top, right, bottom, left] order. */
  borders?: [
    PptxIrTableBorder,
    PptxIrTableBorder,
    PptxIrTableBorder,
    PptxIrTableBorder,
  ];
  colSpan?: number;
  rowSpan?: number;
}

export interface PptxIrTableCellFormatting {
  fontFamily?: string;
  /** Points. */
  fontSize?: number;
  color?: PptxIrColor;
  bold?: boolean;
  italic?: boolean;
  align?: PptxIrHorizontalAlign;
  verticalAlign?: PptxIrVerticalAlign;
  insetPoints?: number | [number, number, number, number];
}

export interface PptxIrTableBorder {
  type: 'none' | 'solid' | 'dash' | 'dot';
  color?: PptxIrColor;
  /** Points. */
  widthPoints?: number;
}

/**
 * A native OOXML chart.
 *
 * Series data is normalised and every colour, font family and label style is
 * already resolved, so no theme lookup or charting library is involved at
 * render time. The option names follow the project's authoring schema, which
 * is itself aligned with PowerPoint's chart vocabulary — they are project-owned
 * names that happen to read like the format's.
 */
export interface PptxIrChartElement extends PptxIrElementBase {
  kind: 'chart';
  chartType: PptxIrChartType;
  series: PptxIrChartSeries[];
  options: PptxIrChartOptions;
}

export type PptxIrChartType =
  | 'area'
  | 'bar'
  | 'bar3D'
  | 'bubble'
  | 'doughnut'
  | 'line'
  | 'pie'
  | 'radar'
  | 'scatter';

export interface PptxIrChartSeries {
  name?: string;
  labels?: string[];
  values?: number[];
  /** Bubble sizes, `bubble` charts only. */
  sizes?: number[];
}

/** A resolved label font: family after weight aliasing, plus the bold toggle. */
export interface PptxIrChartLabelFont {
  fontFamily?: string;
  bold?: boolean;
  /** Points. */
  fontSize?: number;
  color?: PptxIrColor;
}

export interface PptxIrChartGridLine {
  style?: string;
  size?: number;
  color?: PptxIrColor;
}

export interface PptxIrChartOptions {
  /** Resolved series palette, in series order. Empty means "use the backend's". */
  colors: string[];

  showLegend?: boolean;
  showTitle?: boolean;
  showValue?: boolean;
  showPercent?: boolean;
  showLabel?: boolean;
  showSeriesName?: boolean;

  title?: string;
  titleFont: PptxIrChartLabelFont;

  legendPosition?: string;
  legendFont: PptxIrChartLabelFont;

  categoryAxis: PptxIrChartAxis;
  valueAxis: PptxIrChartValueAxis;

  dataBorder?: { widthPoints: number; color: PptxIrColor };
  dataLabelFont: PptxIrChartLabelFont;
  dataLabelPosition?: string;

  barDirection?: string;
  barGrouping?: string;
  barGapWidthPercent?: number;
  barOverlapPercent?: number;

  lineSmooth?: boolean;
  lineDataSymbol?: string;
  lineSize?: number;
  lineDataSymbolSize?: number;

  firstSliceAngle?: number;
  holeSize?: number;

  radarStyle?: string;
}

export interface PptxIrChartAxis {
  title?: string;
  hidden?: boolean;
  labelRotate?: number;
  labelFont: PptxIrChartLabelFont;
  gridLine?: PptxIrChartGridLine;
  showLine?: boolean;
}

export interface PptxIrChartValueAxis extends PptxIrChartAxis {
  minValue?: number;
  maxValue?: number;
  majorUnit?: number;
  labelFormatCode?: string;
}

/** A group of elements sharing a transform. */
export interface PptxIrGroupElement extends PptxIrElementBase {
  kind: 'group';
  children: PptxIrElement[];
}

/* ------------------------------------------------------------------ *
 * Slides and masters
 * ------------------------------------------------------------------ */

export interface PptxIrSlide {
  /** Deterministic: `slide${n}`, 1-based in generated order. */
  id: string;
  path: string;
  /** Name of a master in `PptxIR.masters`, when the slide uses one. */
  masterName?: string;
  background?: PptxIrBackground;
  elements: PptxIrElement[];
  notes?: string;
  hidden: boolean;
  transition?: PptxIrTransition;
}

/**
 * A slide background.
 *
 * Only solid and image backgrounds are backgrounds in the OOXML sense. A
 * gradient background compiles to a full-bleed shape at the back of the slide
 * instead, because that is what it means semantically once resolved — see the
 * compiler.
 */
export type PptxIrBackground =
  | { kind: 'solid'; color: PptxIrColor }
  | { kind: 'image'; resourceId: string };

export interface PptxIrTransition {
  type: string;
  speed?: 'slow' | 'medium' | 'fast';
}

export interface PptxIrMaster {
  name: string;
  background?: PptxIrBackground;
  /**
   * Content margin, in inches: a single value or [top, right, bottom, left].
   *
   * Not decoration — a format sizes an unconstrained table against the master's
   * margins, so dropping this silently resizes tables.
   */
  margin?: number | [number, number, number, number];
  /** Fixed decoration drawn on every slide using this master. */
  elements: PptxIrElement[];
  /** Slide-number field placement, when the template defines one. */
  slideNumber?: PptxIrSlideNumber;
  /** Named regions a slide can fill; positions already resolved. */
  placeholders: PptxIrPlaceholder[];
}

export interface PptxIrSlideNumber {
  transform: PptxIrTransform;
  color?: PptxIrColor;
  /** Points. */
  fontSize?: number;
}

/**
 * A placeholder as the *master* declares it.
 *
 * Slide-side placeholder content is not a placeholder in the IR — it has
 * already been merged with the declaration and emitted as a normal element on
 * the slide. This entry exists so a master can still declare the region.
 */
export interface PptxIrPlaceholder {
  name: string;
  transform?: PptxIrTransform;
}

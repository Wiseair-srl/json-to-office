import {
  chartEncodingFor,
  collectColorLiterals,
  collectFontFamilies,
  collectPlaceholders,
  hasUnitMarker,
  normalizeHex,
  normalizeHighchartsChart,
  parseNumericCell,
  type ChartInfoDesign,
  type PlaceholderKind,
  type PreparedDocument,
  type ProvenanceMap,
  type QualityFact,
  type TableAlignment,
  type TableColumnInfoDesign,
  type TableInfoDesign,
} from '@json-to-office/quality';
import type { FontRuntimeOpts, ServicesConfig } from '@json-to-office/shared';
import {
  DEFAULT_PPTX_RENDERER_ID,
  SEMANTIC_COLOR_NAMES,
} from '@json-to-office/shared-pptx';
import { designColors } from '@json-to-office/shared';
import type {
  GridConfig,
  GridPosition,
  PipelineWarning,
  PptxComponentInput,
  PptxThemeConfig,
  PresentationComponentDefinition,
  ProcessedPresentation,
  TextStyle,
} from '../types';
import { resolveColor } from '../utils/color';
import { resolveGridPosition } from '../core/grid';
import { resolveThemeContext } from '../core/generationContext';
import { processPresentation } from '../core/structure';
import {
  blockSlotBudgets,
  blockSlotRoles,
  expandPptxBlocks,
  toAuthoredPointer,
  type BlockSourceMap,
} from '../blocks';
import { defaultLineHeightPt, estimateTextLines } from '../utils/textMetrics';
import type { BlockSlotRole } from '@json-to-office/shared';

type Rec = Record<string, unknown>;

export interface PptxCanvasFact extends QualityFact {
  kind: 'pptx/canvas';
  widthIn?: number;
  heightIn?: number;
}

export interface PptxTextFact extends QualityFact {
  kind: 'pptx/text';
  slidePath: string;
  text: string;
  fontSizePt: number;
  lineSpacingPt: number;
  paraSpaceBeforePt: number;
  paraSpaceAfterPt: number;
  styleName?: string;
  boxXPt?: number;
  boxYPt?: number;
  boxWidthPt?: number;
  boxHeightPt?: number;
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Horizontal alignment: the prop, else the named style's, else left. */
  align: 'left' | 'center' | 'right' | 'justify';
  rotationDeg: number;
  /**
   * True when neither `h` nor a grid supplies a height. The compiler resolves
   * grid positions before checking `props.h`, so grid height is a hard ceiling.
   */
  autoFit: boolean;
  /** Effective bold, from the run or its named style. */
  bold: boolean;
  /** Resolved run colour, bare hex, when the document states one. */
  colorHex?: string;
  /**
   * Every colour the surface behind this text can paint, bare hex. A gradient
   * contributes each stop: text has to stay legible over all of them, and the
   * worst stop is the one a reader notices.
   */
  backgroundHexes?: readonly string[];
}

export interface PptxSlideFact extends QualityFact {
  kind: 'pptx/slide';
  bodyWords: number;
}

/** A box drawn on a slide, in draw order — the input to the overlap rule. */
export interface PptxBoxFact extends QualityFact {
  kind: 'pptx/box';
  slidePath: string;
  componentName: string;
  /** Draw order within the slide; a higher value is painted later, on top. */
  order: number;
  /** Paints its whole rectangle: an image, a chart, a table, a filled shape. */
  opaque: boolean;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

/** The resolved theme, as the brand rules see it. */
export interface PptxThemeFact extends QualityFact {
  kind: 'pptx/theme';
  themeName: string;
  /** Token name to `#RRGGBB`, for every palette entry that resolves. */
  paletteHexes: Readonly<Record<string, string>>;
  fontFamilies: readonly string[];
}

/** A colour written as a literal rather than as a theme token. */
export interface PptxColorFact extends QualityFact {
  kind: 'pptx/color';
  raw: string;
  hex: string;
}

/** A font family the document asks for by name. */
export interface PptxFontFact extends QualityFact {
  kind: 'pptx/font-family';
  family: string;
}

/**
 * A chart on a slide — native or Highcharts — read into the vocabulary the
 * information-design rules speak.
 */
export interface PptxChartFact extends QualityFact, ChartInfoDesign {
  kind: 'pptx/chart';
  /** `chart` or `highcharts`; the two answer the same questions differently. */
  componentName: string;
  /** Theme tokens a palette fix can name, in series order. */
  paletteTokens: readonly string[];
}

/** One authored cell of a slide table, and where a patch would rewrite it. */
export interface PptxTableCellRef {
  path: string;
  cell: string | Record<string, unknown>;
}

export interface PptxTableColumnFact extends TableColumnInfoDesign {
  /** Every authored cell in this column, header first, in row order. */
  cells: readonly PptxTableCellRef[];
}

export interface PptxTableFact extends QualityFact, TableInfoDesign {
  kind: 'pptx/table';
  columns: readonly PptxTableColumnFact[];
}

/** One authored string that reads as a placeholder rather than as content. */
export interface PptxPlaceholderFact extends QualityFact {
  kind: 'pptx/placeholder';
  text: string;
  placeholderKind: PlaceholderKind;
  pattern: string;
  excerpt: string;
}

/** One text slot of a block, counted against the budget the block declares. */
export interface PptxBlockSlotFact extends QualityFact {
  kind: 'pptx/block-slot';
  block: string;
  slot: string;
  words: number;
  maxWords: number;
}

/**
 * A role-bearing slot of a block invocation, present or not. A profile reads
 * these to require a source under every chart or to measure an action title;
 * the theme that styles them never adds a requirement.
 */
export interface PptxChromeSlotFact extends QualityFact {
  kind: 'pptx/chrome-slot';
  block: string;
  /** Authored pointer of the invocation. */
  invocation: string;
  slot: string;
  role: BlockSlotRole;
  present: boolean;
  text?: string;
  /** Lines the slot's text takes in the box the definition gave it. */
  estimatedLines?: number;
  fontSizePt?: number;
}

export type PptxQualityFact =
  | PptxCanvasFact
  | PptxBlockSlotFact
  | PptxChromeSlotFact
  | PptxTextFact
  | PptxSlideFact
  | PptxPlaceholderFact
  | PptxBoxFact
  | PptxThemeFact
  | PptxColorFact
  | PptxFontFact
  | PptxChartFact
  | PptxTableFact;

export interface PptxQualityModel {
  authored: PresentationComponentDefinition;
  /** The document after the export-mode pre-pass and block expansion. */
  document: PresentationComponentDefinition;
  theme: PptxThemeConfig;
  processed: ProcessedPresentation;
}

/** What `PreparedDocument.metadata.blocks` carries once a block expanded. */
export interface PptxBlocksMetadata {
  /** Compiled pointer → authored pointer. */
  sourceMap: BlockSourceMap;
  /** Authored pointers of the expanded blocks. */
  blocks: readonly string[];
  /** The compiled form: the document with every block lowered in place. */
  document: PresentationComponentDefinition;
}

export interface PreparePptxQualityOptions {
  customThemes?: Record<string, PptxThemeConfig>;
  fonts?: FontRuntimeOpts;
  services?: ServicesConfig;
  warnings?: PipelineWarning[];
  renderer?: string;
}

interface ThemeContext {
  styles: Partial<Record<string, TextStyle>>;
  defaultFontSize: number;
}

interface Typography {
  fontSize: number;
  lineSpacing: number;
  paraSpaceBefore: number;
  paraSpaceAfter: number;
  bold: boolean;
  styleName?: string;
}

interface TextNode {
  props: Rec;
  path: string;
  text: string;
  /** Draw order on the slide, shared with `Surface`. */
  order: number;
}

interface ComponentAtPath {
  component: PptxComponentInput;
  path: string;
}

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

interface Box {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

/** Absolute box in points, falling back to the grid when x/y/w/h are absent. */
function resolveBox(
  props: Rec,
  grid: GridConfig | undefined,
  slideWidthIn: number,
  slideHeightIn: number
): Partial<Box> {
  let xPt = dimToPt(props.x, slideWidthIn);
  let yPt = dimToPt(props.y, slideHeightIn);
  let widthPt = dimToPt(props.w, slideWidthIn);
  let heightPt = dimToPt(props.h, slideHeightIn);
  const gridPos = asRecord(props.grid);
  if (
    gridPos !== undefined &&
    asNumber(gridPos.column) !== undefined &&
    asNumber(gridPos.row) !== undefined &&
    (xPt === undefined ||
      yPt === undefined ||
      widthPt === undefined ||
      heightPt === undefined)
  ) {
    const resolved = resolveGridPosition(
      gridPos as unknown as GridPosition,
      grid,
      slideWidthIn,
      slideHeightIn
    );
    xPt ??= resolved.x * 72;
    yPt ??= resolved.y * 72;
    widthPt ??= resolved.w * 72;
    heightPt ??= resolved.h * 72;
  }
  return { xPt, yPt, widthPt, heightPt };
}

function isCompleteBox(box: Partial<Box>): box is Box {
  return (
    box.xPt !== undefined &&
    box.yPt !== undefined &&
    box.widthPt !== undefined &&
    box.heightPt !== undefined &&
    box.widthPt > 0 &&
    box.heightPt > 0
  );
}

function containsCentre(surface: Box, text: Box): boolean {
  const cx = text.xPt + text.widthPt / 2;
  const cy = text.yPt + text.heightPt / 2;
  return (
    cx >= surface.xPt &&
    cx <= surface.xPt + surface.widthPt &&
    cy >= surface.yPt &&
    cy <= surface.yPt + surface.heightPt
  );
}

const HORIZONTAL_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

function horizontalAlign(props: Rec, ctx: ThemeContext): PptxTextFact['align'] {
  const own = typeof props.align === 'string' ? props.align : undefined;
  if (own && HORIZONTAL_ALIGNMENTS.has(own))
    return own as PptxTextFact['align'];
  const styled =
    typeof props.style === 'string'
      ? ctx.styles[props.style]?.align
      : undefined;
  return styled && HORIZONTAL_ALIGNMENTS.has(styled)
    ? (styled as PptxTextFact['align'])
    : 'left';
}

function themeContext(theme: PptxThemeConfig): ThemeContext {
  return {
    styles: theme.styles ?? {},
    defaultFontSize: asNumber(theme.defaults?.fontSize) ?? 18,
  };
}

/**
 * Every colour a fill can paint, resolved to bare hex.
 *
 * Deliberately structural rather than typed against one fill shape: solid
 * fills, gradients and their stops all nest `color` somewhere, and a background
 * that paints no colour at all (an image) yields nothing, which is the honest
 * answer — the rule then stays quiet instead of guessing at a photograph.
 */
function fillColorHexes(fill: unknown, theme: PptxThemeConfig): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const rec = asRecord(node);
    if (!rec) return;
    if (typeof rec.color === 'string') {
      const hex = resolveColor(rec.color, theme);
      if (hex) found.push(hex.toUpperCase());
    }
    for (const value of Object.values(rec)) {
      if (typeof value === 'object' && value !== null) visit(value);
    }
  };
  visit(fill);
  return [...new Set(found)];
}

const FOCUS_CORNERS: Readonly<Record<string, readonly [number, number]>> = {
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomLeft: [0, 1],
  bottomRight: [1, 1],
};

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a, 16);
  const pb = parseInt(b, 16);
  const mix = (shift: number): number =>
    Math.round(
      ((pa >> shift) & 255) +
        (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t
    );
  return [mix(16), mix(8), mix(0)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Where along a gradient the point (fx, fy) — both 0..1 across the surface —
 * falls. Radial gradients run outward from the named corner; linear ones run
 * along `angle`, measured clockwise from the x-axis with y pointing down.
 *
 * The radial radius is half the surface's diagonal in real units, which is not
 * an obvious choice — it is the one the renderer makes. Sampling the rendered
 * gradient across a 10 × 5.625in slide put the last stop at exactly half the
 * diagonal from the focus corner, and reproduced every probe: the corner
 * opposite the focus, the two edge midpoints (which a shape-independent model
 * gets wrong, because equal distances in normalized space are unequal on a
 * wide slide), and the centre.
 */
function gradientPosition(
  gradient: Rec,
  fx: number,
  fy: number,
  widthUnits: number,
  heightUnits: number
): number {
  if (gradient.type === 'radial') {
    const focus =
      FOCUS_CORNERS[
        typeof gradient.focus === 'string' ? gradient.focus : 'topLeft'
      ] ?? FOCUS_CORNERS.topLeft;
    const radius = Math.hypot(widthUnits, heightUnits) / 2;
    if (radius === 0) return 0;
    const distance = Math.hypot(
      (fx - focus[0]) * widthUnits,
      (fy - focus[1]) * heightUnits
    );
    return Math.min(1, distance / radius);
  }
  const angle = ((asNumber(gradient.angle) ?? 0) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const min = Math.min(0, dx) + Math.min(0, dy);
  const max = Math.max(0, dx) + Math.max(0, dy);
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (fx * dx + fy * dy - min) / (max - min)));
}

/**
 * The colour a fill actually paints at (fx, fy).
 *
 * Sampling matters for gradients: taking the worst stop instead would fail
 * black text against the blue end of a background whose peach end it never
 * touches, and every slide over a two-tone ground would carry a finding for
 * one colour or the other.
 */
function paintedColorHexes(
  fill: unknown,
  theme: PptxThemeConfig,
  fx: number,
  fy: number,
  widthUnits: number,
  heightUnits: number
): string[] {
  const rec = asRecord(fill);
  const gradient = asRecord(rec?.gradient);
  const stops = Array.isArray(gradient?.stops) ? gradient.stops : undefined;
  if (gradient && stops && stops.length > 0) {
    const parsed = stops
      .flatMap((stop) => {
        const entry = asRecord(stop);
        const color =
          typeof entry?.color === 'string' ? entry.color : undefined;
        if (!color) return [];
        const hex = resolveColor(color, theme);
        if (!hex) return [];
        return [{ pos: asNumber(entry?.pos) ?? 0, hex: hex.toUpperCase() }];
      })
      .sort((a, b) => a.pos - b.pos);
    if (parsed.length === 0) return [];
    const target =
      gradientPosition(gradient, fx, fy, widthUnits, heightUnits) * 100;
    if (target <= parsed[0].pos) return [parsed[0].hex];
    const last = parsed[parsed.length - 1];
    if (target >= last.pos) return [last.hex];
    for (let i = 1; i < parsed.length; i += 1) {
      const previous = parsed[i - 1];
      const next = parsed[i];
      if (target <= next.pos) {
        const span = next.pos - previous.pos;
        const t = span === 0 ? 0 : (target - previous.pos) / span;
        return [lerpHex(previous.hex, next.hex, t)];
      }
    }
    return [last.hex];
  }
  return fillColorHexes(fill, theme);
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

  // WCAG treats bold text as large from 14pt, so weight has to survive the
  // same explicit-prop -> named-style resolution the size does. `fontWeight`
  // wins over `bold` in the renderer, so it wins here too.
  const weight = asNumber(props.fontWeight) ?? style?.fontWeight;
  const bold =
    weight !== undefined
      ? weight >= 600
      : typeof props.bold === 'boolean'
        ? props.bold
        : style?.bold ?? false;

  return {
    fontSize,
    lineSpacing,
    paraSpaceBefore: asNumber(props.paraSpaceBefore) ?? 0,
    paraSpaceAfter:
      asNumber(props.paraSpaceAfter) ?? style?.paraSpaceAfter ?? 0,
    bold,
    ...(styleName && { styleName }),
  };
}

/**
 * Anything that paints over the slide surface, in the order it is drawn.
 * `colorHexes` is empty for an image — it covers the background without
 * telling us what colour it puts there.
 */
interface Surface {
  order: number;
  props: Rec;
  isImage: boolean;
}

/** Components that paint their whole rectangle, whatever is underneath. */
const OPAQUE_COMPONENTS = new Set([
  'table',
  'chart',
  'highcharts',
  'image',
  'visual',
]);

/** Shape types whose ink is the whole bounding box. */
const RECTANGULAR_SHAPES = new Set(['rect', 'roundRect']);

/**
 * Whether a fill actually covers what is under it.
 *
 * Any transparency at all disqualifies it: the reference decks stack a
 * primary-coloured disc under the same disc at 90% transparency, and a tinted
 * overlay is a technique rather than a collision. A gradient counts as opaque
 * only when none of its stops is see-through.
 */
function isOpaqueFill(fill: unknown): boolean {
  const rec = asRecord(fill);
  if (!rec) return false;
  if ((asNumber(rec.transparency) ?? 0) > 0) return false;
  const gradient = asRecord(rec.gradient);
  if (gradient) {
    const stops = Array.isArray(gradient.stops) ? gradient.stops : [];
    return stops.every(
      (stop) => (asNumber(asRecord(stop)?.transparency) ?? 0) === 0
    );
  }
  return true;
}

/**
 * Whether this component hides whatever it is drawn over.
 *
 * A shape qualifies only when it is a rectangle with an opaque fill. An
 * ellipse, a pie wedge or a chevron leaves most of its bounding box empty —
 * the reference decks draw concentric circles and radial segments whose boxes
 * cross by design and whose ink never touches.
 */
function isOpaqueComponent(componentName: string, props: Rec): boolean {
  if (OPAQUE_COMPONENTS.has(componentName)) return true;
  if (props.fill === undefined) return false;
  const type = typeof props.type === 'string' ? props.type : 'rect';
  return RECTANGULAR_SHAPES.has(type) && isOpaqueFill(props.fill);
}

/**
 * A component with a position, and whether it paints its whole box.
 *
 * Opacity, not "is this content", is the property the overlap rule can act
 * on. A text box is routinely declared far larger than the words inside it —
 * an 80pt title in a 5in box, a caption parked in the corner of a wide frame —
 * so two intersecting text rectangles say nothing about whether any ink
 * collides. Two intersecting *opaque* rectangles always hide each other.
 */
interface BoxNode {
  props: Rec;
  path: string;
  componentName: string;
  order: number;
  opaque: boolean;
}

/** A chart or a table: the two components the information-design rules read. */
interface ContentNode {
  props: Rec;
  path: string;
  componentName: string;
}

/**
 * One ordered pass over a slide's components: the text to analyse, the
 * surfaces drawn behind it, and every positioned box. All three need the same
 * z-order, and z-order is just the sequence the renderer walks, so they are
 * collected together rather than in passes that could disagree.
 */
function collectSlideNodes(
  component: unknown,
  path: string,
  text: TextNode[],
  surfaces: Surface[],
  boxes: BoxNode[],
  contentNodes: ContentNode[],
  counter: { next: number }
): void {
  const rec = asRecord(component);
  if (!rec || rec.enabled === false) return;
  const props = asRecord(rec.props) ?? {};
  const order = counter.next++;

  if (rec.name === 'image' || rec.name === 'visual' || rec.name === 'chart') {
    surfaces.push({ order, props, isImage: true });
  } else if (rec.name === 'shape' && props.fill !== undefined) {
    surfaces.push({ order, props, isImage: false });
  }

  const content = typeof props.text === 'string' ? props.text : undefined;
  if (
    content !== undefined &&
    content.trim() !== '' &&
    props.runs === undefined
  ) {
    if (rec.name === 'text' || rec.name === 'shape') {
      text.push({ props, path, text: content, order });
    }
  }

  const componentName = typeof rec.name === 'string' ? rec.name : '';
  if (
    componentName === 'chart' ||
    componentName === 'highcharts' ||
    componentName === 'table'
  ) {
    contentNodes.push({ props, path, componentName });
  }
  if (componentName !== '') {
    boxes.push({
      props,
      path,
      componentName,
      order,
      opaque: isOpaqueComponent(componentName, props),
    });
  }

  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    collectSlideNodes(
      child,
      `${path}/children/${index}`,
      text,
      surfaces,
      boxes,
      contentNodes,
      counter
    )
  );
}

/**
 * Theme slots that can carry a data series, in the order a palette hands them
 * out. `background`, `text` and their variants are excluded: they are the
 * ground and the ink, and a series painted in either disappears into the slide.
 */
const SERIES_COLOR_TOKENS: readonly string[] = [
  'primary',
  'accent',
  'secondary',
  'accent4',
  'accent5',
  'accent6',
];

/** A chart component, native or Highcharts, as the shared rules read it. */
function chartFact(
  node: ContentNode,
  paletteTokens: readonly string[]
): PptxChartFact | undefined {
  const { props, path } = node;
  const base = {
    id: `pptx:chart:${path}`,
    kind: 'pptx/chart' as const,
    path,
    componentName: node.componentName,
    paletteTokens,
  };

  if (node.componentName === 'highcharts') {
    const shape = normalizeHighchartsChart(props.options);
    return {
      ...base,
      chartType: shape.chartType,
      encoding: shape.encoding,
      threeD: shape.threeD,
      seriesCount: shape.seriesCount,
      categoryCount: shape.categoryCount,
      seriesColorsStated: shape.seriesColorsStated,
      seriesColorsPath: `${path}/props/options`,
      ...(shape.valueAxisMin !== undefined && {
        valueAxisMin: shape.valueAxisMin,
      }),
      unitStated: shape.unitStated,
      annotation: {
        stated: shape.annotationStated,
        path,
        slot: 'props.options.caption.text',
      },
    };
  }

  const chartType = typeof props.type === 'string' ? props.type : '';
  if (chartType === '') return undefined;
  const series = Array.isArray(props.data) ? props.data : [];
  const categoryCount = Math.max(
    0,
    ...series.map((entry) => {
      const record = asRecord(entry);
      const labels = Array.isArray(record?.labels) ? record.labels.length : 0;
      const values = Array.isArray(record?.values) ? record.values.length : 0;
      return Math.max(labels, values);
    })
  );

  return {
    ...base,
    chartType,
    encoding: chartEncodingFor(chartType),
    threeD: chartType.endsWith('3D'),
    seriesCount: series.length,
    categoryCount,
    seriesColorsStated:
      Array.isArray(props.chartColors) && props.chartColors.length > 0,
    seriesColorsPath: `${path}/props/chartColors`,
    ...(asNumber(props.valAxisMinVal) !== undefined && {
      valueAxisMin: asNumber(props.valAxisMinVal),
    }),
    // A percent-stacked bar and percent data labels both state the unit as
    // surely as an axis title does — the numbers are shares, and the chart
    // says so on its face.
    unitStated:
      (typeof props.valAxisLabelFormatCode === 'string' &&
        props.valAxisLabelFormatCode.trim() !== '') ||
      props.showPercent === true ||
      props.barGrouping === 'percentStacked' ||
      hasUnitMarker(
        typeof props.valAxisTitle === 'string' ? props.valAxisTitle : ''
      ) ||
      hasUnitMarker(typeof props.title === 'string' ? props.title : ''),
    // No `annotation`: a native slide chart has no caption or source property,
    // and a rule that judges a slot the component does not have is a rule
    // nobody can satisfy.
  };
}

/** The text a slide-table cell shows, whichever of its two shapes it takes. */
function cellText(cell: unknown): string {
  if (typeof cell === 'string') return cell;
  const record = asRecord(cell);
  return typeof record?.text === 'string' ? record.text : '';
}

const PPTX_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

function cellAlignment(cell: unknown, tableDefault: TableAlignment) {
  const record = asRecord(cell);
  const align = typeof record?.align === 'string' ? record.align : undefined;
  return align !== undefined && PPTX_ALIGNMENTS.has(align)
    ? (align as TableAlignment)
    : tableDefault;
}

/**
 * A slide table, column by column, out of a row-major model.
 *
 * Row 0 counts as a header when the table says so, and also when it is plainly
 * one: no cell in it parses as a number while the table has body rows to
 * compare. `headerRow` is optional in the schema and routinely left off, and
 * reading a label row as data would hide exactly the columns most likely to
 * have been laid out without thought.
 *
 * A table with merged cells is described without columns: a `colspan` breaks
 * the correspondence between an index and a visual column, and every column
 * finding below is about what sits under what.
 */
function tableFact(
  node: ContentNode,
  slidePath: string,
  authoredProps: Rec | undefined
): PptxTableFact | undefined {
  const { props, path } = node;
  const rows = Array.isArray(props.rows) ? props.rows : undefined;
  if (!rows || rows.length === 0) return undefined;

  // The *authored* border, not the resolved one. Every theme gives tables a
  // rule between cells, so a resolved-border test would report one finding per
  // table for a decision taken once, in the theme, for the whole document.
  // What this rule can say something about is a table that asks for a box of
  // its own.
  const border = asRecord(authoredProps?.border);
  const fullGrid =
    border !== undefined &&
    border.type !== 'none' &&
    (asNumber(border.pt) ?? 1) > 0;

  const merged = rows.some(
    (row) =>
      Array.isArray(row) &&
      row.some((cell) => {
        const record = asRecord(cell);
        return record?.colspan !== undefined || record?.rowspan !== undefined;
      })
  );

  const base = {
    id: `pptx:table:${path}`,
    kind: 'pptx/table' as const,
    path,
    relatedPaths: [slidePath],
    rowCount: rows.length,
    fullGrid,
    ...(fullGrid && { gridPath: `${path}/props/border` }),
  };
  if (merged) return { ...base, columns: [] };

  const cellsOf = (row: unknown): unknown[] => (Array.isArray(row) ? row : []);
  const headerRow =
    props.headerRow === true ||
    (rows.length >= 3 &&
      cellsOf(rows[0]).every(
        (cell) => parseNumericCell(cellText(cell)) === undefined
      ));
  const bodyStart = headerRow ? 1 : 0;
  const tableDefault: TableAlignment =
    typeof props.align === 'string' && PPTX_ALIGNMENTS.has(props.align)
      ? (props.align as TableAlignment)
      : 'left';

  const columnCount = Math.max(0, ...rows.map((row) => cellsOf(row).length));
  const columns: PptxTableColumnFact[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    const cells: PptxTableCellRef[] = [];
    const values: string[] = [];
    const alignments = new Set<TableAlignment>();
    rows.forEach((row, rowIndex) => {
      const cell = cellsOf(row)[index];
      if (cell === undefined) return;
      cells.push({
        path: `${path}/props/rows/${rowIndex}/${index}`,
        cell: typeof cell === 'string' ? cell : asRecord(cell) ?? {},
      });
      if (rowIndex < bodyStart) return;
      values.push(cellText(cell));
      alignments.add(cellAlignment(cell, tableDefault));
    });
    const header = headerRow ? cellText(cellsOf(rows[0])[index]) : undefined;
    columns.push({
      index,
      // The top cell of the column. A row-major table has no node standing
      // for a column, and pointing every column of one table at `props/rows`
      // would give two findings the same address — indistinguishable to a
      // reader, and impossible to suppress one at a time.
      path: `${path}/props/rows/0/${index}`,
      ...(header !== undefined && { header }),
      values,
      alignment:
        alignments.size === 1
          ? [...alignments][0]
          : alignments.size === 0
            ? tableDefault
            : 'mixed',
      cells,
    });
  }
  return { ...base, columns };
}

/**
 * The `props` of the authored node at an RFC 6901 pointer.
 *
 * Facts are otherwise read off the processed tree, which is what the renderer
 * draws. A handful of questions are about what the *document* asked for rather
 * than what it inherited, and those need the authored node at the same pointer
 * the fact reports.
 */
function authoredPropsAtPointer(
  root: unknown,
  pointer: string
): Rec | undefined {
  let node: unknown = root;
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      node = node[index];
    } else {
      const record = asRecord(node);
      if (!record) return undefined;
      node = record[key];
    }
    if (node === undefined) return undefined;
  }
  return asRecord(asRecord(node)?.props);
}

function addSlideFacts(
  roots: ComponentAtPath[],
  slidePath: string,
  renderedIndex: number,
  grid: GridConfig | undefined,
  slideWidthIn: number,
  slideHeightIn: number,
  ctx: ThemeContext,
  theme: PptxThemeConfig,
  slideBackground: (fx: number, fy: number) => readonly string[],
  analyzedTextPaths: Set<string>,
  analyzedContentPaths: Set<string>,
  paletteTokens: readonly string[],
  authoredPropsAt: (path: string) => Rec | undefined,
  addFact: (fact: PptxQualityFact) => void
): void {
  const nodes: TextNode[] = [];
  const surfaces: Surface[] = [];
  const boxes: BoxNode[] = [];
  const contentNodes: ContentNode[] = [];
  const counter = { next: 0 };
  for (const root of roots) {
    collectSlideNodes(
      root.component,
      root.path,
      nodes,
      surfaces,
      boxes,
      contentNodes,
      counter
    );
  }

  // Shared template objects reach every slide that uses the template; their
  // authored path is analysed once, exactly as text is.
  for (const node of contentNodes) {
    if (analyzedContentPaths.has(node.path)) continue;
    analyzedContentPaths.add(node.path);
    const fact =
      node.componentName === 'table'
        ? tableFact(node, slidePath, authoredPropsAt(node.path))
        : chartFact(node, paletteTokens);
    if (fact) addFact(fact);
  }
  boxes.forEach((node, boxIndex) => {
    const box = resolveBox(node.props, grid, slideWidthIn, slideHeightIn);
    if (!isCompleteBox(box)) return;
    addFact({
      id: `pptx:box:${renderedIndex}:${boxIndex}:${node.path}`,
      kind: 'pptx/box',
      path: node.path,
      slidePath,
      componentName: node.componentName,
      order: node.order,
      opaque: node.opaque,
      xPt: box.xPt,
      yPt: box.yPt,
      widthPt: box.widthPt,
      heightPt: box.heightPt,
    });
  });
  const surfaceBoxes = surfaces.flatMap((surface) => {
    const box = resolveBox(surface.props, grid, slideWidthIn, slideHeightIn);
    return isCompleteBox(box) ? [{ ...surface, box }] : [];
  });

  let bodyWords = 0;
  nodes.forEach((node, nodeIndex) => {
    const typography = resolveTypography(node.props, ctx);
    if (
      typography.styleName !== 'title' &&
      typography.styleName !== 'subtitle'
    ) {
      bodyWords += node.text.split(/\s+/).filter(Boolean).length;
    }

    // Shared template objects count toward every slide's density, but their
    // authored path should be analyzed only once.
    if (analyzedTextPaths.has(node.path)) return;
    analyzedTextPaths.add(node.path);

    const gridPos = asRecord(node.props.grid);
    const nodeBox = resolveBox(node.props, grid, slideWidthIn, slideHeightIn);
    const {
      xPt: boxXPt,
      yPt: boxYPt,
      widthPt: boxWidthPt,
      heightPt: boxHeightPt,
    } = nodeBox;

    // What the text actually sits on: its own shape fill, else the topmost
    // earlier-drawn surface covering its centre, else the slide itself.
    // Skipping the occlusion step reads every white-on-blue card as white on
    // the slide's white ground, which is how a contrast rule earns a reputation
    // for crying wolf.
    // Sample the whole box, not just its middle. A text block laid across a
    // gradient has a legibility problem at its worst end, and a centre sample
    // reports the average — which is exactly the point where neither the light
    // nor the dark half of the ground is represented.
    const sampleFractions = (
      box: Partial<Box>,
      originX: number,
      originY: number,
      widthPt: number,
      heightPt: number
    ): Array<readonly [number, number]> => {
      if (!isCompleteBox(box) || widthPt <= 0 || heightPt <= 0) {
        return [[0.5, 0.5]];
      }
      const x0 = (box.xPt - originX) / widthPt;
      const x1 = (box.xPt + box.widthPt - originX) / widthPt;
      const y0 = (box.yPt - originY) / heightPt;
      const y1 = (box.yPt + box.heightPt - originY) / heightPt;
      return [
        [(x0 + x1) / 2, (y0 + y1) / 2],
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ];
    };
    const slideSamples = sampleFractions(
      nodeBox,
      0,
      0,
      slideWidthIn * 72,
      slideHeightIn * 72
    );
    // A node's own fill spans the node, not the slide, so it is sampled in the
    // node's own box. Reusing the slide fractions here would read a shape's
    // gradient at the shape's position on the slide — a shape an inch into a
    // 13in canvas would never reach its own later stops.
    const ownFill = [
      ...new Set(
        sampleFractions(
          nodeBox,
          boxXPt ?? 0,
          boxYPt ?? 0,
          boxWidthPt ?? 0,
          boxHeightPt ?? 0
        ).flatMap(([fx, fy]) =>
          paintedColorHexes(
            node.props.fill,
            theme,
            fx,
            fy,
            (boxWidthPt ?? 0) / 72,
            (boxHeightPt ?? 0) / 72
          )
        )
      ),
    ];
    let backgroundHexes: readonly string[] = [
      ...new Set(slideSamples.flatMap(([fx, fy]) => slideBackground(fx, fy))),
    ];
    let backgroundUnknown = false;
    if (ownFill.length > 0) {
      backgroundHexes = ownFill;
    } else if (isCompleteBox(nodeBox)) {
      const covering = surfaceBoxes
        .filter(
          (surface) =>
            surface.order < node.order && containsCentre(surface.box, nodeBox)
        )
        .pop();
      if (covering?.isImage) {
        // An image covers the ground but says nothing about its colour.
        backgroundUnknown = true;
      } else if (covering) {
        // Sample within the covering shape's own box, not the slide's.
        const fill = [
          ...new Set(
            sampleFractions(
              nodeBox,
              covering.box.xPt,
              covering.box.yPt,
              covering.box.widthPt,
              covering.box.heightPt
            ).flatMap(([fx, fy]) =>
              paintedColorHexes(
                covering.props.fill,
                theme,
                fx,
                fy,
                covering.box.widthPt / 72,
                covering.box.heightPt / 72
              )
            )
          ),
        ];
        if (fill.length > 0) backgroundHexes = fill;
        else backgroundUnknown = true;
      }
    }
    const colorHex =
      typeof node.props.color === 'string'
        ? resolveColor(node.props.color, theme)?.toUpperCase()
        : undefined;

    addFact({
      id: `pptx:text:${renderedIndex}:${nodeIndex}:${node.path}`,
      kind: 'pptx/text',
      path: node.path,
      slidePath,
      text: node.text,
      fontSizePt: typography.fontSize,
      lineSpacingPt: typography.lineSpacing,
      paraSpaceBeforePt: typography.paraSpaceBefore,
      paraSpaceAfterPt: typography.paraSpaceAfter,
      ...(typography.styleName && { styleName: typography.styleName }),
      ...(boxXPt !== undefined && { boxXPt }),
      ...(boxYPt !== undefined && { boxYPt }),
      ...(boxWidthPt !== undefined && boxWidthPt > 0 && { boxWidthPt }),
      ...(boxHeightPt !== undefined && boxHeightPt > 0 && { boxHeightPt }),
      verticalAlign:
        node.props.valign === 'middle' || node.props.valign === 'bottom'
          ? node.props.valign
          : 'top',
      align: horizontalAlign(node.props, ctx),
      rotationDeg: asNumber(node.props.rotate) ?? 0,
      bold: typography.bold,
      autoFit: node.props.h === undefined && gridPos === undefined,
      ...(colorHex !== undefined && { colorHex }),
      ...(!backgroundUnknown &&
        backgroundHexes.length > 0 && { backgroundHexes }),
    });
  });

  addFact({
    id: `pptx:slide:${renderedIndex}:${slidePath}`,
    kind: 'pptx/slide',
    path: slidePath,
    bodyWords,
  });
}

export function preparePptxQualityDocument(
  document: PresentationComponentDefinition,
  options: PreparePptxQualityOptions = {}
): PreparedDocument<PptxQualityModel, PptxQualityFact> {
  const facts: PptxQualityFact[] = [];
  const provenance: Record<string, ProvenanceMap[string]> = {};
  // Blocks lower here, once, for every consumer: the facts below, the
  // compiler and the renderers all read the expanded tree. A fact raised on a
  // compiled child is reported at the authored slot it came from, so a
  // finding inside a block points at what the author wrote, never at a node
  // they never saw.
  let sourceMap: BlockSourceMap = {};
  const authoredPath = (path: string): string =>
    toAuthoredPointer(sourceMap, path);
  const addFact = (raw: PptxQualityFact): void => {
    const fact: PptxQualityFact = {
      ...raw,
      path: authoredPath(raw.path),
      ...(raw.relatedPaths && {
        relatedPaths: raw.relatedPaths.map(authoredPath),
      }),
    };
    facts.push(fact);
    provenance[fact.id] = {
      path: fact.path,
      ...(fact.relatedPaths && { relatedPaths: fact.relatedPaths }),
    };
  };

  const props = asRecord(document.props) ?? {};
  addFact({
    id: 'pptx:canvas',
    kind: 'pptx/canvas',
    path: '/props',
    ...(asNumber(props.slideWidth) !== undefined && {
      widthIn: asNumber(props.slideWidth),
    }),
    ...(asNumber(props.slideHeight) !== undefined && {
      heightIn: asNumber(props.slideHeight),
    }),
  });

  // Over the authored tree, before any theme or template resolution: a marker
  // has to be reported where the author can patch it out.
  collectPlaceholders(document).forEach((occurrence, index) => {
    addFact({
      id: `pptx:placeholder:${index}:${occurrence.path}`,
      kind: 'pptx/placeholder',
      path: occurrence.path,
      text: occurrence.text,
      placeholderKind: occurrence.match.kind,
      pattern: occurrence.match.pattern,
      excerpt: occurrence.match.excerpt,
    });
  });

  collectColorLiterals(document).forEach((literal, index) => {
    addFact({
      id: `pptx:color:${index}:${literal.path}`,
      kind: 'pptx/color',
      path: literal.path,
      raw: literal.raw,
      hex: literal.hex,
    });
  });

  collectFontFamilies(document).forEach((use, index) => {
    addFact({
      id: `pptx:font:${index}:${use.path}`,
      kind: 'pptx/font-family',
      path: use.path,
      family: use.family,
    });
  });

  const warnings = options.warnings ?? [];
  const context = resolveThemeContext(document, {
    customThemes: options.customThemes,
    fonts: options.fonts,
    warnings,
  });
  const expanded = expandPptxBlocks(context.document, context.theme);
  sourceMap = expanded.sourceMap;
  const processed = processPresentation(expanded.document, {
    theme: context.theme,
    customThemes: options.customThemes,
    services: options.services,
    sourceMap,
    warnings,
  });
  const ctx = themeContext(processed.theme);

  const paletteHexes: Record<string, string> = {};
  const visualColors = designColors(
    processed.theme.colors,
    processed.theme.palette
  );
  const entries = {
    ...visualColors,
    ...Object.fromEntries(
      (processed.theme.palette?.chart ?? []).map((value) => [
        `#${resolveColor(value, processed.theme)}`,
        value,
      ])
    ),
  };
  for (const [token, value] of Object.entries(entries)) {
    if (typeof value !== 'string') continue;
    // Through `resolveColor` so a slot naming another slot lands on the colour
    // it actually paints, not on the token name it stores.
    const hex = normalizeHex(resolveColor(value, processed.theme));
    // New palette roles are theme-only, outside the component color enum.
    // Quality fixes must offer a legal literal for those colors.
    if (hex)
      paletteHexes[
        (SEMANTIC_COLOR_NAMES as readonly string[]).includes(token)
          ? token
          : hex
      ] = hex;
  }
  addFact({
    id: 'pptx:theme',
    kind: 'pptx/theme',
    path: '/props',
    themeName: processed.theme.name,
    paletteHexes,
    fontFamilies: [
      ...new Set(
        [processed.theme.fonts?.heading, processed.theme.fonts?.body].filter(
          (family): family is string =>
            typeof family === 'string' && family.trim() !== ''
        )
      ),
    ],
  });
  const authoredChildren = Array.isArray(document.children)
    ? document.children
    : [];
  const slideIndexes = authoredChildren.flatMap((child, index) => {
    const slide = asRecord(child);
    return slide?.name === 'slide' && slide.enabled !== false ? [index] : [];
  });
  const analyzedTextPaths = new Set<string>();
  const analyzedContentPaths = new Set<string>();
  const paletteTokens =
    processed.theme.palette?.chart?.map(
      (value) => `#${resolveColor(value, processed.theme)}`
    ) ??
    SERIES_COLOR_TOKENS.filter((token) => paletteHexes[token] !== undefined);
  // A handful of questions are about what the document asked for rather than
  // what it inherited; for block content the authored node is the slot.
  const authoredPropsAt = (pointer: string): Rec | undefined =>
    authoredPropsAtPointer(document, authoredPath(pointer));

  processed.slides.forEach((slide, renderedIndex) => {
    const authoredIndex = slideIndexes[renderedIndex];
    if (authoredIndex === undefined) return;
    const slidePath = `/children/${authoredIndex}`;
    const roots: ComponentAtPath[] = slide.components.map(
      (component, index) => ({
        component,
        path: `${slidePath}/children/${index}`,
      })
    );

    addSlideFacts(
      roots,
      slidePath,
      renderedIndex,
      processed.grid,
      processed.slideWidth,
      processed.slideHeight,
      ctx,
      processed.theme,
      (fx, fy) =>
        paintedColorHexes(
          slide.background ?? props.background,
          processed.theme,
          fx,
          fy,
          processed.slideWidth,
          processed.slideHeight
        ),
      analyzedTextPaths,
      analyzedContentPaths,
      paletteTokens,
      authoredPropsAt,
      addFact
    );
  });

  for (const budget of blockSlotBudgets(context.document, expanded.blocks)) {
    addFact({
      id: `pptx:block-slot:${budget.path}`,
      kind: 'pptx/block-slot',
      ...budget,
    });
  }
  const slotTextNodes = textNodesBySlot(processed, slideIndexes, sourceMap);
  for (const role of blockSlotRoles(context.document, expanded.blocks)) {
    const present =
      role.value !== undefined &&
      role.value !== null &&
      role.value !== '' &&
      role.value !== false &&
      (!Array.isArray(role.value) || role.value.length > 0);
    const bound = slotTextNodes.get(role.path);
    let measured: { estimatedLines: number; fontSizePt: number } | undefined;
    if (bound && typeof bound.props.text === 'string') {
      const typography = resolveTypography(bound.props, ctx);
      const box = resolveBox(
        bound.props,
        processed.grid,
        processed.slideWidth,
        processed.slideHeight
      );
      if (box.widthPt !== undefined && box.widthPt > 0)
        measured = {
          estimatedLines: estimateTextLines(
            bound.props.text,
            box.widthPt,
            typography.fontSize
          ),
          fontSizePt: typography.fontSize,
        };
    }
    addFact({
      id: `pptx:chrome-slot:${role.path}`,
      kind: 'pptx/chrome-slot',
      path: role.path,
      relatedPaths: [role.invocation],
      block: role.block,
      invocation: role.invocation,
      slot: role.slot,
      role: role.role,
      present,
      ...(typeof role.value === 'string' && { text: role.value }),
      ...measured,
    });
  }

  return {
    format: 'pptx',
    model: {
      authored: document,
      document: expanded.document,
      theme: context.theme,
      processed,
    },
    facts,
    provenance,
    renderer: options.renderer ?? DEFAULT_PPTX_RENDERER_ID,
    ...(expanded.blocks.length > 0 && {
      metadata: {
        blocks: {
          sourceMap,
          blocks: expanded.blocks,
          document: expanded.document,
        } satisfies PptxBlocksMetadata,
      },
    }),
  };
}

/**
 * The processed text node each authored slot became, keyed by slot pointer.
 * Layout has already given every node its absolute box, so a slot's text can
 * be measured in the frame the definition drew for it.
 */
function textNodesBySlot(
  processed: ProcessedPresentation,
  slideIndexes: readonly number[],
  sourceMap: BlockSourceMap
): Map<string, { props: Rec }> {
  const found = new Map<string, { props: Rec }>();
  const visit = (component: PptxComponentInput, path: string): void => {
    if (component.enabled === false) return;
    if (component.name === 'text') {
      const origin = toAuthoredPointer(sourceMap, `${path}/props/text`);
      if (origin !== `${path}/props/text` && !found.has(origin))
        found.set(origin, { props: asRecord(component.props) ?? {} });
    }
    (component.children ?? []).forEach((child, index) =>
      visit(child, `${path}/children/${index}`)
    );
  };
  processed.slides.forEach((slide, renderedIndex) => {
    const authoredIndex = slideIndexes[renderedIndex];
    if (authoredIndex === undefined) return;
    slide.components.forEach((component, index) =>
      visit(component, `/children/${authoredIndex}/children/${index}`)
    );
  });
  return found;
}

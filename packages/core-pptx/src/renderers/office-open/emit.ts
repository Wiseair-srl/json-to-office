/**
 * PptxIR → `@office-open/pptx` options.
 *
 * The mapping is unusually direct because the two models agree on units: EMU
 * for geometry, points for font sizes, degrees for angles, percent for gradient
 * stops. Bare numbers reach the backend in exactly those units — the
 * `UniversalMeasure` string form is never used here, because a value that has
 * already been resolved has no business being re-parsed.
 *
 * Backend gaps are handled by *not declaring the capability* in `index.ts`, so
 * anything this module cannot express has already been rejected before it is
 * called. Reaching a `throw` here is a bug, not a user error.
 */

import { assertNever } from '@json-to-office/shared/rendering';
import type {
  PptxIrBackground,
  PptxIrColor,
  PptxIrElement,
  PptxIrFill,
  PptxIrGeometry,
  PptxIrGroupElement,
  PptxIrHyperlink,
  PptxIrImageElement,
  PptxIrLine,
  PptxIrResource,
  PptxIrShadow,
  PptxIrShapeElement,
  PptxIrTableBorder,
  PptxIrTableElement,
  PptxIrChartElement,
  PptxIrChartOptions,
  PptxIrTextBodyStyle,
  PptxIrTextBoxElement,
  PptxIrTextRun,
  PptxIrTransform,
} from '../../ir/types';
import type {
  BackgroundOptions,
  CellBorderOptions,
  ChartOptions,
  EffectListOptions,
  FillOptions,
  GroupOptions,
  OutlineOptions,
  ParagraphDescriptorOptions,
  PictureOptions,
  ShapeOptions,
  SlideChild,
  TableCellOptions,
  TableOptions,
  TableRowOptions,
  TextBodyOptions,
  TextHyperlinkOptions,
  TextParagraphPropertiesOptions,
  TextRunOptions,
} from '@office-open/pptx';
import { chartLook, withSeriesLook } from '@json-to-office/shared/rendering';
import { chartInput } from './chartParts';

/*
 * Typed against the backend's own option types, so a renamed or moved option
 * fails the build instead of reaching the backend as a key it skips. The IR
 * carries OOXML's names as plain strings where the backend spells a union.
 */
type ShapeProperties = NonNullable<ShapeOptions['properties']>;
type Geometry = Exclude<ShapeProperties['geometry'], object | undefined>;
type SolidColor = Extract<FillOptions, { type: 'solid' }>['color'];
type PatternFill = Extract<FillOptions, { type: 'pattern' }>;
type Bullet = NonNullable<TextParagraphPropertiesOptions['bullet']>;

export type ResourceLookup = ReadonlyMap<string, PptxIrResource>;

export interface OfficeOpenEmitContext {
  resources: ResourceLookup;
  /** Bytes for file and remote resources, fetched before rendering. */
  resourceBytes: ReadonlyMap<string, Uint8Array>;
  /**
   * Allocates the drawing id for the next element on the current slide.
   *
   * The backend numbers elements from a counter that lives for the life of the
   * process, so a second render of the same deck produces different ids and
   * different bytes. Numbering them here, per slide, makes a render depend only
   * on its input.
   */
  nextId: () => number;
  /**
   * Charts, in the order they were emitted.
   *
   * The post-generation pass reads this to package each chart part's
   * workbook. Matched to parts by content rather than by this order — see
   * `chart-parts` in `@json-to-office/shared/rendering`.
   */
  charts?: PptxIrChartElement[];
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Geometry: a bare `prst` name, which is what the backend interpolates. */
function geometryName(geometry: PptxIrGeometry): Geometry {
  return (
    typeof geometry === 'string' ? geometry : geometry.custom
  ) as Geometry;
}

function frame(transform: PptxIrTransform): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: transform.xEmu,
    y: transform.yEmu,
    width: transform.widthEmu,
    height: transform.heightEmu,
  };
}

/**
 * A colour.
 *
 * `FillOptions` accepts a bare hex string for the common opaque case; anything
 * with transparency needs the object form with an `alpha` transform.
 */
function color(value: PptxIrColor): SolidColor {
  if (value.transparency === undefined) return value.hex;
  return {
    value: value.hex,
    transforms: { alpha: 100 - value.transparency },
  };
}

/**
 * OOXML `prst` pattern names → the backend's friendly names.
 *
 * `PresetPattern` spells `pct25` as `percent25`; the IR carries the OOXML name,
 * so the mapping happens here rather than in the IR.
 */
const PATTERN_NAMES: Readonly<Record<string, string>> = {
  pct5: 'percent5',
  pct10: 'percent10',
  pct20: 'percent20',
  pct25: 'percent25',
  pct30: 'percent30',
  pct40: 'percent40',
  pct50: 'percent50',
  pct60: 'percent60',
  pct70: 'percent70',
  pct75: 'percent75',
  pct80: 'percent80',
  pct90: 'percent90',
  horz: 'horizontal',
  vert: 'vertical',
  ltHorz: 'lightHorizontal',
  ltVert: 'lightVertical',
  dkHorz: 'darkHorizontal',
  dkVert: 'darkVertical',
  narHorz: 'narrowHorizontal',
  narVert: 'narrowVertical',
  cross: 'cross',
  diagCross: 'diagonalCross',
  upDiag: 'upwardDiagonal',
  dnDiag: 'downwardDiagonal',
  ltUpDiag: 'lightUpwardDiagonal',
  ltDnDiag: 'lightDownwardDiagonal',
  dkUpDiag: 'darkUpwardDiagonal',
  dkDnDiag: 'darkDownwardDiagonal',
  wdUpDiag: 'wideUpwardDiagonal',
  wdDnDiag: 'wideDownwardDiagonal',
  smGrid: 'smallGrid',
  lgGrid: 'largeGrid',
  dotGrid: 'dottedGrid',
  smCheck: 'smallCheckerBoard',
  lgCheck: 'largeCheckerBoard',
  trellis: 'trellis',
  divot: 'divot',
  shingle: 'shingle',
  weave: 'weave',
  plaid: 'plaid',
  sphere: 'sphere',
  zigZag: 'zigZag',
  wave: 'wave',
};

export function fill(
  value: PptxIrFill,
  ctx: OfficeOpenEmitContext
): FillOptions {
  switch (value.kind) {
    case 'none':
      return { type: 'none' };
    case 'solid':
      return { type: 'solid', color: color(value.color) };
    case 'gradient': {
      const stops = value.gradient.stops.map((stop) => ({
        position: stop.position,
        color: color(stop.color),
      }));
      return value.gradient.type === 'radial'
        ? { type: 'gradient', path: 'circle', stops }
        : { type: 'gradient', angle: value.gradient.angleDegrees, stops };
    }
    case 'pattern':
      return {
        type: 'pattern',
        pattern: (PATTERN_NAMES[value.preset] ??
          value.preset) as PatternFill['pattern'],
        foregroundColor: color(
          value.foreground
        ) as PatternFill['foregroundColor'],
        backgroundColor: color(
          value.background
        ) as PatternFill['backgroundColor'],
      };
    case 'image': {
      const bytes = ctx.resourceBytes.get(value.resourceId);
      const resource = ctx.resources.get(value.resourceId);
      if (!bytes || !resource) {
        throw new Error(
          `image fill references unresolved resource "${value.resourceId}"`
        );
      }
      return {
        type: 'blip',
        data: bytes,
        imageType: pictureType(resource),
      } as FillOptions;
    }
    default:
      return assertNever(value, 'PptxIrFill');
  }
}

/**
 * A line, or nothing: an empty `OutlineOptions` writes an empty `a:ln`, which
 * states "the default line" where the IR said nothing at all.
 */
function outline(line: PptxIrLine): OutlineOptions | undefined {
  const opts: OutlineOptions = {};
  if (line.color) opts.color = color(line.color);
  // Outline width is EMU; the IR keeps stroke width in points.
  if (line.widthPoints !== undefined) {
    opts.width = Math.round(line.widthPoints * 12700);
  }
  if (line.dash) opts.dash = line.dash as OutlineOptions['dash'];
  return Object.keys(opts).length > 0 ? opts : undefined;
}

function effects(shadow: PptxIrShadow): EffectListOptions {
  return {
    outerShadow: {
      blurRadius: Math.round(shadow.blurPoints * 12700),
      distance: Math.round(shadow.offsetPoints * 12700),
      direction: shadow.angleDegrees,
      color: {
        value: shadow.color.hex,
        transforms: { alpha: Math.round(shadow.opacity * 100) },
      },
    },
  };
}

function hyperlink(link: PptxIrHyperlink): TextHyperlinkOptions {
  return link.kind === 'external'
    ? { url: link.url, ...(link.tooltip ? { tooltip: link.tooltip } : {}) }
    : {
        slide: link.slideIndex,
        ...(link.tooltip ? { tooltip: link.tooltip } : {}),
      };
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

type Alignment = NonNullable<TextParagraphPropertiesOptions['alignment']>;
const ALIGNMENT: Readonly<Record<string, Alignment>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
};

/** The backend's vertical anchors, which name the middle `center`. */
const ANCHOR = {
  top: 'top',
  middle: 'center',
  bottom: 'bottom',
} as const;

function runProperties(run: PptxIrTextRun): TextRunOptions {
  const opts: TextRunOptions = {
    size: run.fontSize,
    font: run.fontFamily,
    fill: { type: 'solid', color: color(run.color) },
  };
  if (run.bold !== undefined) opts.bold = run.bold;
  if (run.italic !== undefined) opts.italic = run.italic;
  // `sngStrike`, spelled as the backend names it. The `single` this used to
  // pass is no `ST_TextStrikeType` value, and PowerPoint hung opening a deck
  // that carried one.
  if (run.strike) opts.strike = 'singleStrike';
  if (run.underline) opts.underline = 'single';
  if (run.superscript) opts.baseline = 30;
  if (run.subscript) opts.baseline = -25;
  if (run.characterSpacing !== undefined) opts.spacing = run.characterSpacing;
  if (run.language) opts.lang = run.language;
  if (run.hyperlink) opts.hyperlink = hyperlink(run.hyperlink);
  return opts;
}

/**
 * Build a text body.
 *
 * `breakAfter` on a run starts a new paragraph, which is how the IR expresses a
 * hard break inside a body.
 */
export function textBody(
  runs: readonly PptxIrTextRun[],
  style: PptxIrTextBodyStyle | undefined
): TextBodyOptions {
  const paragraphs: ParagraphDescriptorOptions[] = [];
  let current: TextRunOptions[] = [];

  const flush = () => {
    paragraphs.push({
      ...(style ? { properties: paragraphProperties(style) } : {}),
      children: current,
    });
    current = [];
  };

  for (const run of runs) {
    current.push({ text: run.text, ...runProperties(run) });
    if (run.breakAfter) flush();
  }
  if (current.length > 0 || paragraphs.length === 0) flush();

  const body: TextBodyOptions = { paragraphs };
  if (style) {
    body.anchor = ANCHOR[style.verticalAlign] ?? 'top';
    if (style.autoFit) body.autoFit = 'shape';
    if (style.insetPoints !== undefined) {
      body.margins = insetMargins(style.insetPoints);
    }
  }
  return body;
}

/**
 * A body or cell inset, in the backend's per-side form.
 *
 * The four-value tuple is CSS-ordered — `[top, right, bottom, left]` — which is
 * what the authoring schema states and what the default backend reads. Naming
 * the sides here rather than positionally is what keeps the two adapters
 * agreeing on which edge a value belongs to.
 */
function insetMargins(
  inset: number | [number, number, number, number]
): NonNullable<TextBodyOptions['margins']> {
  const toEmu = (points: number) => Math.round(points * 12700);
  if (typeof inset === 'number') {
    const value = toEmu(inset);
    return { left: value, top: value, right: value, bottom: value };
  }
  const [top, right, bottom, left] = inset;
  return {
    left: toEmu(left),
    top: toEmu(top),
    right: toEmu(right),
    bottom: toEmu(bottom),
  };
}

function paragraphProperties(
  style: PptxIrTextBodyStyle
): TextParagraphPropertiesOptions {
  const opts: TextParagraphPropertiesOptions = {};
  if (style.align) opts.alignment = ALIGNMENT[style.align] ?? style.align;
  if (style.lineSpacingMultiple !== undefined) {
    opts.lineSpacingPercent = style.lineSpacingMultiple * 100;
  } else if (style.lineSpacingPoints !== undefined) {
    opts.lineSpacingPoints = style.lineSpacingPoints;
  }
  if (style.spaceBeforePoints !== undefined) {
    opts.spaceBefore = style.spaceBeforePoints;
  }
  if (style.spaceAfterPoints !== undefined) {
    opts.spaceAfter = style.spaceAfterPoints;
  }
  if (style.bullet) opts.bullet = bulletOption(style.bullet);
  return opts;
}

const BULLET_FONT = 'Arial';

/**
 * A bullet in the backend's vocabulary.
 *
 * The discriminants are the backend's own — `char`, `autoNum`, `none` — and it
 * writes nothing at all for a value it does not recognise, so a near-miss here
 * is a silent loss rather than a type error.
 *
 * A marker is set in Arial, the face PowerPoint gives a bullet it adds. The
 * backend wrote it unasked until 0.14, which writes no `a:buFont` unless given
 * one and so leaves the marker in the text's own face.
 */
function bulletOption(
  bullet: NonNullable<PptxIrTextBodyStyle['bullet']>
): Bullet {
  if (bullet.type === 'none') return { type: 'none' };
  if (bullet.type === 'number') {
    return {
      type: 'autoNum',
      font: BULLET_FONT,
      ...(bullet.style
        ? {
            format: bullet.style as Extract<
              Bullet,
              { type: 'autoNum' }
            >['format'],
          }
        : {}),
      ...(bullet.startAt !== undefined ? { startAt: bullet.startAt } : {}),
    };
  }
  return { type: 'char', char: bullet.style ?? '•', font: BULLET_FONT };
}

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

function textBoxChild(
  element: PptxIrTextBoxElement,
  ctx: OfficeOpenEmitContext
): SlideChild {
  // A shape cannot carry a link here, so a body-level link is pushed onto the
  // runs it covers — which is what the link means anyway.
  const runs = element.hyperlink
    ? element.runs.map((run) => ({ ...run, hyperlink: element.hyperlink }))
    : element.runs;

  const line = element.line ? outline(element.line) : undefined;
  const shape: ShapeOptions = {
    id: ctx.nextId(),
    ...frame(element.transform),
    // A shape's fill, geometry, line and effects are its `p:spPr`, which the
    // backend takes as one `properties` object.
    properties: {
      geometry: 'rect',
      fill: element.fill ? fill(element.fill, ctx) : { type: 'none' },
      ...(line ? { outline: line } : {}),
      ...(element.shadow ? { effects: effects(element.shadow) } : {}),
    },
    textBody: textBody(runs, element.style),
  };
  if (element.transform.rotationDegrees !== undefined) {
    shape.rotation = element.transform.rotationDegrees;
  }
  if (element.altText) shape.description = element.altText;
  return { shape };
}

function shapeChild(
  element: PptxIrShapeElement,
  ctx: OfficeOpenEmitContext
): SlideChild {
  const line = element.line ? outline(element.line) : undefined;
  const shape: ShapeOptions = {
    id: ctx.nextId(),
    ...frame(element.transform),
    properties: {
      geometry: geometryName(element.geometry),
      ...(element.fill ? { fill: fill(element.fill, ctx) } : {}),
      ...(line ? { outline: line } : {}),
      ...(element.shadow ? { effects: effects(element.shadow) } : {}),
    },
  };
  if (element.transform.rotationDegrees !== undefined) {
    shape.rotation = element.transform.rotationDegrees;
  }
  if (element.transform.flipHorizontal) shape.flipHorizontal = true;
  if (element.runs && element.runs.length > 0) {
    shape.textBody = textBody(element.runs, element.style);
  }
  if (element.altText) shape.description = element.altText;
  return { shape };
}

/** Media type → the backend's picture `type` discriminator. */
function pictureType(resource: PptxIrResource): PictureOptions['type'] {
  switch (resource.mediaType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/png':
      return 'png';
    default:
      // Guessing would label an SVG — or anything else — as a PNG and ship a
      // broken image. Capability checking rejects the types this backend
      // cannot take, so an unknown one here means the media type could not be
      // determined at all.
      throw new Error(
        `cannot determine the picture type for resource "${resource.id}"` +
          (resource.mediaType ? ` (media type ${resource.mediaType})` : '')
      );
  }
}

function pictureChild(
  element: PptxIrImageElement,
  ctx: OfficeOpenEmitContext
): SlideChild {
  const resource = ctx.resources.get(element.resourceId);
  const bytes = ctx.resourceBytes.get(element.resourceId);
  if (!resource || !bytes) {
    throw new Error(
      `image ${element.path} references unresolved resource "${element.resourceId}"`
    );
  }
  const picture: PictureOptions = {
    id: ctx.nextId(),
    ...frame(element.transform),
    data: bytes,
    type: pictureType(resource),
  };
  if (element.shadow) picture.effects = effects(element.shadow);
  if (element.altText) picture.description = element.altText;
  return { picture };
}

/**
 * A table.
 *
 * Cells carry `children` (paragraphs), not a text body, and cell formatting is
 * flattened onto the single run each cell holds — the authoring surface gives a
 * cell one string, so one run is the whole of it.
 *
 * Table-level border, fill and inset are cell properties here. The backend's
 * own `TableOptions.borders` distributes only to the *edge* cells, which is a
 * frame rather than the grid the IR describes, and it has no table-level fill
 * at all — so both are pushed onto every cell that does not override them,
 * which is the same thing the default backend's table options mean.
 *
 * Merged cells, rounded corners and pagination are deliberately absent from
 * this adapter's capabilities: the backend expresses a merge as
 * `restart`/`continue` markers on the covered cells whereas the IR carries span
 * counts, OOXML has no table corner radius, and nothing here can flow a table
 * onto a second slide.
 */
function tableChild(
  element: PptxIrTableElement,
  ctx: OfficeOpenEmitContext
): SlideChild {
  const columnCount = Math.max(
    ...element.rows.map((row) => row.cells.length),
    1
  );
  const columnWidths =
    element.columnWidthsEmu.length === columnCount
      ? [...element.columnWidthsEmu]
      : evenColumns(element, columnCount);

  const rows = element.rows.map((row, rowIndex) => {
    const out: TableRowOptions = {
      cells: row.cells.map((cell) => tableCell(cell, element)),
    };
    const height = element.rowHeightsEmu[rowIndex];
    if (height !== undefined) out.height = height;
    return out;
  });

  const table: TableOptions = {
    id: ctx.nextId(),
    ...frame(element.transform),
    columnWidths,
    rows,
  };
  return { table };
}

function tableCell(
  cell: PptxIrTableElement['rows'][number]['cells'][number],
  element: PptxIrTableElement
): TableCellOptions {
  const formatting = cell.formatting;
  const defaults = element.defaults;

  const runProps: TextRunOptions = {
    size: formatting?.fontSize ?? defaults.fontSize,
    font: formatting?.fontFamily ?? defaults.fontFamily,
  };
  const cellColor = formatting?.color ?? defaults.color;
  if (cellColor) runProps.fill = { type: 'solid', color: color(cellColor) };
  const bold = formatting?.bold ?? defaults.bold;
  if (bold !== undefined) runProps.bold = bold;
  if (formatting?.italic !== undefined) runProps.italic = formatting.italic;

  const align = formatting?.align ?? defaults.align;
  const paragraph: ParagraphDescriptorOptions = {
    children: [{ text: cell.text, ...runProps }],
  };
  if (align) {
    paragraph.properties = { alignment: ALIGNMENT[align] ?? align };
  }

  const out: TableCellOptions = {
    children: [paragraph],
    verticalAlign: ANCHOR[formatting?.verticalAlign ?? defaults.verticalAlign],
  };

  // Cell first, table second — the table's value is the default a cell may
  // override, exactly as `tblPr` layers under `tcPr`.
  const fill = cell.fill ?? element.fill;
  if (fill) out.fill = { type: 'solid', color: color(fill) };

  // No cell inset. `TableCellOptions.margins` writes `lIns`/`tIns` onto the
  // cell's own `a:bodyPr`, and a reader takes a cell's padding from
  // `a:tcPr/@marL` — a LibreOffice render moves not one point for a 40pt
  // margin written that way. `table-insets` is therefore not declared, and a
  // table with one is refused before any of this runs.

  const borders = cellBorders(cell, element);
  if (borders) out.borders = borders;

  return out;
}

/** OOXML dash names for the IR's border vocabulary. `none` draws nothing. */
const BORDER_DASH: Record<string, CellBorderOptions['dashStyle']> = {
  solid: 'solid',
  dash: 'dash',
  dot: 'sysDot',
};

/**
 * A cell's four edges.
 *
 * Per-side borders win where the IR carries them; otherwise the table's uniform
 * border applies to every edge of every cell, which is what "uniform" means and
 * what the default backend draws.
 */
function cellBorders(
  cell: PptxIrTableElement['rows'][number]['cells'][number],
  element: PptxIrTableElement
): TableCellOptions['borders'] {
  if (cell.borders) {
    const [top, right, bottom, left] = cell.borders;
    const out: NonNullable<TableCellOptions['borders']> = {};
    if (top.type !== 'none') out.top = borderLine(top);
    if (right.type !== 'none') out.right = borderLine(right);
    if (bottom.type !== 'none') out.bottom = borderLine(bottom);
    if (left.type !== 'none') out.left = borderLine(left);
    return Object.keys(out).length > 0 ? out : undefined;
  }

  const border = element.border;
  if (!border || border.type === 'none') return undefined;
  const line = borderLine(border);
  return { top: line, right: line, bottom: line, left: line };
}

function borderLine(border: PptxIrTableBorder): CellBorderOptions {
  const dashStyle = BORDER_DASH[border.type];
  return {
    // Points → EMU: a bare number is EMU to this backend, and a border stated
    // in points would otherwise be drawn 12,700 times too thin.
    ...(border.widthPoints !== undefined
      ? { width: Math.round(border.widthPoints * 12700) }
      : {}),
    ...(border.color
      ? { color: color(border.color) as CellBorderOptions['color'] }
      : {}),
    ...(dashStyle ? { dashStyle } : {}),
  };
}

/** Even column widths when the IR did not carry a matching set. */
function evenColumns(
  element: PptxIrTableElement,
  columnCount: number
): number[] {
  const each = Math.floor(element.transform.widthEmu / columnCount);
  return Array.from({ length: columnCount }, () => each);
}

function groupChild(
  element: PptxIrGroupElement,
  ctx: OfficeOpenEmitContext
): SlideChild {
  const group: GroupOptions = {
    id: ctx.nextId(),
    ...frame(element.transform),
    childOffsetX: element.transform.xEmu,
    childOffsetY: element.transform.yEmu,
    childExtentWidth: element.transform.widthEmu,
    childExtentHeight: element.transform.heightEmu,
    children: element.children.map((child) => slideChild(child, ctx)),
  };
  if (element.transform.rotationDegrees !== undefined) {
    group.rotation = element.transform.rotationDegrees;
  }
  return { group };
}

/**
 * A chart, with its look and references as backend options.
 *
 * `@office-open/pptx` hands the whole options object to `chartSpaceDesc`: the
 * type, data and labels given here, and the look the shared `chartLook` states
 * from `chartInput` — the cell references behind every cached value, the
 * colours, the axes with their titles and scale, the grouping and gaps, the
 * fonts, and `c:externalData`. The workbook that reference names is packaged
 * afterwards, since this backend embeds none — see `chartParts.ts`.
 */
function chartChild(
  element: PptxIrChartElement,
  ctx: OfficeOpenEmitContext
): ChartOptions {
  const { options, transform } = element;
  const series = element.series;
  const dataLabels = dataLabelOptions(options);
  const marker = markerOptions(options);

  // Unreachable through validation, which refuses bubble charts on this
  // renderer by name. Stated here too because a caller can bypass validation,
  // and the backend's own failure is a TypeError raised from inside its
  // bundle — see `collectPptxRendererErrors`.
  if (element.chartType === 'bubble') {
    throw new Error(
      `the office-open renderer does not draw bubble charts (${element.path}); ` +
        'use the pptxgenjs renderer for this chart'
    );
  }

  const look = chartLook(chartInput(element));
  return {
    // Stated, never left to the backend: `_nextChartId` in
    // `@office-open/pptx` is module-level and never resets, so an unnamed
    // chart is numbered differently on every render in the same process.
    id: ctx.nextId(),
    ...chartTypeOptions(element),
    categories: series[0]?.labels ?? [],
    series: series.map((entry, index) =>
      withSeriesLook(
        {
          name: entry.name ?? `Series ${index + 1}`,
          values: entry.values ?? [],
          // Every series, not just the first: PowerPoint labels each one, and
          // a chart that labelled only its first series would be a different
          // chart.
          ...(dataLabels ? { dataLabels } : {}),
          ...(options.lineSmooth !== undefined
            ? { smooth: options.lineSmooth }
            : {}),
          ...(marker ? { marker } : {}),
        },
        look.series[index]
      )
    ),
    ...look.chart,
    ...(options.showLegend !== undefined
      ? { showLegend: options.showLegend }
      : {}),
    x: transform.xEmu,
    y: transform.yEmu,
    width: transform.widthEmu,
    height: transform.heightEmu,
    ...(element.altText ? { description: element.altText } : {}),
  };
}

type ChartSeries = ChartOptions['series'][number];
type DataLabels = NonNullable<ChartSeries['dataLabels']>;
type Marker = NonNullable<ChartSeries['marker']>;

/** OOXML's data label positions, which the backend names in full. */
const DATA_LABEL_POSITIONS: Readonly<
  Record<string, NonNullable<DataLabels['position']>>
> = {
  bestFit: 'bestFit',
  b: 'bottom',
  ctr: 'center',
  inBase: 'insideBase',
  inEnd: 'insideEnd',
  l: 'left',
  outEnd: 'outsideEnd',
  r: 'right',
  t: 'top',
};

/**
 * The data labels a series carries, or nothing if none were authored.
 *
 * Every flag is written once any of them is, and that is not tidiness. A
 * `CT_Boolean` in DrawingML has an *optional* `val` that defaults to **true**,
 * so `<c:dLbls><c:showVal/></c:dLbls>` does not mean "show the value": it means
 * show the value, the category name, the series name, the percentage and the
 * legend key, because every flag left out defaults to on. A chart authored with
 * `showValue: true` came out labelled `Q1; Revenue; 120`. pptxgenjs writes all
 * six for the same reason.
 *
 * So an unauthored flag is written `false` rather than omitted — but only once
 * the author has asked for labels at all. A chart that said nothing about them
 * gets no `c:dLbls`, and keeps the backend's own defaults.
 */
function dataLabelOptions(options: PptxIrChartOptions): DataLabels | undefined {
  const authored =
    options.showValue !== undefined ||
    options.showPercent !== undefined ||
    options.showLabel !== undefined ||
    options.showSeriesName !== undefined ||
    options.dataLabelPosition !== undefined;
  if (!authored) return undefined;

  return {
    showVal: options.showValue ?? false,
    showPercent: options.showPercent ?? false,
    showCatName: options.showLabel ?? false,
    showSerName: options.showSeriesName ?? false,
    showBubbleSize: false,
    showLegendKey: false,
    ...(options.dataLabelPosition
      ? {
          position:
            DATA_LABEL_POSITIONS[options.dataLabelPosition] ??
            (options.dataLabelPosition as DataLabels['position']),
        }
      : {}),
  };
}

/**
 * The marker a line series draws at each point, or nothing if unstyled.
 *
 * `lineSize` is deliberately absent: it is the series line's width, which the
 * shared look puts on the series' own `c:spPr/a:ln`.
 */
function markerOptions(options: PptxIrChartOptions): Marker | undefined {
  const marker: Marker = {
    ...(options.lineDataSymbol
      ? { symbol: options.lineDataSymbol as Marker['symbol'] }
      : {}),
    ...(options.lineDataSymbolSize !== undefined
      ? { size: options.lineDataSymbolSize }
      : {}),
  };
  return Object.keys(marker).length > 0 ? marker : undefined;
}

/**
 * The backend's chart type, and the 3-D flag that goes with it.
 *
 * The two vocabularies disagree in one place each way. PowerPoint spells a
 * vertical bar chart as `bar` with `barDir: "col"` — which is the *default* —
 * while `@office-open` gives it its own type name, `column`. And the IR's
 * `bar3D` has no counterpart at all: it is a bar chart with the depth flag set.
 * Reading `barDirection` here is what keeps a deck's columns from coming out on
 * their side.
 */
function chartTypeOptions(
  element: PptxIrChartElement
): Pick<ChartOptions, 'type' | 'threeD'> {
  const horizontal = element.options.barDirection === 'bar';
  switch (element.chartType) {
    case 'bar':
      return { type: horizontal ? 'bar' : 'column' };
    case 'bar3D':
      return { type: horizontal ? 'bar' : 'column', threeD: true };
    default:
      return { type: element.chartType as ChartOptions['type'] };
  }
}

export function slideChild(
  element: PptxIrElement,
  ctx: OfficeOpenEmitContext
): SlideChild {
  switch (element.kind) {
    case 'textBox':
      return textBoxChild(element, ctx);
    case 'shape':
      return shapeChild(element, ctx);
    case 'image':
      return pictureChild(element, ctx);
    case 'table':
      return tableChild(element, ctx);
    case 'group':
      return groupChild(element, ctx);
    case 'chart':
      ctx.charts?.push(element);
      return { chart: chartChild(element, ctx) };
    default:
      return assertNever(element, 'PptxIrElement');
  }
}

export function background(
  value: PptxIrBackground,
  ctx: OfficeOpenEmitContext
): BackgroundOptions {
  if (value.kind === 'solid') {
    return { fill: { type: 'solid', color: color(value.color) } };
  }
  return { fill: fill({ kind: 'image', resourceId: value.resourceId }, ctx) };
}

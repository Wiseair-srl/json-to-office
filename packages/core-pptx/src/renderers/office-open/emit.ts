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

type Opts = Record<string, unknown>;

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
   * The post-generation splice reads this to give each chart part the cell
   * references and series colours the backend leaves out. Matched to parts by
   * content rather than by this order — see `chart-parts` in
   * `@json-to-office/shared/rendering`.
   */
  charts?: PptxIrChartElement[];
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Geometry: a bare `prst` name, which is what the backend interpolates. */
function geometryName(geometry: PptxIrGeometry): string {
  return typeof geometry === 'string' ? geometry : geometry.custom;
}

function frame(transform: PptxIrTransform): Opts {
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
function color(value: PptxIrColor): unknown {
  if (value.transparency === undefined) return value.hex;
  return {
    type: 'srgb',
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

export function fill(value: PptxIrFill, ctx: OfficeOpenEmitContext): unknown {
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
        pattern: PATTERN_NAMES[value.preset] ?? value.preset,
        foregroundColor: color(value.foreground),
        backgroundColor: color(value.background),
      };
    case 'image': {
      const bytes = ctx.resourceBytes.get(value.resourceId);
      const resource = ctx.resources.get(value.resourceId);
      if (!bytes || !resource) {
        throw new Error(
          `image fill references unresolved resource "${value.resourceId}"`
        );
      }
      return { type: 'blip', data: bytes, imageType: pictureType(resource) };
    }
    default:
      return assertNever(value, 'PptxIrFill');
  }
}

function outline(line: PptxIrLine): Opts {
  const opts: Opts = {};
  if (line.color) opts.fill = { type: 'solid', color: color(line.color) };
  // Outline width is EMU; the IR keeps stroke width in points.
  if (line.widthPoints !== undefined) {
    opts.width = Math.round(line.widthPoints * 12700);
  }
  if (line.dash) opts.dash = line.dash;
  return opts;
}

function effects(shadow: PptxIrShadow): Opts {
  return {
    outerShadow: {
      blurRadius: Math.round(shadow.blurPoints * 12700),
      distance: Math.round(shadow.offsetPoints * 12700),
      direction: shadow.angleDegrees,
      color: {
        type: 'srgb',
        value: shadow.color.hex,
        transforms: { alpha: Math.round(shadow.opacity * 100) },
      },
    },
  };
}

function hyperlink(link: PptxIrHyperlink): Opts {
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

const ALIGNMENT: Readonly<Record<string, string>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
};

const ANCHOR: Readonly<Record<string, string>> = {
  top: 't',
  middle: 'ctr',
  bottom: 'b',
};

function runProperties(run: PptxIrTextRun): Opts {
  const opts: Opts = {
    size: run.fontSize,
    font: run.fontFamily,
    fill: { type: 'solid', color: color(run.color) },
  };
  if (run.bold !== undefined) opts.bold = run.bold;
  if (run.italic !== undefined) opts.italic = run.italic;
  if (run.strike) opts.strike = 'single';
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
): Opts {
  const paragraphs: Opts[] = [];
  let current: Opts[] = [];

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

  const body: Opts = { paragraphs };
  if (style) {
    body.anchor = ANCHOR[style.verticalAlign] ?? 't';
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
function insetMargins(inset: number | [number, number, number, number]): Opts {
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

function paragraphProperties(style: PptxIrTextBodyStyle): Opts {
  const opts: Opts = {};
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

/**
 * A bullet in the backend's vocabulary.
 *
 * The discriminants are the backend's own — `char`, `autoNum`, `none` — and it
 * writes nothing at all for a value it does not recognise, so a near-miss here
 * is a silent loss rather than a type error.
 */
function bulletOption(
  bullet: NonNullable<PptxIrTextBodyStyle['bullet']>
): Opts {
  if (bullet.type === 'none') return { type: 'none' };
  if (bullet.type === 'number') {
    return {
      type: 'autoNum',
      ...(bullet.style ? { format: bullet.style } : {}),
      ...(bullet.startAt !== undefined ? { startAt: bullet.startAt } : {}),
    };
  }
  return { type: 'char', char: bullet.style ?? '•' };
}

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

function textBoxChild(
  element: PptxIrTextBoxElement,
  ctx: OfficeOpenEmitContext
): Opts {
  // A shape cannot carry a link here, so a body-level link is pushed onto the
  // runs it covers — which is what the link means anyway.
  const runs = element.hyperlink
    ? element.runs.map((run) => ({ ...run, hyperlink: element.hyperlink }))
    : element.runs;

  const shape: Opts = {
    id: ctx.nextId(),
    ...frame(element.transform),
    geometry: 'rect',
    textBody: textBody(runs, element.style),
  };
  if (element.fill) shape.fill = fill(element.fill, ctx);
  else shape.fill = { type: 'none' };
  if (element.line) shape.outline = outline(element.line);
  if (element.shadow) shape.effects = effects(element.shadow);
  if (element.transform.rotationDegrees !== undefined) {
    shape.rotation = element.transform.rotationDegrees;
  }
  if (element.altText) shape.description = element.altText;
  return { shape };
}

function shapeChild(
  element: PptxIrShapeElement,
  ctx: OfficeOpenEmitContext
): Opts {
  const shape: Opts = {
    id: ctx.nextId(),
    ...frame(element.transform),
    geometry: geometryName(element.geometry),
  };
  if (element.fill) shape.fill = fill(element.fill, ctx);
  if (element.line) shape.outline = outline(element.line);
  if (element.shadow) shape.effects = effects(element.shadow);
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
function pictureType(resource: PptxIrResource): string {
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
): Opts {
  const resource = ctx.resources.get(element.resourceId);
  const bytes = ctx.resourceBytes.get(element.resourceId);
  if (!resource || !bytes) {
    throw new Error(
      `image ${element.path} references unresolved resource "${element.resourceId}"`
    );
  }
  const picture: Opts = {
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
): Opts {
  const columnCount = Math.max(
    ...element.rows.map((row) => row.cells.length),
    1
  );
  const columnWidths =
    element.columnWidthsEmu.length === columnCount
      ? [...element.columnWidthsEmu]
      : evenColumns(element, columnCount);

  const rows = element.rows.map((row, rowIndex) => {
    const out: Opts = {
      cells: row.cells.map((cell) => tableCell(cell, element)),
    };
    const height = element.rowHeightsEmu[rowIndex];
    if (height !== undefined) out.height = height;
    return out;
  });

  return {
    table: {
      id: ctx.nextId(),
      ...frame(element.transform),
      columnWidths,
      rows,
    },
  };
}

function tableCell(
  cell: PptxIrTableElement['rows'][number]['cells'][number],
  element: PptxIrTableElement
): Opts {
  const formatting = cell.formatting;
  const defaults = element.defaults;

  const runProps: Opts = {
    size: formatting?.fontSize ?? defaults.fontSize,
    font: formatting?.fontFamily ?? defaults.fontFamily,
  };
  const cellColor = formatting?.color ?? defaults.color;
  if (cellColor) runProps.fill = { type: 'solid', color: color(cellColor) };
  const bold = formatting?.bold ?? defaults.bold;
  if (bold !== undefined) runProps.bold = bold;
  if (formatting?.italic !== undefined) runProps.italic = formatting.italic;

  const align = formatting?.align ?? defaults.align;
  const paragraph: Opts = {
    children: [{ text: cell.text, ...runProps }],
  };
  if (align) {
    paragraph.properties = { alignment: ALIGNMENT[align] ?? align };
  }

  const out: Opts = {
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
const BORDER_DASH: Record<string, string | undefined> = {
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
): Opts | undefined {
  if (cell.borders) {
    const [top, right, bottom, left] = cell.borders;
    const out: Opts = {};
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

function borderLine(border: PptxIrTableBorder): Opts {
  const dashStyle = BORDER_DASH[border.type];
  return {
    // Points → EMU: a bare number is EMU to this backend, and a border stated
    // in points would otherwise be drawn 12,700 times too thin.
    ...(border.widthPoints !== undefined
      ? { width: Math.round(border.widthPoints * 12700) }
      : {}),
    ...(border.color ? { color: color(border.color) } : {}),
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
): Opts {
  const group: Opts = {
    id: ctx.nextId(),
    ...frame(element.transform),
    childOffset: { x: element.transform.xEmu, y: element.transform.yEmu },
    childExtents: {
      width: element.transform.widthEmu,
      height: element.transform.heightEmu,
    },
    children: element.children.map((child) => slideChild(child, ctx)),
  };
  if (element.transform.rotationDegrees !== undefined) {
    group.rotation = element.transform.rotationDegrees;
  }
  return { group };
}

/**
 * A chart, in the vocabulary `@office-open/pptx` actually reads.
 *
 * Unlike its docx sibling this backend hands the whole options object to
 * `chartSpaceDesc`, so the title and the legend position survive. Passing them
 * here rather than splicing them is the cheaper half of the same job.
 *
 * `axes` is the exception, and is deliberately *not* passed. Supplying it
 * replaces the backend's default axis pair wholesale rather than adding to it,
 * and `AxisOptions` requires an `id` and a `crossAxisId` this adapter has no
 * way to allocate that the plot area would agree with. Passing a partial one
 * emitted literal `<undefined>` elements and six `val="undefined"` attributes,
 * dropping `c:catAx`, `c:axPos`, `c:scaling` and `c:crosses` with them —
 * tolerated by LibreOffice, a repair prompt in PowerPoint. Axis titles are
 * spliced into the backend's own valid axes instead, which is the path the
 * docx side already takes.
 */
function chartChild(
  element: PptxIrChartElement,
  ctx: OfficeOpenEmitContext
): Opts {
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

  return {
    // Stated, never left to the backend: `_nextChartId` in
    // `@office-open/pptx` is module-level and never resets, so an unnamed
    // chart is numbered differently on every render in the same process.
    id: ctx.nextId(),
    ...chartTypeOptions(element),
    categories: series[0]?.labels ?? [],
    series: series.map((entry, index) => ({
      name: entry.name ?? `Series ${index + 1}`,
      values: entry.values ?? [],
      // Every series, not just the first: PowerPoint labels each one, and a
      // chart that labelled only its first series would be a different chart.
      ...(dataLabels ? { dataLabels } : {}),
      ...(options.lineSmooth !== undefined
        ? { smooth: options.lineSmooth }
        : {}),
      ...(marker ? { marker } : {}),
    })),
    ...(options.title && options.showTitle !== false
      ? { title: options.title }
      : {}),
    ...(options.showLegend !== undefined
      ? { showLegend: options.showLegend }
      : {}),
    ...chartFamilyOptions(options),
    ...(options.legendPosition
      ? { legendPosition: options.legendPosition }
      : {}),
    x: transform.xEmu,
    y: transform.yEmu,
    width: transform.widthEmu,
    height: transform.heightEmu,
    ...(element.altText ? { description: element.altText } : {}),
  };
}

/**
 * Per-family tuning that `ChartSpaceOptions` carries directly.
 *
 * Bar gap and overlap, and the pie/doughnut geometry. Each is only forwarded
 * when authored — the backend has its own defaults and writing a value it did
 * not ask for is how a chart drifts from the one that was designed.
 */
function chartFamilyOptions(options: PptxIrChartOptions): Opts {
  return {
    ...(options.barGapWidthPercent !== undefined
      ? { gapWidth: options.barGapWidthPercent }
      : {}),
    ...(options.barOverlapPercent !== undefined
      ? { overlap: options.barOverlapPercent }
      : {}),
    ...(options.holeSize !== undefined ? { holeSize: options.holeSize } : {}),
    ...(options.firstSliceAngle !== undefined
      ? { firstSliceAngle: options.firstSliceAngle }
      : {}),
  };
}

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
function dataLabelOptions(options: PptxIrChartOptions): Opts | undefined {
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
      ? { position: options.dataLabelPosition }
      : {}),
  };
}

/**
 * The marker a line series draws at each point, or nothing if unstyled.
 *
 * `lineSize` is deliberately absent: `ChartSeriesCommon` has no line-width
 * field at all, so the series line's width is spliced into `c:ser/c:spPr/a:ln`
 * afterwards.
 */
function markerOptions(options: PptxIrChartOptions): Opts | undefined {
  const marker: Opts = {
    ...(options.lineDataSymbol ? { symbol: options.lineDataSymbol } : {}),
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
function chartTypeOptions(element: PptxIrChartElement): Opts {
  const horizontal = element.options.barDirection === 'bar';
  switch (element.chartType) {
    case 'bar':
      return { type: horizontal ? 'bar' : 'column' };
    case 'bar3D':
      return { type: horizontal ? 'bar' : 'column', threeD: true };
    default:
      return { type: element.chartType };
  }
}

export function slideChild(
  element: PptxIrElement,
  ctx: OfficeOpenEmitContext
): Opts {
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
): Opts {
  if (value.kind === 'solid') {
    return { fill: { type: 'solid', color: color(value.color) } };
  }
  return { fill: fill({ kind: 'image', resourceId: value.resourceId }, ctx) };
}

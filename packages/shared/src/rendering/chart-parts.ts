/**
 * The half of a native chart jto supplies around `@office-open`'s.
 *
 * Both `@office-open/docx` and `@office-open/pptx` build their chart XML with
 * the same `chartSpaceDesc` out of `@office-open/core`, and since 0.14 both
 * hand it the whole `ChartSpaceOptions`. What a chart needs beyond its type
 * and data is therefore asked for as options rather than spliced into the
 * emitted part, and all of it is visible to whoever opens the file:
 *
 * - **The workbook references.** Every `<c:f>` names the cells it caches, and
 *   `c:externalData` points at the workbook behind them, or "Edit Data" fails.
 *   The workbook itself is built here (`chartWorkbookParts`); each core
 *   packages it — the docx backend embeds it, the pptx one cannot.
 * - **The look.** Series colours, per-slice colours on a pie, line widths and
 *   markers, the axes with their titles, fonts, gridlines and scale, the
 *   grouping and gaps, the legend, and Office's own blanks around them.
 *
 * `chartLook` states all of it in the backend's vocabulary; `finishChartXml`
 * writes the one thing no option carries, a scatter chart's style.
 *
 * Format-neutral on purpose. A `c:chartSpace` is DrawingML, identical in a
 * .docx and a .pptx; only the *packaging* differs — part paths, relationship
 * files, content types, and which ZIP library the core happens to use. Those
 * stay in each core; everything here is shared, which is what keeps the two
 * formats from drifting into two different answers to the same problem.
 *
 * Nothing here touches a ZIP, a clock or a counter, so this package needs no
 * new dependency and the same series always produce the same bytes.
 */

/** The sheet a chart's cell references name. */
export const CHART_WORKBOOK_SHEET_NAME = 'Sheet1';

/** The relationship type an embedded workbook is attached by. */
export const CHART_PACKAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';

/** The content type of an embedded chart workbook. */
export const CHART_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** One resolved series, as both formats' IR carries it by the time it gets here. */
export interface ChartPartSeries {
  name?: string;
  labels: readonly string[];
  values: readonly number[];
}

/** Font family, size, weight and colour on one piece of chart text. */
export interface ChartTextStyle {
  fontFamily?: string;
  /** Points. */
  fontSize?: number;
  bold?: boolean;
  /** 6-digit hex, no `#`. */
  color?: string;
}

/**
 * A colour in a chart part: 6-digit hex, or a theme colour slot with
 * DrawingML's luminance modifiers.
 *
 * The slot form exists for the look Word gives a chart made with Insert
 * Chart, which draws its gridlines and axis lines in a tint of Text 1 (`tx1`,
 * `lumMod` 15000, `lumOff` 85000) rather than in any colour of its own, so
 * they follow the document's theme.
 */
export type ChartColor =
  | string
  | { scheme: string; lumMod?: number; lumOff?: number };

/**
 * One `a:ln`: width in points, colour, cap and join. What is absent is the
 * reader's default.
 */
export interface ChartStroke {
  widthPoints?: number;
  color?: ChartColor;
  /** `a:ln/@cap`: `rnd`, `sq` or `flat`. */
  cap?: string;
  /** The line join: `round`, `bevel` or `miter`. */
  join?: 'round' | 'bevel' | 'miter';
}

/**
 * What an authored axis asks for, in neither format's vocabulary. Anything
 * absent is the backend's default for the axis.
 */
export interface ChartAxisEdits {
  title?: string;
  /**
   * The font of this axis' title. Without one the title carries no size, face
   * or colour, and Word and PowerPoint fall back to their own large, bold
   * axis-title default — far bigger than the tick labels beside it.
   */
  titleFont?: ChartTextStyle;
  /** Title rotation, in degrees; absent leaves the reader's default. */
  titleRotation?: number;
  /** The font of this axis' tick labels. */
  labelFont?: ChartTextStyle;
  /** `c:delete`: an axis hidden entirely. */
  hidden?: boolean;
  /** `false` draws no axis line, leaving its labels. */
  lineVisible?: boolean;
  /** The axis line's stroke. `lineVisible: false` wins over it. */
  line?: ChartStroke;
  /** Label rotation, in degrees. */
  labelRotation?: number;
  gridLine?: { style?: string; size?: number; color?: ChartColor };
  /** Value-axis bounds; ignored on a category axis, which has no scale. */
  min?: number;
  max?: number;
  majorUnit?: number;
  /** A number format code, e.g. `#,##0`. */
  numberFormat?: string;
  /**
   * `c:axPos`: `b`, `l`, `r` or `t`. A backend that writes a horizontal bar
   * chart's axes where a column chart's go is read as written by LibreOffice,
   * which then sets the category axis title unturned.
   */
  position?: string;
  /** `c:majorTickMark`: `none`, `in`, `out` or `cross`. */
  majorTickMark?: string;
  /** `c:minorTickMark`, in the same vocabulary. */
  minorTickMark?: string;
  /** `c:tickLblPos`: `nextTo`, `high`, `low` or `none`. */
  tickLabelPosition?: string;
  /**
   * `c:crossBetween`, on a value axis only: `between` draws each category
   * between two ticks, `midCat` on one, so an area reaches the plot's edges.
   */
  crossBetween?: string;
}

/**
 * Everything a chart's look and references need, in neither format's
 * vocabulary.
 *
 * Each core adapts its own IR node to this rather than this module learning
 * about `DocxIrChartRun` and `PptxIrChartElement`, which would make a shared
 * module depend on both cores it exists to serve.
 */
export interface ChartPartInput {
  /** The chart type, in `@office-open`'s spelling. Decides fill vs stroke. */
  chartType: string;
  series: readonly ChartPartSeries[];
  /** Resolved series colours, uppercase 6-digit hex without `#`. May be empty. */
  colors: readonly string[];
  categoryAxis?: ChartAxisEdits;
  valueAxis?: ChartAxisEdits;
  /** Series line width in points. Only meaningful where the series is a line. */
  lineWidthPoints?: number;
  /** A line series' cap (`rnd`, `sq`, `flat`), beside `lineWidthPoints`. */
  lineCap?: string;
  /** A line series' join, beside `lineWidthPoints`. */
  lineJoin?: 'round' | 'bevel' | 'miter';
  /**
   * The width of a line series' marker outline, in points. Absent, the
   * outline is written with no width, which a reader draws as a hairline.
   */
  markerLineWidthPoints?: number;
  /**
   * An outline on filled data elements: bars, areas and slices. `none` states
   * that there is none, rather than leaving it to the reader.
   */
  dataBorder?: { widthPoints: number; color: ChartColor } | 'none';
  /** `standard`, `marker` or `filled`. */
  radarStyle?: string;
  /**
   * `line` or `lineMarker`, …. The backend writes `line` from a literal, so
   * this is the one field `finishChartXml` splices in.
   */
  scatterStyle?: string;
  /**
   * Plot options: a bar chart's `c:gapWidth` and `c:overlap`, a pie's or
   * doughnut's `c:firstSliceAng`, a doughnut's `c:holeSize`.
   */
  gapWidth?: number;
  overlap?: number;
  firstSliceAngle?: number;
  holeSize?: number;
  /** A line chart's own `c:marker`: whether its series show markers. */
  lineMarkers?: boolean;
  /**
   * `c:autoTitleDeleted`. `true` on a chart with no title of its own stops
   * Word and LibreOffice drawing one from a lone series' name.
   */
  autoTitleDeleted?: boolean;
  /** An unfilled, unbordered plot area, stated rather than left to the reader. */
  plotAreaUnfilled?: boolean;
  /**
   * A scatter chart's x values, one per point: each series' `c:xVal` is
   * written as numbers (`c:numRef`) rather than text, which a reader plots at
   * 1, 2, 3… whatever it says. The workbook's column A has to hold the same
   * numbers — see `chartWorkbookParts`.
   */
  scatterXValues?: readonly number[];
  /** The chart's own title, when it shows one. */
  title?: string;
  titleFont?: ChartTextStyle;
  /**
   * The chart-wide default in `c:chartSpace/c:txPr`, which every piece of
   * chart text that states nothing of its own (tick labels, the legend)
   * inherits. Left empty, the reader's built-in default is in charge.
   */
  textFont?: ChartTextStyle;
  legendFont?: ChartTextStyle;
  dataLabelFont?: ChartTextStyle;
  legendPosition?: string;
  /**
   * `clustered` | `stacked` | `percentStacked`. The one look option that
   * misrepresents the data rather than restyling it when lost: a chart
   * authored as "% of total" drawn as side-by-side bars summing to nothing.
   */
  barGrouping?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * The workbook
 * ------------------------------------------------------------------ */

/**
 * A spreadsheet column letter: A, B, … Z, AA, AB, …
 *
 * One-based, because a spreadsheet is. Written out rather than assumed to stay
 * under 26 — a chart with 27 series is unusual, not impossible, and the failure
 * would be a corrupt sheet rather than an error.
 */
export function columnLetter(index: number): string {
  let remaining = index;
  let letters = '';
  while (remaining > 0) {
    const rest = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** A number a spreadsheet will accept: finite, never exponential shorthand. */
function cellNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function inlineStringCell(reference: string, text: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

function numberCell(reference: string, value: number): string {
  return `<c r="${reference}"><v>${cellNumber(value)}</v></c>`;
}

/**
 * The sheet holding the chart's data.
 *
 * Laid out the way every Office chart workbook is, because the chart's own cell
 * references assume it: row 1 is the series names with A1 left blank, column A
 * is the category labels, and the values fill the rectangle between them.
 */
function sheetXml(
  series: readonly ChartPartSeries[],
  categoryValues?: readonly number[]
): string {
  // The category column is as long as the first series' labels; a value column
  // is as long as *that* series' values. They can differ: the pptx compiler
  // accepts a ragged chart (only the docx one refuses it), and writing a zero
  // to square the rectangle would put a data point in the file that the author
  // never wrote — and that the chart's own cached values do not contain.
  const rowCount = Math.max(
    series[0]?.labels.length ?? 0,
    ...series.map((entry) => entry.values.length)
  );
  const lastColumn = columnLetter(series.length + 1);
  const rows: string[] = [];

  const header = [
    `<c r="A1"/>`,
    ...series.map((entry, index) =>
      inlineStringCell(
        `${columnLetter(index + 2)}1`,
        entry.name ?? `Series ${index + 1}`
      )
    ),
  ];
  rows.push(`<row r="1">${header.join('')}</row>`);

  for (let row = 0; row < rowCount; row++) {
    const reference = row + 2;
    const label = series[0]?.labels[row];
    // A scatter chart's x values are numbers, and its `c:xVal` says so: a
    // text cell behind a numeric reference would be read back as 0.
    const x = categoryValues?.[row];
    const cells = [
      ...(x !== undefined
        ? [numberCell(`A${reference}`, x)]
        : label !== undefined
          ? [inlineStringCell(`A${reference}`, label)]
          : []),
      ...series.flatMap((entry, index) =>
        row < entry.values.length
          ? [
              numberCell(
                `${columnLetter(index + 2)}${reference}`,
                entry.values[row]
              ),
            ]
          : []
      ),
    ];
    if (cells.length === 0) continue;
    rows.push(`<row r="${reference}">${cells.join('')}</row>`);
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastColumn}${Math.max(rowCount + 1, 1)}"/>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    `</worksheet>`
  );
}

const WORKBOOK_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="${CHART_WORKBOOK_SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>` +
  `</workbook>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" ` +
  `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
  `Target="worksheets/sheet1.xml"/>` +
  `</Relationships>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" ` +
  `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
  `Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ` +
  `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ` +
  `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`;

/**
 * The parts of the xlsx a chart's `c:externalData` points at, in ZIP order.
 *
 * Returned as XML rather than as a packaged archive: `core-docx` zips with
 * adm-zip and `core-pptx` with jszip, and a shared module that picked one would
 * force a second ZIP library into whichever core did not use it. Order is fixed
 * rather than incidental, so the central directory is a function of the data.
 *
 * Deliberately minimal — five parts, one sheet, inline strings rather than a
 * shared-string table. A chart workbook is written once and read by one
 * consumer, so the compression a shared-string table buys is not worth a part
 * whose indices are one more thing to keep in step with the cells.
 */
export function chartWorkbookParts(
  series: readonly ChartPartSeries[],
  options: {
    /**
     * Column A as numbers rather than the first series' labels: a scatter
     * chart's x values, the same ones `ChartPartInput.scatterXValues` caches.
     */
    categoryValues?: readonly number[];
  } = {}
): ReadonlyArray<readonly [path: string, xml: string]> {
  return [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', WORKBOOK_XML],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/worksheets/sheet1.xml', sheetXml(series, options.categoryValues)],
  ];
}

/**
 * The cell range one series' values occupy, as a chart reference.
 *
 * The chart XML and the sheet have to agree on this exactly; deriving both from
 * one function is what keeps them from drifting apart.
 */
export function seriesValueReference(
  seriesIndex: number,
  pointCount: number
): string {
  const column = columnLetter(seriesIndex + 2);
  return `${CHART_WORKBOOK_SHEET_NAME}!$${column}$2:$${column}$${pointCount + 1}`;
}

/** The cell range the category labels occupy. */
export function categoryReference(pointCount: number): string {
  return `${CHART_WORKBOOK_SHEET_NAME}!$A$2:$A$${pointCount + 1}`;
}

/** The single cell holding one series' name. */
export function seriesNameReference(seriesIndex: number): string {
  return `${CHART_WORKBOOK_SHEET_NAME}!$${columnLetter(seriesIndex + 2)}$1`;
}

/** The relationship part attaching one workbook to one chart. */
export function chartWorkbookRelsXml(workbookName: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${CHART_PACKAGE_RELATIONSHIP}" ` +
    `Target="../embeddings/${escapeXml(workbookName)}"/>` +
    `</Relationships>`
  );
}

/* ------------------------------------------------------------------ *
 * The look, as backend options
 * ------------------------------------------------------------------ */

/*
 * What follows is a subset of `@office-open/core`'s chart vocabulary —
 * `ChartSpaceOptions`, `AxisOptions`, `ShapePropertiesOptions`,
 * `TextBodyOptions` — spelled out here rather than imported: this package does
 * not depend on the backend, and the cores that do assign these to the
 * backend's own types, so a field spelled wrong fails their build.
 */

/** A colour: hex, or a theme slot with DrawingML's luminance transforms. */
export interface LookColor {
  value: string;
  /** Percentages: the backend writes `lumMod: 15` as `val="15000"`. */
  transforms?: { lumMod?: number; lumOff?: number };
}

export type LookFill = { type: 'solid'; color: LookColor } | { type: 'none' };

/** One `a:ln`, as `OutlineOptions` takes it. */
export interface LookLine {
  /** EMU. */
  width?: number;
  cap?: 'round' | 'square' | 'flat';
  type?: 'noFill' | 'solidFill';
  color?: LookColor;
  dash?: 'solid' | 'dash' | 'sysDot';
  join?: 'round' | 'bevel' | 'miter';
}

/** A `c:spPr`, as `ShapePropertiesOptions` takes it. */
export interface LookShape {
  fill?: LookFill;
  outline?: LookLine;
  /** Present (and empty) writes an empty `a:effectLst`. */
  effects?: Record<string, never>;
}

/** Run properties, as `TextCharacterPropertiesOptions` takes them. */
export interface LookRun {
  /** Points. */
  size?: number;
  bold?: boolean;
  fill?: LookFill;
  font?: { latin: string };
  lang?: string;
}

export interface LookParagraph {
  properties?: { defaultRunProperties: LookRun };
  children?: Array<string | (LookRun & { text: string })>;
  /** `false` writes no `a:endParaRPr`; absent writes `lang="en-US"`. */
  endParagraphProperties?: LookRun | false;
}

/** A text body, as `TextBodyOptions` takes it. */
export interface LookText {
  bodyProperties?: {
    /** 60000ths of a degree, as `a:bodyPr/@rot` states it. */
    rotation?: number;
    spcFirstLastPara?: boolean;
    vertOverflow?: 'ellipsis';
    vertical?: 'horizontal';
    wrap?: 'square';
    anchor?: 'center';
    anchorCtr?: boolean;
  };
  paragraphs: LookParagraph[];
}

export interface LookTitle {
  text: LookText;
  overlay: boolean;
}

/** One axis, as `AxisOptions` takes it. */
export interface LookAxis {
  kind: 'category' | 'value';
  scaling: { orientation: 'ascending'; max?: number; min?: number };
  delete: boolean;
  position: 'bottom' | 'left' | 'right' | 'top';
  majorGridlines?: true | { shapeProperties: LookShape };
  title?: LookTitle;
  numberFormat?: { formatCode: string; sourceLinked: boolean };
  majorTickMark?: 'cross' | 'in' | 'none' | 'out';
  minorTickMark?: 'cross' | 'in' | 'none' | 'out';
  tickLabelPosition?: 'high' | 'low' | 'nextTo' | 'none';
  shapeProperties?: LookShape;
  textProperties?: LookText;
  crosses: 'zero';
  auto?: boolean;
  labelOffset?: number;
  noMultiLevelLabel?: boolean;
  crossBetween?: 'between' | 'middleOfCategory';
  majorUnit?: number;
}

/** What one series takes on top of what its emitter gave it. */
export interface SeriesLook {
  nameFormula?: string;
  valueFormula?: string;
  shapeProperties?: LookShape;
  /** Merged into the series' own marker, whose symbol and size it keeps. */
  marker?: { shapeProperties: LookShape };
  dataPoints?: Array<{
    index: number;
    bubble3D: boolean;
    shapeProperties: LookShape;
  }>;
  /** Merged into the series' own data labels; never adds labels of its own. */
  dataLabels?: { textProperties: LookText };
}

/** What a chart takes on top of what its emitter gave it. */
export interface ChartSpaceLook {
  date1904: boolean;
  lang: string;
  roundedCorners: boolean;
  autoTitleDeleted: boolean;
  title?: LookTitle;
  varyColors: boolean;
  grouping?: 'clustered' | 'standard' | 'stacked' | 'percentStacked';
  radarStyle?: 'standard' | 'marker' | 'filled';
  gapWidth?: number;
  overlap?: number;
  firstSliceAngle?: number;
  holeSize?: number;
  markers?: boolean;
  categoryFormula?: string;
  numericCategories?: boolean;
  categories?: string[];
  categoryFormatCode?: string;
  axes?: LookAxis[];
  plotAreaShapeProperties?: LookShape;
  legendPosition: 'bottom' | 'topRight' | 'left' | 'right' | 'top';
  legendLayout: true;
  legendOverlay: boolean;
  legendShapeProperties: LookShape;
  legendTextProperties: LookText;
  shapeProperties: LookShape;
  textProperties: LookText;
  externalData: { relationshipId: string; autoUpdate: boolean };
}

/** Points to EMU, the unit a line width is written in. */
const POINTS_TO_EMU = 12700;

/** The authored dash names, in the backend's `PresetDash` vocabulary. */
const DASH_STYLES: Readonly<Record<string, LookLine['dash']>> = {
  solid: 'solid',
  dash: 'dash',
  dot: 'sysDot',
};

/** OOXML's line caps, which the backend names in full. */
const LINE_CAPS: Readonly<Record<string, LookLine['cap']>> = {
  rnd: 'round',
  sq: 'square',
  flat: 'flat',
};

/** `c:axPos`, which the backend names in full. */
const AXIS_POSITIONS: Readonly<Record<string, LookAxis['position']>> = {
  b: 'bottom',
  l: 'left',
  r: 'right',
  t: 'top',
};

/** `c:legendPos`, which the backend names in full. */
const LEGEND_POSITIONS: Readonly<
  Record<string, ChartSpaceLook['legendPosition']>
> = {
  b: 'bottom',
  t: 'top',
  l: 'left',
  r: 'right',
  tr: 'topRight',
};

/** `c:crossBetween`, whose `midCat` the backend spells out. */
const CROSS_BETWEEN: Readonly<
  Record<string, NonNullable<LookAxis['crossBetween']>>
> = {
  between: 'between',
  midCat: 'middleOfCategory',
};

function known<T>(
  table: Readonly<Record<string, T>>,
  value: string,
  what: string
): T {
  const mapped = table[value];
  if (mapped === undefined) {
    throw new Error(`chart ${what} "${value}" has no backend spelling`);
  }
  return mapped;
}

/** A colour: hex, or a theme slot with its modifiers. */
function lookColor(color: ChartColor): LookColor {
  if (typeof color === 'string') return { value: color.toUpperCase() };
  // CT_SchemeColor takes its transforms as children, `lumMod` before `lumOff`;
  // the backend writes them in key order, in thousandths of these percentages.
  const transforms = {
    ...(color.lumMod !== undefined ? { lumMod: color.lumMod / 1000 } : {}),
    ...(color.lumOff !== undefined ? { lumOff: color.lumOff / 1000 } : {}),
  };
  return {
    value: color.scheme,
    ...(Object.keys(transforms).length > 0 ? { transforms } : {}),
  };
}

function solid(color: ChartColor): LookFill {
  return { type: 'solid', color: lookColor(color) };
}

/** An `a:ln`: width, cap, colour and join, each only when stated. */
function lookLine(line: ChartStroke): LookLine {
  return {
    ...(line.widthPoints !== undefined
      ? { width: Math.round(line.widthPoints * POINTS_TO_EMU) }
      : {}),
    ...(line.cap !== undefined
      ? { cap: known(LINE_CAPS, line.cap, 'line cap') }
      : {}),
    ...(line.color ? { type: 'solidFill', color: lookColor(line.color) } : {}),
    ...(line.join ? { join: line.join } : {}),
  };
}

/** A data element's outline: stated absent, or a width and colour. */
function borderLine(
  border: NonNullable<ChartPartInput['dataBorder']>
): LookLine {
  return border === 'none'
    ? { type: 'noFill' }
    : lookLine({ widthPoints: border.widthPoints, color: border.color });
}

/** Run properties for one piece of chart text. */
function lookRun(font: ChartTextStyle | undefined): LookRun {
  if (!font) return {};
  return {
    ...(font.fontSize !== undefined ? { size: font.fontSize } : {}),
    ...(font.bold !== undefined ? { bold: font.bold } : {}),
    ...(font.color ? { fill: solid(font.color) } : {}),
    // Latin only: a bare family name would be written for East Asian text too.
    ...(font.fontFamily ? { font: { latin: font.fontFamily } } : {}),
  };
}

/** Whether a text style asks for anything at all. */
function hasTextStyle(font: ChartTextStyle | undefined): boolean {
  return !!font && Object.keys(font).length > 0;
}

/**
 * A title holding one line of text.
 *
 * The font goes on both the paragraph default and, for an axis, the run, which
 * is how PowerPoint writes an axis title itself: a reader honouring only one of
 * the two still draws the intended size. A title has no `a:endParaRPr`.
 */
function lookTitle(
  text: string,
  font: ChartTextStyle | undefined,
  options: { rotation?: number; styleRun: boolean }
): LookTitle {
  const styled = hasTextStyle(font);
  return {
    text: {
      ...(options.rotation !== undefined
        ? {
            bodyProperties: {
              rotation: Math.round(options.rotation * 60000),
              vertical: 'horizontal',
            },
          }
        : {}),
      paragraphs: [
        {
          ...(styled
            ? { properties: { defaultRunProperties: lookRun(font) } }
            : {}),
          children: [
            styled && options.styleRun ? { text, ...lookRun(font) } : text,
          ],
          endParagraphProperties: false,
        },
      ],
    },
    overlay: false,
  };
}

/**
 * A `c:txPr`: a rotation, a font, or both, in one element.
 *
 * They are two properties of the same text, and an axis that wrote a second
 * `c:txPr` for the font would be a repair prompt rather than a
 * differently-styled label.
 */
function lookTextProperties(
  rotation: number | undefined,
  font: ChartTextStyle | undefined
): LookText {
  return {
    // `rot` is in 60000ths of a degree, and negative turns clockwise — the same
    // direction the authored value means.
    ...(rotation !== undefined
      ? {
          bodyProperties: {
            rotation: Math.round(rotation * 60000),
            spcFirstLastPara: true,
            vertOverflow: 'ellipsis',
            vertical: 'horizontal',
            wrap: 'square',
            anchorCtr: true,
          },
        }
      : {}),
    paragraphs: [
      {
        properties: { defaultRunProperties: lookRun(font) },
        endParagraphProperties: { lang: 'en-US' },
      },
    ],
  };
}

/** Unfilled and unbordered, with an empty effect list: Office's own blank. */
const BLANK_SHAPE: LookShape = {
  fill: { type: 'none' },
  outline: { type: 'noFill' },
  effects: {},
};

/**
 * An axis: the backend's default for its slot, with the authored edits on top.
 *
 * Stated whole rather than left to the backend, because an axis passed at all
 * replaces the default one: the ids are the only thing it still fills in, and
 * it fills them in per slot, as the plot area's `c:axId`s expect.
 */
function lookAxis(
  kind: LookAxis['kind'],
  defaultPosition: LookAxis['position'],
  edits: ChartAxisEdits | undefined
): LookAxis {
  const e = edits ?? {};
  const shapeProperties: LookShape | undefined =
    e.lineVisible === false
      ? { outline: { type: 'noFill' } }
      : e.line
        ? { outline: lookLine(e.line) }
        : undefined;
  const gridLines = gridLinesLook(e.gridLine);
  return {
    kind,
    scaling: {
      orientation: 'ascending',
      // CT_Scaling orders logBase, orientation, max, min; a category axis has
      // no scale, whatever the edits say.
      ...(kind === 'value' && e.max !== undefined ? { max: e.max } : {}),
      ...(kind === 'value' && e.min !== undefined ? { min: e.min } : {}),
    },
    delete: e.hidden ?? false,
    position:
      e.position !== undefined
        ? known(AXIS_POSITIONS, e.position, 'axis position')
        : defaultPosition,
    ...(gridLines !== undefined ? { majorGridlines: gridLines } : {}),
    ...(e.title
      ? {
          title: lookTitle(e.title, e.titleFont, {
            rotation: e.titleRotation,
            styleRun: true,
          }),
        }
      : {}),
    ...(e.numberFormat !== undefined
      ? { numberFormat: { formatCode: e.numberFormat, sourceLinked: false } }
      : kind === 'value'
        ? { numberFormat: { formatCode: 'General', sourceLinked: true } }
        : {}),
    ...(e.majorTickMark !== undefined
      ? { majorTickMark: e.majorTickMark as LookAxis['majorTickMark'] }
      : {}),
    ...(e.minorTickMark !== undefined
      ? { minorTickMark: e.minorTickMark as LookAxis['minorTickMark'] }
      : {}),
    ...(e.tickLabelPosition !== undefined
      ? {
          tickLabelPosition:
            e.tickLabelPosition as LookAxis['tickLabelPosition'],
        }
      : {}),
    ...(shapeProperties ? { shapeProperties } : {}),
    ...(e.labelRotation !== undefined || hasTextStyle(e.labelFont)
      ? { textProperties: lookTextProperties(e.labelRotation, e.labelFont) }
      : {}),
    crosses: 'zero',
    ...(kind === 'category'
      ? { auto: true, labelOffset: 100, noMultiLevelLabel: false }
      : {}),
    // CT_CatAx has no `c:crossBetween`.
    ...(kind === 'value' && e.crossBetween !== undefined
      ? {
          crossBetween: known(CROSS_BETWEEN, e.crossBetween, 'crossBetween'),
        }
      : {}),
    ...(kind === 'value' && e.majorUnit !== undefined
      ? { majorUnit: e.majorUnit }
      : {}),
  };
}

/** `c:majorGridlines`, styled if the author said how; `none` draws none. */
function gridLinesLook(
  gridLine: ChartAxisEdits['gridLine']
): LookAxis['majorGridlines'] | undefined {
  if (!gridLine || gridLine.style === 'none') return undefined;
  const dash = gridLine.style ? DASH_STYLES[gridLine.style] : undefined;
  if (!gridLine.color && !dash && gridLine.size === undefined) return true;
  return {
    shapeProperties: {
      outline: {
        ...(gridLine.size !== undefined
          ? { width: Math.round(gridLine.size * POINTS_TO_EMU) }
          : {}),
        ...(gridLine.color
          ? { type: 'solidFill', color: lookColor(gridLine.color) }
          : {}),
        ...(dash ? { dash } : {}),
      },
    },
  };
}

/**
 * Chart types whose series colour is a stroke, not a fill.
 *
 * A line series has no area to fill: an `a:solidFill` on one is accepted, drawn
 * nowhere, and the line stays the reader's default colour — which is what a
 * LibreOffice render showed, a blue line under an `accent` palette. The colour
 * has to go on `a:ln`, and on the marker with it, or the points keep the
 * default too.
 */
const STROKE_COLORED: ReadonlySet<string> = new Set([
  'line',
  'scatter',
  'radar',
]);

/**
 * Chart types coloured per data point rather than per series.
 *
 * A pie has one series whose slices are its data points, so a series-level fill
 * paints every slice the same colour and the rest of the palette is never
 * written. PowerPoint's own charts carry one `c:dPt` per slice; so must these,
 * or a themed pie renders monochrome while the same document on the other
 * backend renders normally.
 */
const POINT_COLORED: ReadonlySet<string> = new Set(['pie', 'doughnut']);

/**
 * One series' fill, stroke, marker or slices, and the cells it caches.
 *
 * `lineSize` and `dataBorder` reach the same `a:ln`, and never at the same
 * time: one is the width of a series that *is* a line, the other an outline on
 * a series that is a filled shape. Verified against pptxgenjs, which on a bar
 * chart writes the border's width and colour and on a line chart writes
 * `lineSize` with the series colour.
 */
function seriesLook(
  chart: ChartPartInput,
  index: number,
  pointCount: number
): SeriesLook {
  const valueCount = chart.series[index]?.values.length ?? pointCount;
  // A range whose end row is above its start — `$A$2:$A$1` — is not a range a
  // reader accepts, so a series with no points states no reference at all
  // rather than an impossible one. The chart has nothing to plot either way.
  const formulas =
    pointCount > 0 && valueCount > 0
      ? {
          nameFormula: seriesNameReference(index),
          // This series' own length, not the chart's: a range longer than the
          // cells behind it claims data the workbook does not hold, and
          // disagrees with the `c:ptCount` cached beside it.
          valueFormula: seriesValueReference(index, valueCount),
        }
      : {};
  // A palette shorter than the series list wraps, exactly as the implicit
  // theme palette does everywhere else in the project.
  const color =
    chart.colors.length > 0
      ? chart.colors[index % chart.colors.length]
      : undefined;
  const stroke = STROKE_COLORED.has(chart.chartType);
  const border = stroke ? undefined : chart.dataBorder;

  if (POINT_COLORED.has(chart.chartType)) {
    if (chart.colors.length === 0 || pointCount === 0) return formulas;
    return {
      ...formulas,
      dataPoints: Array.from({ length: pointCount }, (_, point) => ({
        index: point,
        bubble3D: false,
        shapeProperties: {
          fill: solid(chart.colors[point % chart.colors.length]),
          ...(border ? { outline: borderLine(border) } : {}),
        },
      })),
    };
  }

  if (!stroke) {
    const shape: LookShape = {
      ...(color ? { fill: solid(color) } : {}),
      ...(border ? { outline: borderLine(border) } : {}),
    };
    return Object.keys(shape).length > 0
      ? { ...formulas, shapeProperties: shape }
      : formulas;
  }

  if (!color && chart.lineWidthPoints === undefined) return formulas;
  return {
    ...formulas,
    shapeProperties: {
      outline: lookLine({
        widthPoints: chart.lineWidthPoints,
        color,
        cap: chart.lineCap,
        join: chart.lineJoin,
      }),
    },
    // The marker takes the colour too, or the points keep the reader's
    // default; its outline is a hairline unless a width is stated.
    ...(color
      ? {
          marker: {
            shapeProperties: {
              fill: solid(color),
              outline: lookLine({
                widthPoints: chart.markerLineWidthPoints,
                color,
              }),
            },
          },
        }
      : {}),
  };
}

/**
 * Everything the backend writes for a chart beyond its type, series and title
 * text, as options: the cell references, the look, the axes and the workbook
 * reference.
 *
 * `@office-open` 0.14 hands the whole options object to `chartSpaceDesc`, so
 * what used to be spliced into the emitted part is now asked for. Office's own
 * blanks — an unfilled chart area and legend, `c:date1904`, `c:lang`, square
 * corners — are stated too: the backend writes them only when asked, and a
 * reader draws a chart without them with a border, rounded corners and a
 * legend it places itself.
 *
 * Each core spreads this over its own chart options and merges the series half
 * into each series with `withSeriesLook`.
 */
export function chartLook(
  chart: ChartPartInput,
  relationshipId = 'rId1'
): { chart: ChartSpaceLook; series: SeriesLook[] } {
  const pointCount = chart.series[0]?.labels.length ?? 0;
  const scatter = chart.chartType === 'scatter';
  const pie = POINT_COLORED.has(chart.chartType);
  const bar = chart.chartType === 'bar' || chart.chartType === 'column';
  const stacked = !!chart.barGrouping && chart.barGrouping !== 'clustered';
  const axes: LookAxis[] | undefined = pie
    ? undefined
    : [
        // A scatter chart has no category axis: both of its axes are value
        // axes, X first, and both default to the left, as the backend's own
        // pair does.
        lookAxis(
          scatter ? 'value' : 'category',
          scatter ? 'left' : 'bottom',
          chart.categoryAxis
        ),
        lookAxis('value', 'left', chart.valueAxis),
      ];
  const categoryFormula = pointCount > 0 ? categoryReference(pointCount) : '';

  return {
    chart: {
      date1904: false,
      lang: 'en-US',
      roundedCorners: false,
      autoTitleDeleted: chart.autoTitleDeleted ?? false,
      ...(chart.title !== undefined
        ? {
            title: lookTitle(chart.title, chart.titleFont, {
              styleRun: false,
            }),
          }
        : {}),
      // `c:varyColors` is a `CT_Boolean`, so an absent one means *true*: a
      // one-series line chart then colours each point and lists every category
      // in its legend. A pie's slices should vary, and its `c:dPt`s agree.
      varyColors: pie,
      ...(chart.barGrouping
        ? { grouping: chart.barGrouping as ChartSpaceLook['grouping'] }
        : {}),
      ...(chart.radarStyle
        ? { radarStyle: chart.radarStyle as ChartSpaceLook['radarStyle'] }
        : {}),
      ...(chart.gapWidth !== undefined ? { gapWidth: chart.gapWidth } : {}),
      // Stacked bars that do not overlap are drawn side by side, so a stack
      // takes a full overlap unless one was authored.
      ...(chart.overlap !== undefined
        ? { overlap: chart.overlap }
        : bar && stacked
          ? { overlap: 100 }
          : {}),
      ...(chart.firstSliceAngle !== undefined
        ? { firstSliceAngle: chart.firstSliceAngle }
        : {}),
      ...(chart.holeSize !== undefined ? { holeSize: chart.holeSize } : {}),
      ...(chart.lineMarkers !== undefined
        ? { markers: chart.lineMarkers }
        : {}),
      ...(categoryFormula ? { categoryFormula } : {}),
      // The x values as numbers: a reader places text x values at 1, 2, 3…
      // in order, whatever they say.
      ...(scatter && chart.scatterXValues
        ? {
            numericCategories: true,
            categories: chart.scatterXValues.map((x) => cellNumber(x)),
            categoryFormatCode: 'General',
          }
        : {}),
      ...(axes ? { axes } : {}),
      ...(chart.plotAreaUnfilled
        ? {
            plotAreaShapeProperties: {
              fill: { type: 'none' },
              outline: { type: 'noFill' },
            },
          }
        : {}),
      legendPosition: known(
        LEGEND_POSITIONS,
        chart.legendPosition ?? 'b',
        'legend position'
      ),
      legendLayout: true,
      legendOverlay: false,
      legendShapeProperties: BLANK_SHAPE,
      legendTextProperties: {
        bodyProperties: {
          rotation: 0,
          spcFirstLastPara: true,
          vertOverflow: 'ellipsis',
          vertical: 'horizontal',
          wrap: 'square',
          anchor: 'center',
          anchorCtr: true,
        },
        paragraphs: [
          {
            properties: { defaultRunProperties: lookRun(chart.legendFont) },
            endParagraphProperties: { lang: 'en-US' },
          },
        ],
      },
      shapeProperties: BLANK_SHAPE,
      // The chart-wide default every piece of chart text that states nothing
      // of its own (tick labels, the legend) inherits.
      textProperties: lookTextProperties(undefined, chart.textFont),
      // `autoUpdate` stated: without it the element goes, and the chart reads
      // as linked to nothing rather than embedding its data.
      externalData: { relationshipId, autoUpdate: false },
    },
    series: chart.series.map((_, index) => ({
      ...seriesLook(chart, index, pointCount),
      ...(hasTextStyle(chart.dataLabelFont)
        ? {
            dataLabels: {
              textProperties: lookTextProperties(
                undefined,
                chart.dataLabelFont
              ),
            },
          }
        : {}),
    })),
  };
}

/**
 * One series with its look: the emitter's own options, the formulas and paint
 * on top, a marker's symbol and size kept under its new colour, and the text
 * style of labels the series already has (never labels it does not).
 */
export function withSeriesLook<
  S extends {
    marker?: object;
    dataLabels?: object;
  },
>(series: S, look: SeriesLook): S {
  const { marker, dataLabels, ...rest } = look;
  return {
    ...series,
    ...rest,
    ...(marker ? { marker: { ...series.marker, ...marker } } : {}),
    ...(dataLabels && series.dataLabels
      ? { dataLabels: { ...series.dataLabels, ...dataLabels } }
      : {}),
  };
}

/**
 * What no option says, written into the emitted part: a scatter chart's
 * style.
 *
 * `chartSpaceDesc` writes `<c:scatterStyle val="line"/>` from a literal, so a
 * scatter chart asked to draw markers — Word's own `lineMarker` — would not.
 * The splice finds that literal, or the style already written, and fails the
 * render on anything else rather than let a changed spelling turn it into a
 * silent no-op.
 */
export function finishChartXml(
  chartXml: string,
  chart: ChartPartInput
): string {
  if (chart.chartType !== 'scatter' || !chart.scatterStyle) return chartXml;
  const wanted = `<c:scatterStyle val="${escapeXml(chart.scatterStyle)}"/>`;
  if (chartXml.includes(wanted)) return chartXml;
  const literal = '<c:scatterStyle val="line"/>';
  if (!chartXml.includes(literal)) {
    throw new Error(
      'Could not set a scatter chart\'s style: the part has no `<c:scatterStyle val="line"/>` to replace.'
    );
  }
  return chartXml.replace(literal, wanted);
}

/* ------------------------------------------------------------------ *
 * Matching parts to the nodes they came from
 * ------------------------------------------------------------------ */

/**
 * Every `<c:v>` in a chart part, per series, in document order.
 *
 * The identity of a chart part, for the purpose of matching it to the IR node
 * it came from. Position cannot do that job: an emitter fills its array while
 * *building* the backend's options object, and the backend numbers its parts
 * while *stringifying* that object, and the two walks disagree the moment a
 * chart sits somewhere other than the main body — a docx header or footer, a
 * pptx master or layout. Pairing by position handed charts another chart's
 * workbook, so a recipient choosing "Edit Data" saw a different chart's
 * numbers.
 *
 * Content is stable under either walk. A `<c:v>` holds a series name, a
 * category label or a cached value, all of which came from the IR node.
 */
// Control characters, so a signature cannot be forged by a label that happens
// to contain the separator: joining on '' would make ['ab','c'] and ['a','bc']
// the same chart, and the wrong workbook would follow.
const VALUE_SEPARATOR = '\u0001';
const SERIES_SEPARATOR = '\u0002';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Undo the backend's XML escaping, so a part's text compares against the IR's.
 *
 * The part signature is read out of `<c:v>` elements, where `&`, `<`, `>`, `"`
 * and `'` have all been escaped; the input signature is built from the raw IR
 * strings. Comparing the two directly made every chart whose series name or
 * category label contained one of those characters fail to match — and an
 * unmatched part was skipped, so the chart shipped with no workbook, no
 * `c:externalData` and empty `<c:f/>` references, with nothing said about it.
 *
 * Decoding rather than escaping, because this side has to undo whatever the
 * backend did: it emits `&apos;`, which the escaper here does not produce, so
 * escaping the other side would leave the same mismatch one character over.
 */
function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return NAMED_ENTITIES[body] ?? match;
    }
  );
}

export function chartPartSignature(chartXml: string): string {
  return (chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? [])
    .map((series) =>
      [...series.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)]
        .map((match) => decodeXmlEntities(match[1]))
        .join(VALUE_SEPARATOR)
    )
    .join(SERIES_SEPARATOR);
}

/**
 * The same signature, computed from the IR node the part was emitted from.
 *
 * A scatter chart caches its x values as the numbers `chartLook` writes, not
 * as its labels.
 */
export function chartInputSignature(chart: ChartPartInput): string {
  const categories =
    chart.chartType === 'scatter' && chart.scatterXValues
      ? chart.scatterXValues.map((x) => cellNumber(x))
      : chart.series[0]?.labels ?? [];
  return chart.series
    .map((series, index) =>
      [
        series.name ?? `Series ${index + 1}`,
        ...categories,
        ...series.values.map((value) => String(value)),
      ].join(VALUE_SEPARATOR)
    )
    .join(SERIES_SEPARATOR);
}

/**
 * Pair emitted chart parts with the inputs they came from, by content.
 *
 * Returns one entry per part that matched, in part order. A part with no match
 * is left out rather than guessed at: the package holds a chart this pass did
 * not emit, and repairing it from the wrong node is exactly the defect the
 * matching exists to prevent. Two charts identical in every cached value match
 * interchangeably, which is harmless — identical data yields an identical
 * workbook, and an author who wrote two identical charts did not distinguish
 * their palettes either.
 */
export function matchChartParts<T extends ChartPartInput>(
  parts: ReadonlyArray<readonly [ordinal: number, xml: string]>,
  charts: readonly T[]
): Array<{ ordinal: number; xml: string; chart: T }> {
  const unmatched = new Set(charts.keys());
  const matched: Array<{ ordinal: number; xml: string; chart: T }> = [];

  for (const [ordinal, xml] of parts) {
    const signature = chartPartSignature(xml);
    const index = [...unmatched].find(
      (candidate) => chartInputSignature(charts[candidate]) === signature
    );
    if (index === undefined) continue;
    unmatched.delete(index);
    matched.push({ ordinal, xml, chart: charts[index] });
  }

  // A chart the emitter produced but no part matched would ship with no
  // workbook, no `c:externalData` and empty `<c:f/>` references — a chart that
  // draws and then fails on the first double-click, which is the exact defect
  // this whole pass exists to prevent. Silence made an escaping mismatch look
  // like a working document, so an unmatched chart is loud.
  if (unmatched.size > 0) {
    const names = [...unmatched]
      .map((index) => charts[index].series[0]?.name ?? `chart ${index + 1}`)
      .join(', ');
    throw new Error(
      `Could not match ${unmatched.size} chart(s) to an emitted chart part ` +
        `(${names}). The package would ship a chart without its workbook.`
    );
  }

  return matched;
}

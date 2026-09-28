/**
 * The half of a native chart `@office-open` does not write.
 *
 * Both `@office-open/docx` and `@office-open/pptx` build their chart XML with
 * the same `chartSpaceDesc` out of `@office-open/core`, and both forward only a
 * subset of `ChartSpaceOptions` from their chart element. Verified against the
 * packages rather than their types, because `ChartOptions extends
 * ChartSpaceOptions` promises far more than either adapter reads. What gets
 * dropped is identical in both formats, and all of it is visible to whoever
 * opens the file:
 *
 * - **No `c:externalData`.** Neither backend writes one, and every `<c:f>`
 *   comes out empty, so the chart caches its values with no source for them and
 *   "Edit Data" fails. This is the exact defect the pptx adapter refused native
 *   charts over.
 * - **No series colours.** Neither `ChartSeriesCommon` nor `DataPointOptions`
 *   carries a fill, and `colorMappingOverride` is not forwarded, so every
 *   series draws in the reader's default palette and ignores the theme.
 * - **No axis titles.** Neither backend writes one: docx drops the `axes`
 *   option, and pptx accepts it but cannot be given one without inventing the
 *   axis ids its plot area references.
 * - **No legend position**, on docx only — pptx forwards it.
 * - **No grouping.** `ChartSpaceOptions` has no field for it and
 *   `chartSpaceDesc` writes `clustered` unconditionally, so a stacked chart
 *   came out side by side.
 *
 * So this module writes them, as pure string transforms over the emitted chart
 * part plus the XML of the workbook it points at. Editing another library's
 * serialisation is not free and is chosen deliberately: the alternative is a
 * chart that draws and then fails on the first double-click.
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

/**
 * Everything the splice needs, in neither format's vocabulary.
 *
 * Each core adapts its own IR node to this rather than this module learning
 * about `DocxIrChartRun` and `PptxIrChartElement`, which would make a shared
 * module depend on both cores it exists to serve.
 */
/**
 * What an authored axis asks for, in neither format's vocabulary.
 *
 * Every field here is one a backend drops: `AxisOptions` cannot be passed to
 * `@office-open` at all — supplying `axes` replaces the default pair and needs
 * `id`/`crossAxisId` values an adapter cannot safely allocate — so an authored
 * axis is applied by rewriting the axis the backend built.
 */
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
  /** `standard`, `marker` or `filled`; a backend may hardcode the first. */
  radarStyle?: string;
  /** `line` or `lineMarker`, …; a backend may hardcode the first. */
  scatterStyle?: string;
  /**
   * Plot options a backend may drop: a bar chart's `c:gapWidth` and
   * `c:overlap`, a pie's or doughnut's `c:firstSliceAng`, a doughnut's
   * `c:holeSize`. Each is written only where the plot has none.
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
   * written as numbers (`c:numRef`) rather than the text the backend writes,
   * which a reader plots at 1, 2, 3… whatever it says. The workbook's column A
   * has to hold the same numbers — see `chartWorkbookParts`.
   */
  scatterXValues?: readonly number[];
  titleFont?: ChartTextStyle;
  /**
   * The chart-wide default in `c:chartSpace/c:txPr`, which every piece of
   * chart text that states nothing of its own (tick labels, the legend)
   * inherits. The backend writes it with an empty `a:defRPr`, leaving the
   * reader's built-in default in charge.
   */
  textFont?: ChartTextStyle;
  legendFont?: ChartTextStyle;
  dataLabelFont?: ChartTextStyle;
  legendPosition?: string;
  /**
   * `clustered` | `stacked` | `percentStacked`.
   *
   * Spliced rather than passed: `ChartSpaceOptions` has no grouping field at
   * all, and `chartSpaceDesc` writes `clustered` unconditionally. A chart
   * authored as "% of total" therefore came out as side-by-side bars summing
   * to nothing — the one dropped option that misrepresents the data rather
   * than restyling it.
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
 * The splice
 * ------------------------------------------------------------------ */

/**
 * Replace each empty `<c:f/>` in one `<c:ser>` with the range it caches.
 *
 * Order is the schema's, not a guess: within a series `c:tx` comes before
 * `c:cat`, which comes before `c:val`, so the three empty formulas appear in
 * that order and are filled in that order.
 */
function fillSeriesFormulas(
  seriesXml: string,
  seriesIndex: number,
  categoryCount: number,
  valueCount: number
): string {
  // A range whose end row is above its start — `$A$2:$A$1` — is not a range a
  // reader accepts, so a series with no points states no reference at all
  // rather than an impossible one. The chart has nothing to plot either way.
  if (categoryCount === 0 || valueCount === 0) return seriesXml;

  const references = [
    seriesNameReference(seriesIndex),
    categoryReference(categoryCount),
    // This series' own length, not the chart's: a range longer than the cells
    // behind it claims data the workbook does not hold, and disagrees with the
    // `c:ptCount` the backend already cached.
    seriesValueReference(seriesIndex, valueCount),
  ];
  let next = 0;
  return seriesXml.replace(/<c:f\/>/g, () => {
    const reference = references[next++];
    return reference === undefined
      ? '<c:f/>'
      : `<c:f>${escapeXml(reference)}</c:f>`;
  });
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

/** One `c:dPt`, giving slice `index` its own fill. */
function dataPoint(
  index: number,
  hex: string,
  border?: ChartPartInput['dataBorder']
): string {
  return (
    `<c:dPt><c:idx val="${index}"/><c:bubble3D val="0"/>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>` +
    (border ? borderLine(border) : '') +
    `</c:spPr></c:dPt>`
  );
}

/** A data element's outline: stated absent, or a width and colour. */
function borderLine(border: NonNullable<ChartPartInput['dataBorder']>): string {
  return border === 'none'
    ? '<a:ln><a:noFill/></a:ln>'
    : outline(border.widthPoints, border.color);
}

/** Paint one series, leaving the empty `<c:spPr/>` alone when there is no colour. */
function paintSeries(
  seriesXml: string,
  color: string | undefined,
  chartType: string,
  palette: readonly string[],
  pointCount: number,
  chart: ChartPartInput
): string {
  const fillFor = (hex: string) =>
    `<a:solidFill><a:srgbClr val="${hex.toUpperCase()}"/></a:solidFill>`;

  // `lineSize` and `dataBorder` reach the same `a:ln`, and never at the same
  // time: one is the width of a series that *is* a line, the other an outline
  // on a series that is a filled shape. Verified against pptxgenjs, which on a
  // bar chart writes the border's width and colour and on a line chart writes
  // `lineSize` with the series colour.
  const stroke = STROKE_COLORED.has(chartType);
  const border = stroke ? undefined : chart.dataBorder;

  // A pie's colours belong to its slices. CT_PieSer orders `dPt` before
  // `dLbls`, and `dLbls` before `cat` — so anchoring on `c:cat` alone put the
  // slices after the data labels as soon as any were authored.
  if (POINT_COLORED.has(chartType)) {
    if (palette.length === 0 || pointCount === 0) return seriesXml;
    const points = Array.from({ length: pointCount }, (_, index) =>
      dataPoint(index, palette[index % palette.length].toUpperCase(), border)
    ).join('');
    for (const anchor of ['<c:dLbls>', '<c:cat>', '<c:val>']) {
      if (seriesXml.includes(anchor)) {
        return seriesXml.replace(anchor, `${points}${anchor}`);
      }
    }
    return seriesXml;
  }

  const parts: string[] = [];
  if (!stroke) {
    if (color) parts.push(fillFor(color));
    if (border) parts.push(borderLine(border));
    if (parts.length === 0) return seriesXml;
    return seriesXml.replace('<c:spPr/>', `<c:spPr>${parts.join('')}</c:spPr>`);
  }

  if (!color && chart.lineWidthPoints === undefined) return seriesXml;

  // `c:marker` follows `c:spPr` in CT_LineSer, and there may be only one of
  // it. The backend writes its own as soon as `lineDataSymbol` or
  // `lineDataSymbolSize` is authored, so adding a second here put two sibling
  // markers in one series — which PowerPoint answers with a repair prompt and
  // LibreOffice drew without a word. Colour the existing one when there is
  // one, and write a whole marker only when there is not.
  const fill = color ? fillFor(color) : '';
  const line = lineProperties({
    widthPoints: chart.lineWidthPoints,
    color,
    cap: chart.lineCap,
    join: chart.lineJoin,
  });
  const painted = seriesXml.replace('<c:spPr/>', `<c:spPr>${line}</c:spPr>`);
  if (!color) return painted;

  const markerSpPr = `<c:spPr>${fill}${outline(chart.markerLineWidthPoints, color)}</c:spPr>`;
  const existing = painted.match(/<c:marker>[\s\S]*?<\/c:marker>/);
  if (!existing) {
    return painted.replace(
      `<c:spPr>${line}</c:spPr>`,
      `<c:spPr>${line}</c:spPr><c:marker>${markerSpPr}</c:marker>`
    );
  }
  // CT_Marker orders symbol, size, spPr — so the fill goes last, and only if
  // the backend did not already give the marker one.
  if (existing[0].includes('<c:spPr>')) return painted;
  return painted.replace(
    existing[0],
    existing[0].replace('</c:marker>', `${markerSpPr}</c:marker>`)
  );
}

/**
 * A `c:title` block holding one line of text, as an axis wants it.
 *
 * The font goes on both the paragraph default and the run, which is how
 * PowerPoint writes an axis title itself: a reader honouring only one of the
 * two still draws the intended size.
 */
function axisTitle(
  text: string,
  font: ChartTextStyle | undefined,
  rotation: number | undefined
): string {
  const styled = hasTextStyle(font);
  return (
    `<c:title><c:tx><c:rich>${titleBodyProperties(rotation)}<a:lstStyle/><a:p>` +
    (styled ? `<a:pPr>${defaultRunProperties(font)}</a:pPr>` : '') +
    `<a:r>${styled ? runProperties(font) : ''}` +
    `<a:t>${escapeXml(text)}</a:t>` +
    `</a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  );
}

/** A title's `a:bodyPr`: bare, or turned by an authored rotation. */
function titleBodyProperties(rotation: number | undefined): string {
  // `rot` is in 60000ths of a degree, as on a tick label.
  return rotation !== undefined
    ? `<a:bodyPr rot="${Math.round(rotation * 60000)}" vert="horz"/>`
    : '<a:bodyPr/>';
}

/**
 * Style an axis title the backend already wrote, leaving its text alone.
 *
 * Only a paragraph default is added, and only where the backend wrote none: a
 * title that already states its font is the backend's answer.
 */
function styleExistingTitle(
  titleXml: string,
  font: ChartTextStyle | undefined
): string {
  if (!hasTextStyle(font) || titleXml.includes('<a:pPr')) return titleXml;
  return titleXml.replace(
    '<a:p>',
    `<a:p><a:pPr>${defaultRunProperties(font)}</a:pPr>`
  );
}

/** Points to EMU, the unit a line width is written in. */
const POINTS_TO_EMU = 12700;

/** How the authored dash names spell out in DrawingML. */
const DASH_STYLES: Readonly<Record<string, string>> = {
  solid: 'solid',
  dash: 'dash',
  dot: 'sysDot',
};

/** `a:solidFill` in one colour: hex, or a theme slot with its modifiers. */
function solidFill(color: ChartColor): string {
  if (typeof color === 'string') {
    return `<a:solidFill><a:srgbClr val="${color.toUpperCase()}"/></a:solidFill>`;
  }
  // CT_SchemeColor takes its transforms as children, `lumMod` before `lumOff`.
  const modifiers =
    (color.lumMod !== undefined
      ? `<a:lumMod val="${Math.round(color.lumMod)}"/>`
      : '') +
    (color.lumOff !== undefined
      ? `<a:lumOff val="${Math.round(color.lumOff)}"/>`
      : '');
  const scheme = `a:schemeClr val="${escapeXml(color.scheme)}"`;
  return modifiers
    ? `<a:solidFill><${scheme}>${modifiers}</a:schemeClr></a:solidFill>`
    : `<a:solidFill><${scheme}/></a:solidFill>`;
}

/** An `a:ln` of a given width, optionally coloured. */
function outline(widthPoints: number | undefined, color?: ChartColor): string {
  return lineProperties({ widthPoints, color });
}

/**
 * One `a:ln`. CT_LineProperties fixes the child order: the fill, then the
 * dash, then the join.
 */
function lineProperties(line: ChartStroke): string {
  const attributes =
    (line.widthPoints !== undefined
      ? ` w="${Math.round(line.widthPoints * POINTS_TO_EMU)}"`
      : '') + (line.cap !== undefined ? ` cap="${escapeXml(line.cap)}"` : '');
  const fill = line.color ? solidFill(line.color) : '';
  const join = line.join ? `<a:${line.join}/>` : '';
  return `<a:ln${attributes}>${fill}${join}</a:ln>`;
}

/** `c:majorGridlines`, styled if the author said how. */
function gridLinesElement(
  gridLine: NonNullable<ChartAxisEdits['gridLine']>
): string {
  if (gridLine.style === 'none') return '';
  const parts: string[] = [];
  if (gridLine.color) {
    parts.push(solidFill(gridLine.color));
  }
  const dash = gridLine.style ? DASH_STYLES[gridLine.style] : undefined;
  if (dash) parts.push(`<a:prstDash val="${dash}"/>`);
  if (parts.length === 0 && gridLine.size === undefined) {
    return '<c:majorGridlines/>';
  }
  const width =
    gridLine.size !== undefined
      ? ` w="${Math.round(gridLine.size * POINTS_TO_EMU)}"`
      : '';
  return `<c:majorGridlines><c:spPr><a:ln${width}>${parts.join('')}</a:ln></c:spPr></c:majorGridlines>`;
}

/**
 * `a:defRPr`, the run properties a piece of chart text defaults to.
 *
 * CT_TextCharacterProperties fixes the child order — fill before `a:latin` —
 * and `sz` is in hundredths of a point, not points.
 */
function defaultRunProperties(font: ChartTextStyle | undefined): string {
  return characterProperties('a:defRPr', font);
}

/** `a:rPr` on one run, spelled exactly like the default it matches. */
function runProperties(font: ChartTextStyle | undefined): string {
  return characterProperties('a:rPr', font);
}

function characterProperties(
  tag: 'a:defRPr' | 'a:rPr',
  font: ChartTextStyle | undefined
): string {
  if (!font) return `<${tag}/>`;
  const attrs =
    (font.fontSize !== undefined
      ? ` sz="${Math.round(font.fontSize * 100)}"`
      : '') + (font.bold !== undefined ? ` b="${font.bold ? 1 : 0}"` : '');
  const children =
    (font.color
      ? `<a:solidFill><a:srgbClr val="${font.color.toUpperCase()}"/></a:solidFill>`
      : '') +
    (font.fontFamily
      ? `<a:latin typeface="${escapeXml(font.fontFamily)}"/>`
      : '');
  return children
    ? `<${tag}${attrs}>${children}</${tag}>`
    : `<${tag}${attrs}/>`;
}

/** Whether a text style asks for anything at all. */
function hasTextStyle(font: ChartTextStyle | undefined): boolean {
  return !!font && Object.keys(font).length > 0;
}

/**
 * `c:txPr`, carrying a rotation, a font, or both.
 *
 * Both go in one element: they are two properties of the same text, and an
 * axis that wrote a second `c:txPr` for the font would be a repair prompt
 * rather than a differently-styled label.
 */
function textProperties(
  rotation: number | undefined,
  font: ChartTextStyle | undefined
): string {
  // `rot` is in 60000ths of a degree, and negative turns clockwise — the same
  // direction the authored value means.
  const bodyPr =
    rotation !== undefined
      ? `<a:bodyPr rot="${Math.round(rotation * 60000)}" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchorCtr="1"/>`
      : '<a:bodyPr/>';
  return (
    `<c:txPr>${bodyPr}<a:lstStyle/><a:p><a:pPr>` +
    defaultRunProperties(font) +
    `</a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`
  );
}

/**
 * Apply an authored axis to the axis the backend built.
 *
 * Rebuilt rather than patched in place, because CT_CatAx and CT_ValAx fix the
 * order of their children and a reader enforces it: `majorGridlines` before
 * `title` before `numFmt` before `spPr` before `txPr`, all of them between
 * `axPos` and `crossAx`. Inserting each edit at its own anchor put whichever
 * landed last in front of the others, which is a repair prompt rather than a
 * mis-drawn axis. Splitting the element at the two fixed points and writing the
 * middle out in order is the only way this stays correct as edits are added.
 *
 * Anything already present that this does not replace is preserved, and that
 * has to be exhaustive rather than best-effort: the region is replaced
 * wholesale, so a child this function does not capture is a child it deletes.
 * The two backends emit different amounts, so the same rewrite has to be safe
 * on both.
 */
function rewriteAxis(axisXml: string, edits: ChartAxisEdits): string {
  const axPos = axisXml.match(/<c:axPos[^>]*\/>/);
  const crossAxAt = axisXml.indexOf('<c:crossAx');
  if (!axPos || crossAxAt < 0) return axisXml;

  const headEnd = axisXml.indexOf(axPos[0]) + axPos[0].length;
  let head = axisXml.slice(0, headEnd);
  const middle = axisXml.slice(headEnd, crossAxAt);
  let tail = axisXml.slice(crossAxAt);

  // `c:delete`, `c:scaling` and `c:axPos` all live in the head, in fixed order.
  if (edits.position !== undefined) {
    head = head.replace(
      /<c:axPos val="[^"]*"\/>/,
      `<c:axPos val="${escapeXml(edits.position)}"/>`
    );
  }
  if (edits.hidden !== undefined) {
    head = head.replace(
      /<c:delete val="[^"]*"\/>/,
      `<c:delete val="${edits.hidden ? 1 : 0}"/>`
    );
  }
  if (edits.max !== undefined || edits.min !== undefined) {
    // CT_Scaling orders logBase, orientation, max, min.
    const bounds =
      (edits.max !== undefined ? `<c:max val="${edits.max}"/>` : '') +
      (edits.min !== undefined ? `<c:min val="${edits.min}"/>` : '');
    head = head.replace('</c:scaling>', `${bounds}</c:scaling>`);
  }

  // Rebuild the middle in schema order, keeping what was already there.
  //
  // Every child CT_CatAx and CT_ValAx allow in this region is captured, not
  // just the ones this function writes: the region is *replaced*, so a child
  // left out is a child deleted. Authoring a title alone used to drop the
  // backend's gridlines, tick marks and tick-label position on the floor.
  const existingMajorGrid = middle.match(
    /<c:majorGridlines(?:\/>|>[\s\S]*?<\/c:majorGridlines>)/
  )?.[0];
  const existingMinorGrid = middle.match(
    /<c:minorGridlines(?:\/>|>[\s\S]*?<\/c:minorGridlines>)/
  )?.[0];
  const existingTitle = middle.match(/<c:title>[\s\S]*?<\/c:title>/)?.[0];
  const existingNumFmt = middle.match(/<c:numFmt[^>]*\/>/)?.[0];
  const existingMajorTick = middle.match(/<c:majorTickMark[^>]*\/>/)?.[0];
  const existingMinorTick = middle.match(/<c:minorTickMark[^>]*\/>/)?.[0];
  const existingTickLblPos = middle.match(/<c:tickLblPos[^>]*\/>/)?.[0];
  const existingSpPr = middle.match(/<c:spPr>[\s\S]*?<\/c:spPr>/)?.[0];
  const existingTxPr = middle.match(/<c:txPr>[\s\S]*?<\/c:txPr>/)?.[0];

  const rebuilt = [
    edits.gridLine ? gridLinesElement(edits.gridLine) : existingMajorGrid ?? '',
    existingMinorGrid ?? '',
    // An axis that already carries a title keeps it: writing a second one is a
    // repair prompt, not a duplicated label.
    existingTitle
      ? styleExistingTitle(existingTitle, edits.titleFont)
      : edits.title
        ? axisTitle(edits.title, edits.titleFont, edits.titleRotation)
        : '',
    edits.numberFormat !== undefined
      ? `<c:numFmt formatCode="${escapeXml(edits.numberFormat)}" sourceLinked="0"/>`
      : existingNumFmt ?? '',
    edits.majorTickMark !== undefined
      ? `<c:majorTickMark val="${escapeXml(edits.majorTickMark)}"/>`
      : existingMajorTick ?? '',
    edits.minorTickMark !== undefined
      ? `<c:minorTickMark val="${escapeXml(edits.minorTickMark)}"/>`
      : existingMinorTick ?? '',
    edits.tickLabelPosition !== undefined
      ? `<c:tickLblPos val="${escapeXml(edits.tickLabelPosition)}"/>`
      : existingTickLblPos ?? '',
    edits.lineVisible === false
      ? '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
      : edits.line
        ? `<c:spPr>${lineProperties(edits.line)}</c:spPr>`
        : existingSpPr ?? '',
    edits.labelRotation !== undefined || hasTextStyle(edits.labelFont)
      ? textProperties(edits.labelRotation, edits.labelFont)
      : existingTxPr ?? '',
  ].join('');

  // `crossBetween` follows `crosses` (or `crossesAt`) in CT_ValAx, and
  // CT_CatAx has none. Written before `majorUnit`, which anchors on it.
  if (edits.crossBetween !== undefined && head.startsWith('<c:valAx>')) {
    const crossBetween = `<c:crossBetween val="${escapeXml(edits.crossBetween)}"/>`;
    if (tail.includes('<c:crossBetween')) {
      tail = tail.replace(/<c:crossBetween[^>]*\/>/, crossBetween);
    } else {
      const crosses = tail.match(/<c:crosses(?:At)?[^>]*\/>/)?.[0];
      const at = crosses
        ? tail.indexOf(crosses) + crosses.length
        : tail.indexOf('/>') + 2;
      tail = tail.slice(0, at) + crossBetween + tail.slice(at);
    }
  }

  // `majorUnit` follows crossAx/crosses/crossBetween in CT_ValAx.
  if (edits.majorUnit !== undefined && !tail.includes('<c:majorUnit')) {
    const crosses = tail.match(/<c:cross(?:es|esAt|Between)[^>]*\/>/g);
    const anchor = crosses?.[crosses.length - 1];
    if (anchor) {
      const at = tail.lastIndexOf(anchor) + anchor.length;
      tail =
        tail.slice(0, at) +
        `<c:majorUnit val="${edits.majorUnit}"/>` +
        tail.slice(at);
    }
  }

  return head + rebuilt + tail;
}

/**
 * Apply an authored axis to the Nth element with this tag.
 *
 * `occurrence` exists for scatter, whose axes are both `c:valAx`.
 */
function editAxis(
  chartXml: string,
  tag: string,
  edits: ChartAxisEdits | undefined,
  occurrence = 0
): string {
  if (!edits || Object.keys(edits).length === 0) return chartXml;
  const open = `<c:${tag}>`;
  let start = -1;
  for (let seen = 0; seen <= occurrence; seen++) {
    start = chartXml.indexOf(open, start + 1);
    if (start < 0) return chartXml;
  }
  const end = chartXml.indexOf(`</c:${tag}>`, start);
  if (end < 0) return chartXml;

  return (
    chartXml.slice(0, start) +
    rewriteAxis(chartXml.slice(start, end), edits) +
    chartXml.slice(end)
  );
}

/**
 * A scatter series' x values as numbers.
 *
 * The backend writes a scatter chart's x values from the category list, as
 * text (`c:strRef`), and a reader places text x values at 1, 2, 3… in order
 * whatever they say — so a point authored at x = 2.5 was drawn at x = 2. The
 * reference stays; only the cache changes kind.
 */
function numericScatterX(seriesXml: string, xs: readonly number[]): string {
  return seriesXml.replace(
    /<c:xVal><c:strRef>(<c:f\/>|<c:f>[\s\S]*?<\/c:f>)[\s\S]*?<\/c:strRef><\/c:xVal>/,
    (_, formula: string) =>
      `<c:xVal><c:numRef>${formula}<c:numCache>` +
      `<c:formatCode>General</c:formatCode><c:ptCount val="${xs.length}"/>` +
      xs
        .map(
          (x, index) =>
            `<c:pt idx="${index}"><c:v>${cellNumber(x)}</c:v></c:pt>`
        )
        .join('') +
      `</c:numCache></c:numRef></c:xVal>`
  );
}

/**
 * Insert one element into a plot group's own tail — after its last `c:ser`,
 * before the first of `before` that is there, else at the group's end. The
 * group is `plot`, its closing tag excluded.
 */
function insertInPlot(
  plot: string,
  element: string,
  before: readonly string[]
): string {
  const lastSeries = plot.lastIndexOf('</c:ser>');
  const from =
    lastSeries >= 0 ? lastSeries + '</c:ser>'.length : plot.indexOf('>') + 1;
  for (const anchor of before) {
    const at = plot.indexOf(anchor, from);
    if (at >= 0) return plot.slice(0, at) + element + plot.slice(at);
  }
  return plot + element;
}

/** Whether a plot group states a child of its own, outside its series. */
function plotHas(plot: string, tag: string): boolean {
  const lastSeries = plot.lastIndexOf('</c:ser>');
  return plot.indexOf(`<c:${tag}`, Math.max(lastSeries, 0)) >= 0;
}

/**
 * The plot options a backend drops: bar gaps, a pie's first slice angle, a
 * doughnut's hole, whether a line chart shows its markers. Each is written in
 * the slot its CT_*Chart gives it, and only where the plot has none — a value
 * the backend did forward is its answer.
 */
function setPlotOptions(chartXml: string, chart: ChartPartInput): string {
  const plotAreaAt = chartXml.indexOf('<c:plotArea>');
  const group = /<c:(\w+Chart)>/.exec(chartXml.slice(plotAreaAt));
  if (plotAreaAt < 0 || !group) return chartXml;
  const tag = group[1];
  const start = plotAreaAt + group.index;
  const end = chartXml.indexOf(`</c:${tag}>`, start);
  if (end < 0) return chartXml;
  let plot = chartXml.slice(start, end);

  if (tag === 'barChart') {
    if (chart.gapWidth !== undefined && !plotHas(plot, 'gapWidth')) {
      plot = insertInPlot(plot, `<c:gapWidth val="${chart.gapWidth}"/>`, [
        '<c:overlap',
        '<c:serLines',
        '<c:axId',
        '<c:extLst',
      ]);
    }
    if (chart.overlap !== undefined && !plotHas(plot, 'overlap')) {
      plot = insertInPlot(plot, `<c:overlap val="${chart.overlap}"/>`, [
        '<c:serLines',
        '<c:axId',
        '<c:extLst',
      ]);
    }
  }
  if (tag === 'lineChart' && chart.lineMarkers !== undefined) {
    if (!plotHas(plot, 'marker')) {
      plot = insertInPlot(
        plot,
        `<c:marker val="${chart.lineMarkers ? 1 : 0}"/>`,
        ['<c:smooth', '<c:axId', '<c:extLst']
      );
    }
  }
  if (tag === 'pieChart' || tag === 'doughnutChart') {
    if (
      chart.firstSliceAngle !== undefined &&
      !plotHas(plot, 'firstSliceAng')
    ) {
      plot = insertInPlot(
        plot,
        `<c:firstSliceAng val="${chart.firstSliceAngle}"/>`,
        ['<c:holeSize', '<c:extLst']
      );
    }
  }
  if (
    tag === 'doughnutChart' &&
    chart.holeSize !== undefined &&
    !plotHas(plot, 'holeSize')
  ) {
    plot = insertInPlot(plot, `<c:holeSize val="${chart.holeSize}"/>`, [
      '<c:extLst',
    ]);
  }

  return chartXml.slice(0, start) + plot + chartXml.slice(end);
}

/**
 * Set `c:autoTitleDeleted`, which CT_Chart places after the title and before
 * everything else.
 */
function setAutoTitleDeleted(chartXml: string, deleted: boolean): string {
  const element = `<c:autoTitleDeleted val="${deleted ? 1 : 0}"/>`;
  if (/<c:autoTitleDeleted\b[^>]*\/>/.test(chartXml)) {
    return chartXml.replace(/<c:autoTitleDeleted\b[^>]*\/>/, element);
  }
  const chartAt = chartXml.indexOf('<c:chart>');
  if (chartAt < 0) return chartXml;
  for (const anchor of [
    '<c:pivotFmts',
    '<c:view3D',
    '<c:floor',
    '<c:sideWall',
    '<c:backWall',
    '<c:plotArea>',
  ]) {
    const at = chartXml.indexOf(anchor, chartAt);
    if (at >= 0) return chartXml.slice(0, at) + element + chartXml.slice(at);
  }
  return chartXml;
}

/**
 * State the plot area unfilled and unbordered. CT_PlotArea puts its own
 * `c:spPr` after the plot groups, the axes and any data table; one already
 * there is the backend's answer.
 */
function setPlotAreaUnfilled(chartXml: string): string {
  const start = chartXml.indexOf('<c:plotArea>');
  const end = chartXml.indexOf('</c:plotArea>', start);
  if (start < 0 || end < 0) return chartXml;
  const plotArea = chartXml.slice(start, end);
  const closings = [
    ...plotArea.matchAll(/<\/c:(?:\w+Chart|catAx|valAx|dateAx|serAx|dTable)>/g),
  ];
  const last = closings[closings.length - 1];
  const from = last ? (last.index ?? 0) + last[0].length : 0;
  const tail = plotArea.slice(from);
  if (tail.includes('<c:spPr>')) return chartXml;
  const spPr = '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>';
  const extLst = tail.indexOf('<c:extLst');
  const at = start + from + (extLst >= 0 ? extLst : tail.length);
  return chartXml.slice(0, at) + spPr + chartXml.slice(at);
}

/**
 * Say explicitly that colours do not vary by data point.
 *
 * `c:varyColors` is a `CT_Boolean`, so an *absent* one means **true** — the
 * same default that made `<c:showVal/>` alone switch on every other data label.
 * `@office-open` writes it for `ofPie` and for nothing else, so every other
 * chart inherited "vary by point". On a chart with one series that is plainly
 * visible: PowerPoint colours each point separately and gives the legend one
 * entry per *category*, so a line chart of four quarters had a legend reading
 * `Q1 Q2 Q3 Q4` instead of its series name. A chart with two or more series
 * hides the problem, because the setting only applies to single-series charts —
 * which is why the bar chart beside it looked right.
 *
 * A pie is the exception the default was written for: its slices *should* vary,
 * and the per-point colours written into `c:dPt` agree with that.
 *
 * `varyColors` is the last child before `c:ser` in every plot type that has it,
 * so the first `c:ser` is the anchor.
 */
function setVaryColors(chartXml: string, chartType: string): string {
  if (POINT_COLORED.has(chartType)) return chartXml;
  if (chartXml.includes('<c:varyColors')) return chartXml;
  return chartXml.replace('<c:ser>', '<c:varyColors val="0"/><c:ser>');
}

/**
 * Set the grouping, and the overlap that has to go with it.
 *
 * `c:grouping` is written `clustered` unconditionally by the backend, and
 * stacked bars that do not overlap are drawn side by side — they look clustered
 * whatever the grouping says. So `c:overlap val="100"` goes with it.
 *
 * The two cannot be written together, though, and doing so produced invalid
 * XML three ways. CT_BarChart fixes the order as `barDir`, `grouping`,
 * `varyColors`, `ser`, `dLbls`, `gapWidth`, `overlap`, `serLines`, `axId`, so an
 * overlap written beside the grouping lands before `c:ser`. `c:grouping` is
 * also a child of `c:lineChart` and `c:areaChart`, neither of which allows
 * `c:overlap` at all. And an author who set `barOverlapPct` already has one
 * from the backend, in the right place — a second is a duplicate. Word and
 * PowerPoint answer all three with a repair prompt; LibreOffice drew them
 * without complaint, which is why the tests did not notice.
 */
function setBarGrouping(chartXml: string, grouping: string): string {
  const start = chartXml.indexOf('<c:barChart>');
  // Only a bar chart has an overlap. A line or area chart takes the grouping
  // and nothing else.
  if (start < 0) {
    return chartXml.replace(
      /<c:grouping val="[^"]*"\/>/,
      `<c:grouping val="${escapeXml(grouping)}"/>`
    );
  }
  const end = chartXml.indexOf('</c:barChart>', start);
  if (end < 0) return chartXml;

  let plot = chartXml
    .slice(start, end)
    .replace(
      /<c:grouping val="[^"]*"\/>/,
      `<c:grouping val="${escapeXml(grouping)}"/>`
    );

  if (!plot.includes('<c:overlap')) {
    // After `c:gapWidth` when the author set one, otherwise immediately before
    // the axis ids that close the plot — both are the same legal slot.
    const gapWidth = plot.match(/<c:gapWidth val="[^"]*"\/>/)?.[0];
    if (gapWidth) {
      const at = plot.indexOf(gapWidth) + gapWidth.length;
      plot = plot.slice(0, at) + '<c:overlap val="100"/>' + plot.slice(at);
    } else {
      const axId = plot.indexOf('<c:axId');
      if (axId >= 0) {
        plot =
          plot.slice(0, axId) + '<c:overlap val="100"/>' + plot.slice(axId);
      }
    }
  }

  return chartXml.slice(0, start) + plot + chartXml.slice(end);
}

/**
 * Style the chart's own title.
 *
 * Scoped to the region before `c:plotArea`, because an axis title is a
 * `c:title` too and styling the first one found would put the chart title's
 * font on an axis whenever the chart had no title of its own.
 */
function styleChartTitle(
  chartXml: string,
  font: ChartTextStyle | undefined
): string {
  if (!hasTextStyle(font)) return chartXml;
  const plotAreaAt = chartXml.indexOf('<c:plotArea>');
  if (plotAreaAt < 0) return chartXml;
  const head = chartXml.slice(0, plotAreaAt);
  if (!head.includes('<c:title>')) return chartXml;

  // `a:pPr` precedes the runs it sets defaults for.
  const styled = head.replace(
    '<a:p><a:r>',
    `<a:p><a:pPr>${defaultRunProperties(font)}</a:pPr><a:r>`
  );
  return styled + chartXml.slice(plotAreaAt);
}

/**
 * Set the chart-wide text default, `c:chartSpace/c:txPr`.
 *
 * Scoped to what follows `</c:chart>`, since every `c:txPr` inside the chart
 * belongs to an axis, the legend or a label. The backend's own `c:txPr` has its
 * empty `a:defRPr` filled in; one that is missing is written after the
 * chart-space `c:spPr`, where CT_ChartSpace puts it — before `c:externalData`.
 */
function styleChartSpaceText(
  chartXml: string,
  font: ChartTextStyle | undefined
): string {
  if (!hasTextStyle(font)) return chartXml;
  const chartEnd = chartXml.lastIndexOf('</c:chart>');
  if (chartEnd < 0) return chartXml;
  const head = chartXml.slice(0, chartEnd);
  let tail = chartXml.slice(chartEnd);

  const existing = tail.match(/<c:txPr>[\s\S]*?<\/c:txPr>/)?.[0];
  if (existing) {
    if (!existing.includes('<a:defRPr/>')) return chartXml;
    tail = tail.replace(
      existing,
      existing.replace('<a:defRPr/>', defaultRunProperties(font))
    );
    return head + tail;
  }

  const txPr = textProperties(undefined, font);
  const spPrEnd = tail.indexOf('</c:spPr>');
  const at = spPrEnd >= 0 ? spPrEnd + '</c:spPr>'.length : '</c:chart>'.length;
  return head + tail.slice(0, at) + txPr + tail.slice(at);
}

/**
 * Style the legend, whose `c:txPr` the backend already writes.
 *
 * Filling in the empty `a:defRPr` it leaves rather than adding a second
 * `c:txPr`, which a reader offers to repair.
 */
function styleLegend(
  chartXml: string,
  font: ChartTextStyle | undefined
): string {
  if (!hasTextStyle(font)) return chartXml;
  const start = chartXml.indexOf('<c:legend>');
  if (start < 0) return chartXml;
  const end = chartXml.indexOf('</c:legend>', start);
  if (end < 0) return chartXml;

  const legend = chartXml
    .slice(start, end)
    .replace('<a:defRPr/>', defaultRunProperties(font));
  return chartXml.slice(0, start) + legend + chartXml.slice(end);
}

/**
 * Style every series' data labels.
 *
 * CT_DLbls orders `numFmt`, `spPr`, `txPr`, `dLblPos` and only then the `show*`
 * flags, so the text properties go immediately after the opening tag — which is
 * also before the `c:dLblPos` the backend writes first.
 */
function styleDataLabels(
  chartXml: string,
  font: ChartTextStyle | undefined
): string {
  if (!hasTextStyle(font)) return chartXml;
  return chartXml.replace(
    /<c:dLbls>(?!<c:txPr>)/g,
    `<c:dLbls>${textProperties(undefined, font)}`
  );
}

/**
 * Rewrite one emitted `chartN.xml` with everything the backend omitted.
 *
 * Every repair is guarded on what the XML actually lacks, because the two
 * backends omit different amounts. `@office-open/pptx` hands its whole options
 * object to `chartSpaceDesc`, so the legend position survives;
 * `@office-open/docx` forwards eight named fields and loses it. Everything else
 * here — the cell references behind `<c:f/>`, the series fill, the axis titles,
 * the grouping and `c:externalData` — is missing from both.
 *
 * Detecting rather than assuming is also what keeps this honest if a backend
 * starts emitting more: the repair simply stops firing, instead of writing a
 * second copy of an element a reader would offer to repair.
 *
 * `relationshipId` names the workbook relationship in the chart part's own
 * rels file, which each core writes alongside.
 */
export function spliceChartXml(
  chartXml: string,
  chart: ChartPartInput,
  relationshipId = 'rId1'
): string {
  const pointCount = chart.series[0]?.labels.length ?? 0;

  // Walk the series in document order so the Nth `<c:ser>` gets the Nth
  // series' references and colour. A regex over the whole part would fill the
  // formulas of every series from the first one's ranges.
  let seriesIndex = 0;
  let result = chartXml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (seriesXml) => {
    const index = seriesIndex++;
    const withFormulas = fillSeriesFormulas(
      seriesXml,
      index,
      pointCount,
      chart.series[index]?.values.length ?? pointCount
    );
    // A palette shorter than the series list wraps, exactly as the implicit
    // theme palette does everywhere else in the project.
    const color =
      chart.colors.length > 0
        ? chart.colors[index % chart.colors.length]
        : undefined;
    const painted = paintSeries(
      withFormulas,
      color,
      chart.chartType,
      chart.colors,
      pointCount,
      chart
    );
    return chart.scatterXValues
      ? numericScatterX(painted, chart.scatterXValues)
      : painted;
  });

  // A scatter chart has no category axis: both of its axes are `c:valAx`, X
  // first. Titling by tag alone dropped the category title and put the value
  // title on X — a mislabelled chart rather than an invalid one, so nothing
  // complained.
  if (chart.chartType === 'scatter') {
    result = editAxis(result, 'valAx', chart.categoryAxis, 0);
    result = editAxis(result, 'valAx', chart.valueAxis, 1);
  } else {
    result = editAxis(result, 'catAx', chart.categoryAxis);
    result = editAxis(result, 'valAx', chart.valueAxis);
  }

  result = styleChartTitle(result, chart.titleFont);
  result = styleChartSpaceText(result, chart.textFont);
  result = styleLegend(result, chart.legendFont);
  result = styleDataLabels(result, chart.dataLabelFont);

  // `chartSpaceDesc` writes `<c:radarStyle val="standard"/>` from a literal —
  // there is no option behind it at all, so `marker` and `filled` had nowhere
  // to go and became `standard` without a word.
  if (chart.radarStyle) {
    result = result.replace(
      /<c:radarStyle val="[^"]*"\/>/,
      `<c:radarStyle val="${escapeXml(chart.radarStyle)}"/>`
    );
  }
  // The same literal, for scatter: `line` whatever was asked for.
  if (chart.scatterStyle) {
    result = result.replace(
      /<c:scatterStyle val="[^"]*"\/>/,
      `<c:scatterStyle val="${escapeXml(chart.scatterStyle)}"/>`
    );
  }

  // `legendPosition` is not among the fields either backend forwards, so every
  // legend came out at the default whatever the author asked for.
  if (chart.legendPosition) {
    result = result.replace(
      /<c:legendPos val="[^"]*"\/>/,
      `<c:legendPos val="${escapeXml(chart.legendPosition)}"/>`
    );
  }

  // Before the grouping, whose overlap defers to one already written.
  result = setPlotOptions(result, chart);

  if (chart.barGrouping && chart.barGrouping !== 'clustered') {
    result = setBarGrouping(result, chart.barGrouping);
  }

  result = setVaryColors(result, chart.chartType);

  if (chart.autoTitleDeleted !== undefined) {
    result = setAutoTitleDeleted(result, chart.autoTitleDeleted);
  }
  if (chart.plotAreaUnfilled) result = setPlotAreaUnfilled(result);

  // `c:externalData` is the last child of `c:chartSpace`: after `c:chart`,
  // `c:spPr` and `c:txPr`, before nothing. Only written when the backend did
  // not — pptx forwards it, docx drops it.
  if (result.includes('<c:externalData')) return result;
  return result.replace(
    '</c:chartSpace>',
    `<c:externalData r:id="${escapeXml(relationshipId)}">` +
      `<c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
  );
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
 * category label or a cached value, all of which came from the IR node and none
 * of which the splice has written yet.
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

/** The same signature, computed from the IR node the part was emitted from. */
export function chartInputSignature(chart: ChartPartInput): string {
  const categories = chart.series[0]?.labels ?? [];
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

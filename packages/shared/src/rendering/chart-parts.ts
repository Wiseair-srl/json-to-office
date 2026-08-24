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
export interface ChartAxisEdits {
  title?: string;
  /** `c:delete`: an axis hidden entirely. */
  hidden?: boolean;
  /** `false` draws no axis line, leaving its labels. */
  lineVisible?: boolean;
  /** Label rotation, in degrees. */
  labelRotation?: number;
  gridLine?: { style?: string; size?: number; color?: string };
  /** Value-axis bounds; ignored on a category axis, which has no scale. */
  min?: number;
  max?: number;
  majorUnit?: number;
  /** A number format code, e.g. `#,##0`. */
  numberFormat?: string;
}

export interface ChartPartInput {
  /** The chart type, in `@office-open`'s spelling. Decides fill vs stroke. */
  chartType: string;
  series: readonly ChartPartSeries[];
  /** Resolved series colours, uppercase 6-digit hex without `#`. May be empty. */
  colors: readonly string[];
  categoryAxis?: ChartAxisEdits;
  valueAxis?: ChartAxisEdits;
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
function sheetXml(series: readonly ChartPartSeries[]): string {
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
    const cells = [
      ...(label !== undefined
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
  series: readonly ChartPartSeries[]
): ReadonlyArray<readonly [path: string, xml: string]> {
  return [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', WORKBOOK_XML],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/worksheets/sheet1.xml', sheetXml(series)],
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
function dataPoint(index: number, hex: string): string {
  return (
    `<c:dPt><c:idx val="${index}"/><c:bubble3D val="0"/>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>` +
    `</c:dPt>`
  );
}

/** Paint one series, leaving the empty `<c:spPr/>` alone when there is no colour. */
function paintSeries(
  seriesXml: string,
  color: string | undefined,
  chartType: string,
  palette: readonly string[],
  pointCount: number
): string {
  const fillFor = (hex: string) =>
    `<a:solidFill><a:srgbClr val="${hex.toUpperCase()}"/></a:solidFill>`;

  // A pie's colours belong to its slices. Written before `c:cat`, which is
  // where CT_PieSer orders `dPt`.
  if (POINT_COLORED.has(chartType)) {
    if (palette.length === 0 || pointCount === 0) return seriesXml;
    const points = Array.from({ length: pointCount }, (_, index) =>
      dataPoint(index, palette[index % palette.length].toUpperCase())
    ).join('');
    return seriesXml.replace('<c:cat>', `${points}<c:cat>`);
  }

  if (!color) return seriesXml;
  const fill = fillFor(color);

  if (!STROKE_COLORED.has(chartType)) {
    return seriesXml.replace('<c:spPr/>', `<c:spPr>${fill}</c:spPr>`);
  }

  // `c:marker` follows `c:spPr` in CT_LineSer, so it is written alongside
  // rather than inside: the line takes the stroke, the marker takes both so a
  // filled square does not sit in the default colour on a coloured line.
  return seriesXml.replace(
    '<c:spPr/>',
    `<c:spPr><a:ln>${fill}</a:ln></c:spPr>` +
      `<c:marker><c:spPr>${fill}<a:ln>${fill}</a:ln></c:spPr></c:marker>`
  );
}

/** A `c:title` block holding one line of text, as an axis wants it. */
function axisTitle(text: string): string {
  return (
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>` +
    `<a:t>${escapeXml(text)}</a:t>` +
    `</a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
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

/** `c:majorGridlines`, styled if the author said how. */
function gridLinesElement(
  gridLine: NonNullable<ChartAxisEdits['gridLine']>
): string {
  if (gridLine.style === 'none') return '';
  const parts: string[] = [];
  if (gridLine.color) {
    parts.push(
      `<a:solidFill><a:srgbClr val="${gridLine.color.toUpperCase()}"/></a:solidFill>`
    );
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

/** `c:txPr` carrying nothing but a rotation. */
function rotationTextProperties(degrees: number): string {
  // `rot` is in 60000ths of a degree, and negative turns clockwise — the same
  // direction the authored value means.
  const rot = Math.round(degrees * 60000);
  return (
    `<c:txPr><a:bodyPr rot="${rot}" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchorCtr="1"/>` +
    `<a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`
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
 * Anything already present that this does not replace is preserved — the two
 * backends emit different amounts, so the same rewrite has to be safe on both.
 */
function rewriteAxis(axisXml: string, edits: ChartAxisEdits): string {
  const axPos = axisXml.match(/<c:axPos[^>]*\/>/);
  const crossAxAt = axisXml.indexOf('<c:crossAx');
  if (!axPos || crossAxAt < 0) return axisXml;

  const headEnd = axisXml.indexOf(axPos[0]) + axPos[0].length;
  let head = axisXml.slice(0, headEnd);
  const middle = axisXml.slice(headEnd, crossAxAt);
  let tail = axisXml.slice(crossAxAt);

  // `c:delete` and `c:scaling` both live in the head, in that fixed order.
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
  const existingTitle = middle.match(/<c:title>[\s\S]*?<\/c:title>/)?.[0];
  const existingNumFmt = middle.match(/<c:numFmt[^>]*\/>/)?.[0];
  const existingSpPr = middle.match(/<c:spPr>[\s\S]*?<\/c:spPr>/)?.[0];
  const existingTxPr = middle.match(/<c:txPr>[\s\S]*?<\/c:txPr>/)?.[0];

  const rebuilt = [
    edits.gridLine ? gridLinesElement(edits.gridLine) : '',
    // An axis that already carries a title keeps it: writing a second one is a
    // repair prompt, not a duplicated label.
    existingTitle ?? (edits.title ? axisTitle(edits.title) : ''),
    edits.numberFormat !== undefined
      ? `<c:numFmt formatCode="${escapeXml(edits.numberFormat)}" sourceLinked="0"/>`
      : existingNumFmt ?? '',
    edits.lineVisible === false
      ? '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
      : existingSpPr ?? '',
    edits.labelRotation !== undefined
      ? rotationTextProperties(edits.labelRotation)
      : existingTxPr ?? '',
  ].join('');

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
    return paintSeries(
      withFormulas,
      color,
      chart.chartType,
      chart.colors,
      pointCount
    );
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

  // `legendPosition` is not among the fields either backend forwards, so every
  // legend came out at the default whatever the author asked for.
  if (chart.legendPosition) {
    result = result.replace(
      /<c:legendPos val="[^"]*"\/>/,
      `<c:legendPos val="${escapeXml(chart.legendPosition)}"/>`
    );
  }

  // `c:grouping` is written `clustered` unconditionally by the backend, and
  // `c:overlap` goes with it: stacked bars that do not overlap are drawn side
  // by side and look clustered whatever the grouping says.
  if (chart.barGrouping && chart.barGrouping !== 'clustered') {
    result = result.replace(
      /<c:grouping val="[^"]*"\/>/,
      `<c:grouping val="${escapeXml(chart.barGrouping)}"/><c:overlap val="100"/>`
    );
  }

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

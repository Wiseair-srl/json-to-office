/**
 * The half of a native chart the backend does not write.
 *
 * `@office-open/docx` 0.11.0 forwards eight fields of `ChartSpaceOptions` from
 * a chart run — `type`, `title`, `series`, `categories`, `showLegend`, `style`,
 * `threeD`, `view3D` — and silently drops the rest. Verified against the
 * package rather than its types, because `ChartOptions extends
 * ChartSpaceOptions` promises far more than the run actually reads. Three gaps
 * matter, and all three are visible to whoever opens the document:
 *
 * - **No `c:externalData`.** Every `<c:f>` comes out empty, so the chart caches
 *   its values with no source for them and Word's "Edit Data" fails. This is
 *   the same defect the pptx office-open adapter refuses native charts over.
 * - **No series colours.** Neither `ChartSeriesCommon` nor `DataPointOptions`
 *   has a fill, and `colorMappingOverride` is not forwarded, so every series
 *   draws in Word's default palette and ignores the document theme.
 * - **No `axes`.** Default `c:catAx`/`c:valAx` are emitted, but an authored
 *   axis title never reaches them.
 *
 * So this pass splices them in after generation. Editing another library's
 * serialisation is not free, and it is chosen deliberately: the alternative is
 * shipping a chart that draws and then fails on the first double-click. The
 * pptx pptxgenjs adapter reaches for the same technique, for gradient and
 * pattern fills, for the same reason.
 *
 * The splice is anchored on markers the backend emits verbatim and this file
 * asserts on in its tests — an empty `<c:f/>`, an empty `<c:spPr/>` inside a
 * `<c:ser>`, `</c:chartSpace>`. If the package starts writing any of them
 * itself, the corresponding test fails loudly rather than the splice quietly
 * doubling an element.
 */

import type AdmZip from 'adm-zip';
import type { DocxIrChartRun } from '../../ir/types';
import {
  buildChartWorkbook,
  categoryReference,
  seriesNameReference,
  seriesValueReference,
} from '../../utils/chartWorkbook';

const PACKAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  pointCount: number
): string {
  const references = [
    seriesNameReference(seriesIndex),
    categoryReference(pointCount),
    seriesValueReference(seriesIndex, pointCount),
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
 * A line series has no area to fill: a `a:solidFill` on one is accepted, drawn
 * nowhere, and the line stays the reader's default colour — which is what a
 * LibreOffice render of the example showed, a blue line under an `accent`
 * palette. The colour has to go on `a:ln`, and on the marker with it, or the
 * points keep the default too.
 */
const STROKE_COLORED: ReadonlySet<string> = new Set([
  'line',
  'scatter',
  'radar',
]);

/** Paint one series, leaving the empty `<c:spPr/>` alone when there is no colour. */
function paintSeries(
  seriesXml: string,
  color: string | undefined,
  chartType: string
): string {
  if (!color) return seriesXml;
  const hex = color.toUpperCase();
  const fill = `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;

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

/**
 * Insert an axis title into one axis element.
 *
 * CT_CatAx and CT_ValAx both order `title` after `axPos` and before `numFmt`,
 * and Word enforces that order — a title written anywhere else is a repair
 * prompt, not a mis-drawn label. Anchoring on the close of `c:axPos` puts it
 * exactly there.
 */
function titleAxis(
  chartXml: string,
  tag: string,
  text: string | undefined
): string {
  if (!text) return chartXml;
  const open = `<c:${tag}>`;
  const start = chartXml.indexOf(open);
  if (start < 0) return chartXml;
  const end = chartXml.indexOf(`</c:${tag}>`, start);
  if (end < 0) return chartXml;

  const axis = chartXml.slice(start, end);
  const axPos = axis.match(/<c:axPos[^>]*\/>/);
  if (!axPos) return chartXml;

  const insertAt = axis.indexOf(axPos[0]) + axPos[0].length;
  const titled =
    axis.slice(0, insertAt) + axisTitle(text) + axis.slice(insertAt);
  return chartXml.slice(0, start) + titled + chartXml.slice(end);
}

/** Rewrite one `word/charts/chartN.xml` with everything the backend omitted. */
function spliceChartXml(chartXml: string, chart: DocxIrChartRun): string {
  const pointCount = chart.series[0]?.labels.length ?? 0;

  // Walk the series in document order so the Nth `<c:ser>` gets the Nth
  // series' references and colour. A regex over the whole part would fill the
  // formulas of every series from the first one's ranges.
  let seriesIndex = 0;
  let result = chartXml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (seriesXml) => {
    const index = seriesIndex++;
    const withFormulas = fillSeriesFormulas(seriesXml, index, pointCount);
    // A palette shorter than the series list wraps, exactly as the implicit
    // theme palette does everywhere else in the project.
    const color =
      chart.colors.length > 0
        ? chart.colors[index % chart.colors.length]
        : undefined;
    return paintSeries(withFormulas, color, chart.chartType);
  });

  result = titleAxis(result, 'catAx', chart.categoryAxisTitle);
  result = titleAxis(result, 'valAx', chart.valueAxisTitle);

  // `legendPosition` is not among the eight fields the backend forwards, so
  // every legend came out at the default `b` whatever the author asked for.
  if (chart.legendPosition) {
    result = result.replace(
      /<c:legendPos val="[^"]*"\/>/,
      `<c:legendPos val="${chart.legendPosition}"/>`
    );
  }

  // `c:externalData` is the last child of `c:chartSpace`: after `c:chart`,
  // `c:spPr` and `c:txPr`, before nothing.
  return result.replace(
    '</c:chartSpace>',
    `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
  );
}

/** Register the xlsx content type once, if the package does not have it. */
function declareWorkbookContentType(zip: AdmZip): void {
  const entry = zip.getEntry('[Content_Types].xml');
  if (!entry) return;
  const xml = entry.getData().toString('utf8');
  if (xml.includes(`Extension="xlsx"`)) return;
  zip.updateFile(
    entry,
    Buffer.from(
      xml.replace(
        '<Default Extension="xml"',
        `<Default Extension="xlsx" ContentType="${XLSX_CONTENT_TYPE}"/><Default Extension="xml"`
      ),
      'utf8'
    )
  );
}

/**
 * Every `<c:v>` in a chart part, per series, in document order.
 *
 * The identity of a chart part, for the purpose of matching it to the IR node
 * it came from. Position cannot do that job: the emitter fills its array while
 * *building* the backend's document object, and the backend numbers its parts
 * while *stringifying* that object, and the two walks disagree the moment a
 * chart sits in a header or footer — the body is stringified before the chrome,
 * while the emitter builds a section's properties before its children. Pairing
 * by position handed charts another chart's workbook, so a recipient choosing
 * "Edit Data" saw a different chart's numbers.
 *
 * Content is stable under either walk. A `<c:v>` holds a series name, a
 * category label or a cached value, all of which came from the IR node and none
 * of which this pass has written yet.
 */
function partSignature(chartXml: string): string {
  return (chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? [])
    .map((series) =>
      [...series.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)]
        .map((match) => match[1])
        .join('\u0001')
    )
    .join('\u0002');
}

/** The same signature, computed from the IR node the part was emitted from. */
function chartSignature(chart: DocxIrChartRun): string {
  const categories = chart.series[0]?.labels ?? [];
  return chart.series
    .map((series, index) =>
      [
        series.name ?? `Series ${index + 1}`,
        ...categories,
        ...series.values.map((value) => String(value)),
      ].join('\u0001')
    )
    .join('\u0002');
}

/**
 * Give every chart in the package its workbook, colours and axis titles.
 *
 * Parts are matched to IR nodes by content rather than by position — see
 * {@link partSignature}. Two charts identical in every cached value match
 * interchangeably, which is harmless: identical data yields an identical
 * workbook, and the only thing that could differ between them is a palette,
 * which an author who wrote two identical charts did not distinguish either.
 */
export function spliceChartParts(
  zip: AdmZip,
  charts: readonly DocxIrChartRun[]
): void {
  if (charts.length === 0) return;

  const unmatched = new Set(charts.keys());
  const partCount = zip
    .getEntries()
    .filter((entry) =>
      /^word\/charts\/chart\d+\.xml$/.test(entry.entryName)
    ).length;

  for (let ordinal = 1; ordinal <= partCount; ordinal++) {
    const chartPath = `word/charts/chart${ordinal}.xml`;
    const entry = zip.getEntry(chartPath);
    if (!entry) continue;

    const chartXml = entry.getData().toString('utf8');
    const signature = partSignature(chartXml);
    const matched = [...unmatched].find(
      (index) => chartSignature(charts[index]) === signature
    );
    // No match means the package holds a chart this pass did not emit. Leaving
    // it alone is the only safe answer: repairing it from the wrong node is
    // exactly the defect this matching exists to prevent.
    if (matched === undefined) continue;
    unmatched.delete(matched);
    const chart = charts[matched];

    zip.updateFile(entry, Buffer.from(spliceChartXml(chartXml, chart), 'utf8'));

    const workbookName = `chart${ordinal}.xlsx`;
    zip.addFile(
      `word/embeddings/${workbookName}`,
      Buffer.from(buildChartWorkbook(chart.series))
    );
    zip.addFile(
      `word/charts/_rels/chart${ordinal}.xml.rels`,
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="${PACKAGE_RELATIONSHIP}" ` +
          `Target="../embeddings/${workbookName}"/>` +
          `</Relationships>`,
        'utf8'
      )
    );
  }

  declareWorkbookContentType(zip);
}

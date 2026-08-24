/**
 * Packaging a native chart's missing half, for PPTX.
 *
 * The repairs themselves are format-neutral and live in `chart-parts` in
 * `@json-to-office/shared/rendering`; a `c:chartSpace` is DrawingML and the
 * docx sibling of this file makes the same edits. What differs is how much is
 * missing. `@office-open/pptx` hands its whole options object to
 * `chartSpaceDesc`, so the chart title and the legend position survive the trip
 * — verified against the package — where the docx sibling loses both. Every
 * other repair is needed on this side too: the cell references, the series
 * colours, the axis titles, the bar grouping and `c:externalData`. The shared
 * splice guards each on what the XML actually lacks, so the same function does
 * both jobs without writing anything twice.
 *
 * What is genuinely pptx's own is the packaging. The backend writes
 * `ppt/charts/chartN.xml` and nothing else: no rels part, no workbook, no
 * content-type override for one. Two conventions have to be matched exactly:
 *
 * - The workbook is `ppt/embeddings/Microsoft_Excel_Worksheet{N}.xlsx`, which
 *   is what pptxgenjs writes, so a deck's two backends produce packages of the
 *   same shape.
 * - `canonicalizeChartIds` in `finalizePackage` renumbers chart parts to 1..n
 *   and rewrites `Microsoft_Excel_Worksheet{N}.xlsx` references through the
 *   *same* index map. So the workbook's number must match the chart part it
 *   belongs to, and this pass must run before finalization — otherwise the
 *   rename walks a reference that is not there yet.
 */

import JSZip from 'jszip';
import {
  CHART_WORKBOOK_CONTENT_TYPE,
  chartWorkbookParts,
  chartWorkbookRelsXml,
  matchChartParts,
  spliceChartXml,
  type ChartAxisEdits,
  type ChartPartInput,
  type ChartTextStyle,
} from '@json-to-office/shared/rendering';
import type {
  PptxIrChartAxis,
  PptxIrChartElement,
  PptxIrChartLabelFont,
  PptxIrChartValueAxis,
} from '../../ir/types';

/** The workbook name pptxgenjs uses, and therefore the one this must use too. */
const workbookName = (ordinal: number): string =>
  `Microsoft_Excel_Worksheet${ordinal}.xlsx`;

/**
 * One chart element, in the shared splice's vocabulary.
 *
 * The pptx IR carries a far richer options bag than the splice needs — four
 * label fonts, per-family tuning, axis bounds — and all of it reaches the
 * backend through the emitter. Only the handful the backend drops is projected
 * here.
 *
 * A series missing `labels` or `values` cannot occur: the compiler warns
 * `CHART_INVALID_SERIES` and drops the whole chart before it reaches the IR.
 * The empty fallbacks keep this total rather than relying on that from a
 * distance.
 */
function spliceInput(element: PptxIrChartElement): ChartPartInput {
  return {
    chartType: element.chartType,
    series: element.series.map((series) => ({
      ...(series.name !== undefined ? { name: series.name } : {}),
      labels: series.labels ?? [],
      values: series.values ?? [],
    })),
    colors: element.options.colors,
    ...(element.options.barGrouping
      ? { barGrouping: element.options.barGrouping }
      : {}),
    // Spliced rather than emitted: see `chartChild`, which cannot pass `axes`
    // without also inventing the axis ids the plot area references.
    categoryAxis: axisEdits(element.options.categoryAxis),
    valueAxis: axisEdits(element.options.valueAxis),
    // Three the backend has nowhere to put: `ChartSeriesCommon` has no line
    // width, no data-element outline, and `c:radarStyle` is written from a
    // literal rather than an option.
    ...(element.options.lineSize !== undefined
      ? { lineWidthPoints: element.options.lineSize }
      : {}),
    ...(element.options.dataBorder
      ? {
          dataBorder: {
            widthPoints: element.options.dataBorder.widthPoints,
            color: element.options.dataBorder.color.hex,
          },
        }
      : {}),
    ...(element.options.radarStyle
      ? { radarStyle: element.options.radarStyle }
      : {}),
    // Fonts: `c:txPr` and `a:defRPr` on four different elements, none of which
    // the backend exposes an option for.
    ...(textStyle(element.options.titleFont)
      ? { titleFont: textStyle(element.options.titleFont) }
      : {}),
    ...(textStyle(element.options.legendFont)
      ? { legendFont: textStyle(element.options.legendFont) }
      : {}),
    ...(textStyle(element.options.dataLabelFont)
      ? { dataLabelFont: textStyle(element.options.dataLabelFont) }
      : {}),
  };
}

/** One resolved label font, or nothing if it carries no styling. */
function textStyle(
  font: PptxIrChartLabelFont | undefined
): ChartTextStyle | undefined {
  if (!font) return undefined;
  const style: ChartTextStyle = {
    ...(font.fontFamily !== undefined ? { fontFamily: font.fontFamily } : {}),
    ...(font.fontSize !== undefined ? { fontSize: font.fontSize } : {}),
    ...(font.bold !== undefined ? { bold: font.bold } : {}),
    ...(font.color ? { color: font.color.hex } : {}),
  };
  return Object.keys(style).length > 0 ? style : undefined;
}

/** One authored axis, in the shared splice's vocabulary. */
function axisEdits(
  axis: PptxIrChartAxis | PptxIrChartValueAxis
): ChartAxisEdits {
  const value = axis as PptxIrChartValueAxis;
  return {
    ...(axis.title !== undefined ? { title: axis.title } : {}),
    ...(axis.hidden !== undefined ? { hidden: axis.hidden } : {}),
    ...(axis.showLine !== undefined ? { lineVisible: axis.showLine } : {}),
    ...(axis.labelRotate !== undefined
      ? { labelRotation: axis.labelRotate }
      : {}),
    ...(textStyle(axis.labelFont)
      ? { labelFont: textStyle(axis.labelFont) }
      : {}),
    ...(axis.gridLine
      ? {
          gridLine: {
            ...(textStyle(axis.labelFont)
              ? { labelFont: textStyle(axis.labelFont) }
              : {}),
            ...(axis.gridLine.style !== undefined
              ? { style: axis.gridLine.style }
              : {}),
            ...(textStyle(axis.labelFont)
              ? { labelFont: textStyle(axis.labelFont) }
              : {}),
            ...(axis.gridLine.size !== undefined
              ? { size: axis.gridLine.size }
              : {}),
            ...(textStyle(axis.labelFont)
              ? { labelFont: textStyle(axis.labelFont) }
              : {}),
            ...(axis.gridLine.color ? { color: axis.gridLine.color.hex } : {}),
          },
        }
      : {}),
    ...(value.minValue !== undefined ? { min: value.minValue } : {}),
    ...(value.maxValue !== undefined ? { max: value.maxValue } : {}),
    ...(value.majorUnit !== undefined ? { majorUnit: value.majorUnit } : {}),
    ...(value.labelFormatCode !== undefined
      ? { numberFormat: value.labelFormatCode }
      : {}),
  };
}

/**
 * Register the xlsx content type once, if the package does not have it.
 *
 * Fails loudly rather than open. `String.replace` returns its input unchanged
 * when the needle is absent, so a backend that reformatted or reordered that
 * `Default` element would turn this into a silent no-op — and the package would
 * then hold `.xlsx` parts no `Default` and no `Override` covers, which is an
 * OPC violation a reader offers to repair. Nothing else in this pass would
 * notice: the chart XML still looks right.
 */
function declareWorkbookContentType(zip: JSZip, xml: string): void {
  if (xml.includes(`Extension="xlsx"`)) return;
  const patched = xml.replace(
    '<Default Extension="xml"',
    `<Default Extension="xlsx" ContentType="${CHART_WORKBOOK_CONTENT_TYPE}"/><Default Extension="xml"`
  );
  if (patched === xml) {
    throw new Error(
      'Could not declare the embedded workbook content type: ' +
        '[Content_Types].xml has no `<Default Extension="xml"` to anchor on. ' +
        'The package would ship an .xlsx part no content type covers.'
    );
  }
  zip.file('[Content_Types].xml', patched, { createFolders: false });
}

/**
 * Build one chart's workbook as a nested zip.
 *
 * `finalizePackage` walks embedded `.xlsx` entries and normalizes their
 * timestamps recursively, so no clock is pinned here — unlike the docx side,
 * whose package pass does not recurse.
 */
async function workbookBytes(chart: ChartPartInput): Promise<Uint8Array> {
  const book = new JSZip();
  for (const [path, content] of chartWorkbookParts(chart.series)) {
    // `createFolders` defaults to true and would add 0-length directory
    // entries no other Office package carries.
    book.file(path, content, { createFolders: false });
  }
  return book.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Give every chart in the package the cell references, colours and workbook the
 * backend leaves out.
 *
 * Parts are matched to IR elements by content rather than by position: the
 * emitter fills its array while *building* the backend's options object and the
 * backend numbers its parts while *stringifying* that object, and the two walks
 * need not agree. Pairing by position is what handed docx charts another
 * chart's workbook.
 */
export async function spliceChartParts(
  zip: JSZip,
  charts: readonly PptxIrChartElement[]
): Promise<void> {
  if (charts.length === 0) return;

  const inputs = charts.map(spliceInput);
  const parts: Array<readonly [number, string]> = [];
  for (const path of Object.keys(zip.files)) {
    const match = path.match(/^ppt\/charts\/chart(\d+)\.xml$/);
    if (!match) continue;
    parts.push([Number(match[1]), await zip.file(path)!.async('string')]);
  }
  parts.sort(([a], [b]) => a - b);

  for (const { ordinal, xml, chart } of matchChartParts(parts, inputs)) {
    const workbook = workbookName(ordinal);

    zip.file(`ppt/charts/chart${ordinal}.xml`, spliceChartXml(xml, chart), {
      createFolders: false,
    });
    zip.file(`ppt/embeddings/${workbook}`, await workbookBytes(chart), {
      binary: true,
      createFolders: false,
    });
    zip.file(
      `ppt/charts/_rels/chart${ordinal}.xml.rels`,
      chartWorkbookRelsXml(workbook),
      { createFolders: false }
    );
  }

  const contentTypes = zip.file('[Content_Types].xml');
  if (contentTypes) {
    declareWorkbookContentType(zip, await contentTypes.async('string'));
  }
}

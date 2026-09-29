/**
 * A native chart's look, references and workbook, for PPTX.
 *
 * The look and the cell references are format-neutral and are stated as
 * backend options by `chartLook` in `@json-to-office/shared/rendering`, from
 * `chartInput` here; the docx sibling of this file does the same. What is
 * genuinely pptx's own is the packaging. `@office-open/pptx` writes
 * `ppt/charts/chartN.xml` with the `c:externalData` it is asked for, and
 * nothing behind it: no rels part, no workbook, no content-type default for
 * one — asked for the workbook bytes, it writes a relationship id that
 * resolves to nothing. Two conventions have to be matched exactly:
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
  finishChartXml,
  matchChartParts,
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
 * One chart element, in the shared look's vocabulary: everything of its
 * options but the type, the data and the data-label flags, which the emitter
 * passes itself.
 *
 * A series missing `labels` or `values` cannot occur: the compiler warns
 * `CHART_INVALID_SERIES` and drops the whole chart before it reaches the IR.
 * The empty fallbacks keep this total rather than relying on that from a
 * distance.
 */
export function chartInput(element: PptxIrChartElement): ChartPartInput {
  const { options } = element;
  return {
    chartType: element.chartType,
    series: element.series.map((series) => ({
      ...(series.name !== undefined ? { name: series.name } : {}),
      labels: series.labels ?? [],
      values: series.values ?? [],
    })),
    colors: element.options.colors,
    ...(options.title && options.showTitle !== false
      ? { title: options.title }
      : {}),
    ...(options.legendPosition
      ? { legendPosition: options.legendPosition }
      : {}),
    ...(element.options.barGrouping
      ? { barGrouping: element.options.barGrouping }
      : {}),
    // Per-family tuning, each only when authored: the backend has its own
    // defaults, and writing a value it did not ask for is how a chart drifts
    // from the one that was designed.
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
    categoryAxis: axisEdits(element.options.categoryAxis),
    valueAxis: axisEdits(element.options.valueAxis),
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

/** One authored axis, in the shared look's vocabulary. */
function axisEdits(
  axis: PptxIrChartAxis | PptxIrChartValueAxis
): ChartAxisEdits {
  const value = axis as PptxIrChartValueAxis;
  return {
    ...(axis.title !== undefined ? { title: axis.title } : {}),
    ...(axis.title !== undefined && textStyle(axis.titleFont)
      ? { titleFont: textStyle(axis.titleFont) }
      : {}),
    ...(axis.title !== undefined && axis.titleRotate !== undefined
      ? { titleRotation: axis.titleRotate }
      : {}),
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
 * Give every chart in the package the workbook its `c:externalData` names,
 * and finish what no option says.
 *
 * Parts are matched to IR elements by content rather than by position: the
 * emitter fills its array while *building* the backend's options object and
 * the backend numbers its parts while *stringifying* that object, and the two
 * walks need not agree. Pairing by position is what handed docx charts another
 * chart's workbook.
 */
export async function packageChartParts(
  zip: JSZip,
  charts: readonly PptxIrChartElement[]
): Promise<void> {
  if (charts.length === 0) return;

  const inputs = charts.map(chartInput);
  const parts: Array<readonly [number, string]> = [];
  for (const path of Object.keys(zip.files)) {
    const match = path.match(/^ppt\/charts\/chart(\d+)\.xml$/);
    if (!match) continue;
    parts.push([Number(match[1]), await zip.file(path)!.async('string')]);
  }
  parts.sort(([a], [b]) => a - b);

  for (const { ordinal, xml, chart } of matchChartParts(parts, inputs)) {
    const workbook = workbookName(ordinal);

    const finished = finishChartXml(xml, chart);
    if (finished !== xml) {
      zip.file(`ppt/charts/chart${ordinal}.xml`, finished, {
        createFolders: false,
      });
    }
    zip.file(`ppt/embeddings/${workbook}`, await workbookBytes(chart), {
      binary: true,
      createFolders: false,
    });
    // `rId1`: the relationship id `chartLook` puts on `c:externalData`.
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

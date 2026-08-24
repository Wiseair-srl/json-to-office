/**
 * Packaging a native chart's missing half, for DOCX.
 *
 * The repairs themselves — the cell references that fill an empty `<c:f/>`, the
 * series colours, the axis titles, the legend position and `c:externalData` —
 * are format-neutral and live in `chart-parts` in
 * `@json-to-office/shared/rendering`, which explains why a chart emitted by
 * `@office-open` needs repairing at all. A `c:chartSpace` is DrawingML: the
 * pptx sibling of this file makes exactly the same edits.
 *
 * What is here is only what a Word package spells its own way — `word/charts`,
 * `word/embeddings`, the chart's rels part, the content-type override — plus
 * adm-zip, which is this core's archive library.
 */

import type AdmZip from 'adm-zip';
import {
  CHART_WORKBOOK_CONTENT_TYPE,
  chartWorkbookRelsXml,
  matchChartParts,
  spliceChartXml,
} from '@json-to-office/shared/rendering';
import type { DocxIrChartRun } from '../../ir/types';
import { buildChartWorkbook } from '../../utils/chartWorkbook';

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
        `<Default Extension="xlsx" ContentType="${CHART_WORKBOOK_CONTENT_TYPE}"/><Default Extension="xml"`
      ),
      'utf8'
    )
  );
}

/**
 * Give every chart in the package its workbook, colours and axis titles.
 *
 * Parts are matched to IR nodes by content rather than by position: the emitter
 * fills its array while *building* the backend's document object and the
 * backend numbers its parts while *stringifying* that object, and the two walks
 * disagree the moment a chart sits in a header or footer. Pairing by position
 * handed charts another chart's workbook, so a recipient choosing "Edit Data"
 * saw a different chart's numbers.
 */
export function spliceChartParts(
  zip: AdmZip,
  charts: readonly DocxIrChartRun[]
): void {
  if (charts.length === 0) return;

  const parts = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .map((name) => name.match(/^word\/charts\/chart(\d+)\.xml$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(
      (match) =>
        [
          Number(match[1]),
          zip.getEntry(match[0])!.getData().toString('utf8'),
        ] as const
    );

  for (const { ordinal, xml, chart } of matchChartParts(parts, charts)) {
    const workbookName = `chart${ordinal}.xlsx`;

    zip.updateFile(
      zip.getEntry(`word/charts/chart${ordinal}.xml`)!,
      Buffer.from(spliceChartXml(xml, chart), 'utf8')
    );
    zip.addFile(
      `word/embeddings/${workbookName}`,
      Buffer.from(buildChartWorkbook(chart.series))
    );
    zip.addFile(
      `word/charts/_rels/chart${ordinal}.xml.rels`,
      Buffer.from(chartWorkbookRelsXml(workbookName), 'utf8')
    );
  }

  declareWorkbookContentType(zip);
}

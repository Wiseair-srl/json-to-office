/**
 * Packaging the workbook a native chart points at, for DOCX.
 *
 * The XML is shared with the pptx side — see `chart-parts` in
 * `@json-to-office/shared/rendering`, which explains why these bytes have to
 * exist at all. What lives here is only the part a shared module cannot own:
 * turning those five parts into a ZIP, with adm-zip, which is this core's
 * archive library and not the other's.
 */

import AdmZip from 'adm-zip';
import { chartWorkbookParts } from '@json-to-office/shared/rendering';
import type { ChartPartSeries } from '@json-to-office/shared/rendering';
import { toDosTime, DEFAULT_GENERATION_DATE } from './packageDocument';

/** The single instant every entry in a chart workbook is stamped with. */
const WORKBOOK_TIMESTAMP = toDosTime(DEFAULT_GENERATION_DATE);

/**
 * Build the xlsx package a chart's `c:externalData` points at.
 *
 * Entry order comes from the shared part list rather than from iteration
 * order here, so the ZIP central directory is a function of the data alone.
 */
export function buildChartWorkbook(
  series: readonly ChartPartSeries[]
): Uint8Array {
  const zip = new AdmZip();

  for (const [name, content] of chartWorkbookParts(series)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  // AdmZip stamps entries from the wall clock as they are added, so pin every
  // header the same way the document package does — through the raw DOS field,
  // never the `time` Date accessor, whose local-time round-trip has no
  // representation inside a DST spring-forward gap.
  for (const entry of zip.getEntries()) {
    (entry.header as unknown as { timeval: number }).timeval =
      WORKBOOK_TIMESTAMP;
  }

  return new Uint8Array(zip.toBuffer());
}

export {
  CHART_WORKBOOK_SHEET_NAME,
  categoryReference,
  columnLetter,
  seriesNameReference,
  seriesValueReference,
} from '@json-to-office/shared/rendering';

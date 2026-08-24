/**
 * The workbook a native chart points at.
 *
 * A `c:chartSpace` does not hold its own numbers twice over: it holds cached
 * values *and* a reference — `Sheet1!$B$2:$B$5` — into an embedded workbook,
 * and that is what a reader opens behind "Edit Data". `@office-open` writes the
 * chart XML and the `c:externalData` pointer, but nothing in the package builds
 * the part being pointed at: `ExternalDataOptions` is `{relationshipId,
 * autoUpdate}` and no workbook generator exists anywhere in `@office-open/core`
 * (`XLSX_PARTS` is an OPC validation manifest, `XLSX` a content-type constant).
 *
 * So these bytes are ours. Shipping a chart without them is the defect the pptx
 * sibling refuses native charts over today: the chart draws, and "Edit Data"
 * fails.
 *
 * Deliberately minimal — five parts, one sheet, inline strings rather than a
 * shared-string table. A chart workbook is written once and read by one
 * consumer, so the compression a shared-string table buys is not worth a part
 * whose indices are one more thing to keep in step with the cells.
 *
 * Deterministic by construction: no clock, no counter, no id that depends on
 * anything but the data. Same series, same bytes.
 */

import AdmZip from 'adm-zip';
import type { DocxIrChartSeries } from '../ir/types';
import { toDosTime, DEFAULT_GENERATION_DATE } from './packageDocument';

/** The single instant every entry in a chart workbook is stamped with. */
const WORKBOOK_TIMESTAMP = toDosTime(DEFAULT_GENERATION_DATE);

/** The sheet a chart's cell references name. */
export const CHART_WORKBOOK_SHEET_NAME = 'Sheet1';

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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A number Excel will accept: finite, and never in exponential shorthand. */
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
function sheetXml(series: readonly DocxIrChartSeries[]): string {
  const rowCount = series[0]?.labels.length ?? 0;
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
    const cells = [
      inlineStringCell(`A${reference}`, series[0].labels[row] ?? ''),
      ...series.map((entry, index) =>
        numberCell(
          `${columnLetter(index + 2)}${reference}`,
          entry.values[row] ?? 0
        )
      ),
    ];
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
 * Build the xlsx package a chart's `c:externalData` points at.
 *
 * Entry order is fixed rather than incidental, so the ZIP central directory is
 * a function of the data alone.
 */
export function buildChartWorkbook(
  series: readonly DocxIrChartSeries[]
): Uint8Array {
  const zip = new AdmZip();
  const parts: [string, string][] = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', WORKBOOK_XML],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/worksheets/sheet1.xml', sheetXml(series)],
  ];

  for (const [name, content] of parts) {
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

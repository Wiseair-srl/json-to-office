/**
 * A table of contents in a table cell, for DOCX.
 *
 * `@office-open/docx` writes a table cell's paragraphs and tables and nothing
 * else: `stringifyCellChild` answers any other child with an empty string, so
 * a contents field in a cell used to vanish from the package. The emitter
 * therefore hands one over as its entry paragraphs between two marker
 * paragraphs (`cellChildren` in `emit.ts`), and this replaces the three with
 * what the backend writes for a table of contents in the body: its own
 * `stringifyTableOfContents`, around the same entry paragraphs — which the
 * backend writes the same way in a cell as in the body.
 */

import type AdmZip from 'adm-zip';
import type { CellToc } from './emit';

/** The backend's writer for a table of contents: an `sdt` around the field. */
export type StringifyTableOfContents = (
  alias?: string,
  options?: Record<string, unknown>,
  entriesXml?: string
) => string;

/** The parts a table can stand in, and so a cell. */
const TABLE_PARTS = /^word\/(?:document|header\d+|footer\d+)\.xml$/;

/**
 * Put every table of contents the emitter left in a cell back together.
 *
 * Each marker has to be found exactly once. One that is missing, repeated or
 * out of order means the paragraphs between the two are not the entries that
 * were emitted, and a field around the wrong paragraphs — or marker text left
 * in the document — is worse than a failed render.
 */
export function spliceCellTocs(
  zip: AdmZip,
  tocs: readonly CellToc[],
  stringifyTableOfContents: StringifyTableOfContents
): void {
  if (tocs.length === 0) return;

  const spliced = new Set<CellToc>();
  for (const entry of zip.getEntries()) {
    if (!TABLE_PARTS.test(entry.entryName)) continue;
    const original = entry.getData().toString('utf8');
    let xml = original;
    for (const toc of tocs) {
      const start = markerParagraph(xml, toc.start);
      if (!start) continue;
      const end = markerParagraph(xml, toc.end);
      if (spliced.has(toc) || !end || end.from < start.to) {
        throw new Error(
          `the office-open renderer lost track of a table of contents in a table cell (${entry.entryName})`
        );
      }
      xml =
        xml.slice(0, start.from) +
        stringifyTableOfContents(
          toc.alias,
          toc.options,
          xml.slice(start.to, end.from)
        ) +
        xml.slice(end.to);
      spliced.add(toc);
    }
    if (xml !== original) zip.updateFile(entry, Buffer.from(xml, 'utf8'));
  }

  if (spliced.size !== tocs.length) {
    throw new Error(
      `the office-open renderer placed ${tocs.length} table(s) of contents in table cells and found ${spliced.size}`
    );
  }
}

/**
 * The span of the one paragraph holding `marker`, or nothing when the marker
 * is not in `xml` at all.
 */
function markerParagraph(
  xml: string,
  marker: string
): { from: number; to: number } | undefined {
  const at = xml.indexOf(marker);
  if (at < 0) return undefined;
  const from = Math.max(
    xml.lastIndexOf('<w:p>', at),
    xml.lastIndexOf('<w:p ', at)
  );
  const close = xml.indexOf('</w:p>', at);
  if (
    xml.indexOf(marker, at + marker.length) >= 0 ||
    from < 0 ||
    close < 0 ||
    xml.lastIndexOf('</w:p>', at) > from
  ) {
    throw new Error(
      'the office-open renderer found a table-of-contents marker it did not write'
    );
  }
  return { from, to: close + '</w:p>'.length };
}

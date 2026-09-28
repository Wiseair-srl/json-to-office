/**
 * Post-pack repair for drawing groups written by `docx/shapes`.
 *
 * Runs after `fixFloatingImageIdsInBuffer`, and only for a package whose IR
 * holds a drawing group. Three things `docx/shapes` writes cannot be stated
 * through its options, so they are put right here:
 *
 * - **Child ids.** Every `wps:cNvPr`/`pic:cNvPr`/`wpg:cNvPr` inside a group is
 *   drawn from docx's process-wide drawing counter, so the same document came
 *   out with different ids depending on what the process built before. They
 *   are renumbered in one sequence that starts after the highest drawing id
 *   anywhere else in the package, walking the parts in the order
 *   `fixFloatingImageIds` numbers `wp:docPr` in. Taking the maximum rather
 *   than assuming a count keeps this pass independent of how that one
 *   numbers. No connector (`a:stCxn`/`a:endCxn`) is ever emitted, so nothing
 *   refers to these ids.
 * - **Rotation.** docx writes `rot` as degrees × 60000 without rounding, and
 *   `7.123456°` becomes `rot="427407.36"`, which `ST_Angle` (an int) forbids.
 *   It is rounded — and not wrapped into [0, 360°), exactly as office-open's
 *   `emitAngle` writes it, so `-30°` stays `rot="-1800000"`.
 * - **Markers** (see `drawingGroup.ts`): the `wp:docPr` description that stood
 *   for "no alt text" is dropped, and the `wps:cNvPr` title that stood for a
 *   text box becomes `wps:cNvSpPr txBox="1"`. A marker that survives means
 *   docx changed how it serialises one of them; that is a pipeline bug and
 *   throws, naming the part, rather than shipping a stray attribute.
 *
 * Every part holding a group is rewritten unconditionally, for the reason
 * `fixFloatingImageIds` gives: whether an id "changed" depends on the process
 * counter, and a rewritten entry is deflated differently from one left alone,
 * so a changed-only rule would leak the counter into the package bytes.
 */

import AdmZip from 'adm-zip';
import {
  DRAWING_PART,
  compareDrawingParts,
} from '../../utils/fixFloatingImageIds';
import type { DrawingGroupMarkers } from './drawingGroup';

/**
 * One group, start to end. Groups never nest here: native text holds runs
 * only, and a nested group would be a `wpg:grpSp`, not another `wpg:wgp`.
 */
const GROUP = /<wpg:wgp\b[^>]*>[\s\S]*?<\/wpg:wgp>/g;
const DOC_PR_ID = /<wp:docPr\b[^>]*?\sid="(\d+)"/g;
const CNVPR_ID = /<(?:wps|pic|wpg):cNvPr\b[^>]*?\sid="(\d+)"/g;
const CHILD_ID = /(<(?:wps|pic|wpg):cNvPr\b[^>]*?\s)id="\d+"/g;
const ROTATION = /(<a:xfrm\b[^>]*?\s)rot="([^"]*)"/g;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function repairDrawingGroupsInBuffer(
  buffer: Buffer,
  markers: DrawingGroupMarkers
): Buffer {
  const textBox = new RegExp(
    `(<wps:cNvPr\\b[^>]*?) title="${escapeRegExp(markers.textBox)}"(\\s*/>)<wps:cNvSpPr/>`,
    'g'
  );
  const noAltText = new RegExp(
    `(<wp:docPr\\b[^>]*?) descr="${escapeRegExp(markers.noAltText)}"`,
    'g'
  );

  const zip = new AdmZip(buffer);
  // The entries themselves, as `fixFloatingImageIds` holds them.
  const parts = zip
    .getEntries()
    .filter((entry) => DRAWING_PART.test(entry.entryName))
    .sort((a, b) => compareDrawingParts(a.entryName, b.entryName));
  const texts = new Map(
    parts.map((entry) => [entry, entry.getData().toString('utf8')])
  );

  let highest = 0;
  for (const xml of texts.values()) {
    for (const match of xml.matchAll(DOC_PR_ID)) {
      highest = Math.max(highest, Number(match[1]));
    }
    for (const match of xml.replace(GROUP, '').matchAll(CNVPR_ID)) {
      highest = Math.max(highest, Number(match[1]));
    }
  }

  let next = highest + 1;
  for (const [entry, xml] of texts) {
    if (!xml.includes('<wpg:wgp')) continue;
    const repaired = xml
      .replace(GROUP, (span) =>
        span
          .replace(CHILD_ID, (_match, head: string) => `${head}id="${next++}"`)
          // `Math.round(-0.3)` is -0, which a template literal writes as "0".
          .replace(
            ROTATION,
            (_match, head: string, value: string) =>
              `${head}rot="${Math.round(Number(value))}"`
          )
          .replace(textBox, '$1$2<wps:cNvSpPr txBox="1"/>')
      )
      .replace(noAltText, '$1');
    texts.set(entry, repaired);
    zip.updateFile(entry, Buffer.from(repaired, 'utf8'));
  }

  for (const [entry, xml] of texts) {
    if (xml.includes(markers.noAltText) || xml.includes(markers.textBox)) {
      throw new Error(
        `the drawing-group repair left a marker in ${entry.entryName}`
      );
    }
  }
  return zip.toBuffer();
}

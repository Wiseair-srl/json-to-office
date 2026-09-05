/**
 * Case is a run property with two mutually exclusive OOXML flags, `w:caps` and
 * `w:smallCaps`, and both DOCX writers emit only the one that is true (docx.js
 * `RunProperties` writes `w:smallCaps` *or* `w:caps`, never both). A run that
 * turns case off, or swaps one kind for the other, therefore inherits the flag
 * it did not state from its style. This pass states the opposite flag as false.
 *
 * `CT_RPr` is an ordered sequence — `w:caps` precedes `w:smallCaps`, and both
 * precede `w:strike`, `w:color`, `w:sz` — so the added flag goes next to the
 * flag already present, never at the end of the property bag.
 */
import type AdmZip from 'adm-zip';

const WORD_XML = /^word\/.*\.xml$/;
const ANY_CASE_FLAG = /<w:(?:caps|smallCaps)\b/;
const RUN_PROPERTIES = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g;
const CASE_FLAG = /<w:(caps|smallCaps)\b[^>]*(?:\/>|>[\s\S]*?<\/w:\1>)/;

/** Add the missing case flag to every run that states exactly one of them. */
export function normalizeTextCase(zip: AdmZip): boolean {
  let changed = false;
  for (const entry of zip.getEntries()) {
    if (!WORD_XML.test(entry.entryName)) continue;
    const xml = entry.getData().toString('utf8');
    if (!ANY_CASE_FLAG.test(xml)) continue;
    const normalized = xml.replace(RUN_PROPERTIES, completeCaseFlags);
    if (normalized === xml) continue;
    zip.updateFile(entry, Buffer.from(normalized, 'utf8'));
    changed = true;
  }
  return changed;
}

function completeCaseFlags(runProperties: string): string {
  const flag = CASE_FLAG.exec(runProperties);
  if (!flag) return runProperties;
  const isCaps = flag[1] === 'caps';
  const opposite = `<w:${isCaps ? 'smallCaps' : 'caps'} w:val="false"/>`;
  // Already complete: the other flag is stated somewhere in this bag.
  if (runProperties.includes(`<w:${isCaps ? 'smallCaps' : 'caps'}`)) {
    return runProperties;
  }
  return runProperties.replace(
    flag[0],
    isCaps ? `${flag[0]}${opposite}` : `${opposite}${flag[0]}`
  );
}

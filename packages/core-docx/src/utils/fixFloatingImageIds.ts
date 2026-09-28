/**
 * Give every drawing in a docx.js package a deterministic, package-unique
 * `wp:docPr` id.
 *
 * docx 9.8.0 draws `wp:docPr` ids from one counter shared by every drawing in
 * the process (dolanmiu/docx#3521): unique, but the numbers depend on how many
 * drawings were created before this document, so the same document rendered
 * twice produces different bytes. Before 9.8.0 the ids were per instance and
 * every drawing outside `document.xml` carried `id="1"`.
 *
 * OOXML wants the id unique across the whole document, headers and notes
 * included, so this pass renumbers one sequence across every part that can
 * hold a drawing, in a fixed order: the body first, then headers and footers
 * by number, then footnotes, endnotes and comments. The body's ids are the
 * ones the pre-9.8.0 pass wrote, so a document without chrome drawings is
 * unchanged.
 */

import AdmZip from 'adm-zip';
import { readFile, writeFile } from 'fs/promises';

export const DRAWING_PART =
  /^word\/(document|header|footer|footnotes|endnotes|comments)(\d*)\.xml$/;
const RANK = [
  'document',
  'header',
  'footer',
  'footnotes',
  'endnotes',
  'comments',
];

/** The order ids are allocated in: body, headers, footers, notes, comments. */
export function compareDrawingParts(a: string, b: string): number {
  const ma = DRAWING_PART.exec(a)!;
  const mb = DRAWING_PART.exec(b)!;
  const rank = RANK.indexOf(ma[1]) - RANK.indexOf(mb[1]);
  return rank !== 0 ? rank : Number(ma[2] || 0) - Number(mb[2] || 0);
}

/** Renumber every `wp:docPr` id in the package, one sequence across parts. */
export function fixFloatingImageIdsInBuffer(buffer: Buffer): Buffer {
  const zip = new AdmZip(buffer);
  if (!zip.getEntry('word/document.xml')) {
    throw new Error('document.xml not found in DOCX');
  }

  // Hold the entries themselves (`filter` copies the list): rewriting one
  // while walking the rest is safe, and no lookup by name can miss a part.
  const parts = zip
    .getEntries()
    .filter((entry) => DRAWING_PART.test(entry.entryName))
    .sort((a, b) => compareDrawingParts(a.entryName, b.entryName));

  let idCounter = 1;
  for (const entry of parts) {
    const xml = entry.getData().toString('utf8');
    // `id` is not guaranteed to be the first attribute on wp:docPr: match it
    // wherever it sits so a library-side reordering cannot turn this into a
    // no-op.
    const renumbered = xml.replace(
      /(<wp:docPr\b[^>]*?\s)id="\d+"/g,
      (_match, prefix: string) => `${prefix}id="${idCounter++}"`
    );
    // Unconditionally, even when no id moved: an entry adm-zip rewrites is
    // deflated again by zlib, one it leaves alone keeps docx's JSZip stream.
    // Rewriting only the parts whose ids changed would make the package bytes
    // depend on the process-wide counter even though every part is identical.
    zip.updateFile(entry, Buffer.from(renumbered, 'utf8'));
  }
  return zip.toBuffer();
}

/**
 * Fix floating image issues in a generated DOCX file
 * @param docxPath - Path to the DOCX file to fix
 */
export async function fixFloatingImageIds(docxPath: string): Promise<void> {
  const buffer = await readFile(docxPath);
  await writeFile(docxPath, fixFloatingImageIdsInBuffer(buffer));
}

/**
 * Post-processing utility to fix docx.js floating image bugs
 *
 * The docx library (as of v9.7.1) has a known issue with floating images:
 * 1. Duplicate wp:docPr IDs (GitHub issue #2719)
 *
 * Historical note: We previously also post-processed relativeHeight and
 * wrapTight elements. Those steps were removed because we always provide a
 * valid zIndex upstream and we do not support 'tight' wrapping.
 *
 * This utility extracts the DOCX, fixes duplicate IDs, and re-packages it.
 */

import AdmZip from 'adm-zip';
import { readFile, writeFile } from 'fs/promises';

/** Fix duplicate floating-image IDs without touching the filesystem. */
export function fixFloatingImageIdsInBuffer(buffer: Buffer): Buffer {
  const zip = new AdmZip(buffer);
  const documentEntry = zip.getEntry('word/document.xml');

  if (!documentEntry) {
    throw new Error('document.xml not found in DOCX');
  }

  let idCounter = 1;
  // `id` is not guaranteed to be the first attribute on wp:docPr: OOXML does
  // not fix attribute order and docx does not promise to preserve it. Match it
  // wherever it sits so a library-side reordering cannot silently turn this
  // pass into a no-op (which would leave every floating image on id="1" and
  // make Word prompt for repair).
  const documentXml = documentEntry
    .getData()
    .toString('utf8')
    .replace(/(<wp:docPr\b[^>]*?\s)id="\d+"/g, (_match, prefix: string) => {
      const newId = idCounter++;
      return `${prefix}id="${newId}"`;
    });

  zip.updateFile(documentEntry, Buffer.from(documentXml, 'utf8'));
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

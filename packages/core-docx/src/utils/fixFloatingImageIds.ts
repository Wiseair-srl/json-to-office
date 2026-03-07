/**
 * Post-processing utility to fix docx.js floating image bugs
 *
 * The docx library (as of v9.5.1) has a known issue with floating images:
 * 1. Duplicate wp:docPr IDs (GitHub issue #2719)
 *
 * Historical note: We previously also post-processed relativeHeight and
 * wrapTight elements. Those steps were removed because we always provide a
 * valid zIndex upstream and we do not support 'tight' wrapping.
 *
 * This utility extracts the DOCX, fixes duplicate IDs, and re-packages it.
 */

import AdmZip from 'adm-zip';

/**
 * Fix floating image issues in a generated DOCX file
 * @param docxPath - Path to the DOCX file to fix
 */
export async function fixFloatingImageIds(docxPath: string): Promise<void> {
  try {
    // Read the DOCX file as a ZIP
    const zip = new AdmZip(docxPath);

    // Get the document.xml entry
    const documentEntry = zip.getEntry('word/document.xml');
    if (!documentEntry) {
      throw new Error('document.xml not found in DOCX');
    }

    // Extract and parse the XML
    let documentXml = documentEntry.getData().toString('utf8');

    // Fix 1: Duplicate wp:docPr IDs
    // Pattern: <wp:docPr id="N" ...> where N is the ID
    let idCounter = 1;
    documentXml = documentXml.replace(
      /<wp:docPr\s+id="(\d+)"/g,
      (_match: string) => {
        const newId = idCounter++;
        return `<wp:docPr id="${newId}"`;
      }
    );

    // Note: No other post-processing is applied.

    // Update the document.xml in the ZIP
    zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));

    // Write the fixed DOCX back
    zip.writeZip(docxPath);

    console.log(
      `Fixed ${idCounter - 1} duplicate floating image docPr IDs in ${docxPath}`
    );
  } catch (error) {
    console.error('Failed to fix floating image issues:', error);
    throw error;
  }
}

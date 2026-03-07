/**
 * Normalize text to NFC so composed accented characters are preserved
 * consistently across DOCX renderers (including LibreOffice).
 */
export function normalizeUnicodeText(text: string | null | undefined): string {
  return (text ?? '').normalize('NFC');
}

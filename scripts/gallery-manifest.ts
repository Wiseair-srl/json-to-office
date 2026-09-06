import { readFileSync } from 'node:fs';

/** Only partial regeneration needs prior entries; full regeneration repairs them. */
export function readPreviousGallery<T>(
  filename: string,
  partial: boolean
): T[] {
  if (!partial) return [];
  try {
    const parsed = JSON.parse(readFileSync(filename, 'utf8'));
    return Array.isArray(parsed?.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
}

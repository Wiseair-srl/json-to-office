/**
 * Plausible content for a scaffold marker, so a test can fill a whole fill
 * map without knowing the blueprint: numbers stay numbers, sources read as
 * sources, dates as dates, and everything else takes the guidance's own words.
 */

import type { BlueprintFillEntry } from '@json-to-office/shared';

export function contentFor(entry: BlueprintFillEntry): string {
  if (/^\d/.test(entry.guidance)) return '4.2';
  if (entry.guidance.startsWith('Source')) return 'Source: operating review.';
  if (entry.guidance.startsWith('Month')) return 'September 2026';
  return entry.guidance.replace(/^[^:]*:\s*/, '').split(',')[0];
}

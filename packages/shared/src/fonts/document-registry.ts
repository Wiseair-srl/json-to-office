/**
 * Read the document-scoped and theme-scoped font registries and merge them
 * with runtime `fonts.extraEntries`.
 *
 * Precedence (last wins, matching registry.ts's documented resolution rules
 * and FontRuntimeOpts.extraEntries's "merged over the document's
 * fontRegistry"):
 *
 *   theme.fontRegistry  <  document.props.fontRegistry  <  fonts.extraEntries
 *
 * Merging happens here rather than inside FontRegistry because
 * `validateFontReferences` needs the same merged list, and two merge sites
 * would eventually disagree — which would show up as a font that validates
 * but never renders, or vice versa.
 */

import type { FontRegistryEntry } from '../schemas/font-catalog';

function isEntry(v: unknown): v is FontRegistryEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.family === 'string' &&
    Array.isArray(e.sources)
  );
}

function readAt(node: unknown, key: string): FontRegistryEntry[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw.filter(isEntry) : [];
}

/** `document.props.fontRegistry`, defensively (props may be absent/null). */
export function documentFontRegistry(document: unknown): FontRegistryEntry[] {
  if (!document || typeof document !== 'object') return [];
  return readAt((document as Record<string, unknown>).props, 'fontRegistry');
}

/** `theme.fontRegistry`, defensively. */
export function themeFontRegistry(theme: unknown): FontRegistryEntry[] {
  return readAt(theme, 'fontRegistry');
}

/**
 * Merge entry groups in precedence order — later groups win on a collision of
 * `family` OR `id`, case-insensitively, which are the same two keys
 * `FontRegistry.addEntry` indexes on. Returns a flat list safe to hand to both
 * `validateFontReferences` and `new FontRegistry({ opts: { extraEntries } })`.
 */
export function mergeFontRegistries(
  ...groups: (FontRegistryEntry[] | undefined)[]
): FontRegistryEntry[] {
  const byKey = new Map<string, FontRegistryEntry>();
  for (const group of groups) {
    for (const e of group ?? []) {
      byKey.set(e.family.toLowerCase(), e);
      byKey.set(e.id.toLowerCase(), e);
    }
  }
  // One entry occupies two keys (family + id); de-dupe by identity so the
  // caller sees each registration once.
  const out: FontRegistryEntry[] = [];
  const seen = new Set<FontRegistryEntry>();
  for (const e of byKey.values()) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

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
  // Order IS the contract: `FontRegistry` replays this array through
  // `addEntry`, indexing on family and id with last-write-wins, so an entry
  // only outranks another by sitting later. Concatenating the groups in
  // precedence order is therefore the whole mechanism.
  //
  // Deliberately NOT de-duped through a Map keyed by family/id: `Map.set` on
  // an existing key keeps the original insertion *position*, so a
  // higher-precedence entry colliding with an earlier one would be emitted
  // early and then lose the replay to the entry it was supposed to beat.
  const out: FontRegistryEntry[] = [];
  for (const group of groups) {
    for (const entry of group ?? []) {
      const family = entry.family.toLowerCase();
      const id = entry.id.toLowerCase();
      // Drop only a true replacement — same family AND same id. An entry that
      // shares just one of the two still owns the other key in FontRegistry's
      // index, so removing it here would make that name unresolvable.
      for (let i = out.length - 1; i >= 0; i--) {
        if (
          out[i].family.toLowerCase() === family &&
          out[i].id.toLowerCase() === id
        ) {
          out.splice(i, 1);
        }
      }
      out.push(entry);
    }
  }
  return out;
}

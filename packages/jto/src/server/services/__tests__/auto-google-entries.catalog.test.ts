import { describe, it, expect } from 'vitest';
import { autoGoogleFontEntries } from '../generator';

/**
 * Catalog-coverage cases for the families added alongside the stock-template
 * font fix. Kept in their own file so the original behavioural suite in
 * auto-google-entries.test.ts stays focused on the skip/safe-font rules.
 */
describe('autoGoogleFontEntries — newly catalogued families', () => {
  it('builds a Space Grotesk entry narrowed to the referenced weights', () => {
    // This is the exact path that makes the data-report deck render Medium:
    // the wanted set is {400, ...referenced} intersected with the catalog
    // weights. Space Grotesk advertises 500, so 500 survives the intersection.
    const entries = autoGoogleFontEntries(
      new Set(['Space Grotesk']),
      new Set(),
      new Set([500])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].family).toBe('Space Grotesk');
    expect(entries[0].sources).toEqual([
      {
        kind: 'google',
        family: 'Space Grotesk',
        weights: [400, 500],
        italics: false,
      },
    ]);
  });

  it('does NOT match a synthesized sub-family name', () => {
    // "Space Grotesk Medium" is what synthesizeFamilyName PRODUCES at render
    // time. Authored as input it matches no catalog family, so no entry is
    // built and every reference dies as FONT_UNRESOLVED — the bug this change
    // removed from the bundled templates.
    expect(
      autoGoogleFontEntries(new Set(['Space Grotesk Medium']), new Set())
    ).toEqual([]);
    expect(autoGoogleFontEntries(new Set(['Geist Light']), new Set())).toEqual(
      []
    );
    expect(
      autoGoogleFontEntries(new Set(['DM Sans Medium']), new Set())
    ).toEqual([]);
  });

  it('builds entries for Geist, Geist Mono and Archivo', () => {
    for (const family of ['Geist', 'Geist Mono', 'Archivo']) {
      const entries = autoGoogleFontEntries(new Set([family]), new Set());
      expect(entries, family).toHaveLength(1);
      expect(entries[0].family, family).toBe(family);
    }
  });
});

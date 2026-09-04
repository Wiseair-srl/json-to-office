/**
 * Everything the theme schema accepts has to survive being loaded.
 *
 * `ensureThemeDefaults` used to rebuild the theme from a hand-written literal
 * of ten root keys, so anything else the schema allows was deleted between
 * validation and the renderer. That is the worst shape a bug can take here:
 * the file validates, generation succeeds, and the design is simply absent —
 * no error, no warning, nothing to search for. `fontRegistry` and
 * `noProofWords` were being lost that way in every bundled theme and every
 * `--theme-path` render.
 *
 * So this walks the schema rather than listing keys. A property added to
 * `ThemeConfigSchema` and forgotten in `ensureThemeDefaults` fails here on the
 * day it is added, which is the only moment the fix is cheap.
 */

import { describe, expect, it } from 'vitest';
import { ThemeConfigSchema } from '@json-to-office/shared-docx';
import type { ThemeConfigJson } from '@json-to-office/shared-docx';
import { ensureThemeDefaults } from '../defaults';

/** A theme that exercises every root property the schema declares. */
const COMPLETE: ThemeConfigJson = {
  $schema: './theme.schema.json',
  name: 'round-trip',
  displayName: 'Round Trip',
  description: 'Every root key the schema allows.',
  version: '1.0.0',
  colors: {
    primary: '#2B302B',
    secondary: '#4A5B4E',
    accent: '#6E7F71',
    text: '#3B3C38',
    background: '#FFFFFF',
    border: '#D8D3C8',
    textPrimary: '#3B3C38',
    textSecondary: '#5B5B54',
    textMuted: '#75726A',
    borderPrimary: '#D8D3C8',
    borderSecondary: '#E9E6DE',
    backgroundPrimary: '#FFFFFF',
    backgroundSecondary: '#F1EFE9',
    accent4: '#231F20',
    accent5: '#C9CFC7',
    accent6: '#B5AC9D',
  },
  fonts: {
    heading: { family: 'Calibri', size: 21 },
    body: { family: 'Calibri', size: 10 },
    mono: { family: 'Courier New', size: 10 },
    light: { family: 'Calibri', size: 21 },
  },
  fontRegistry: [
    {
      id: 'inter',
      family: 'Inter',
      sources: [{ kind: 'google', family: 'Inter' }],
    },
  ],
  page: {
    size: 'A4',
    margins: {
      top: 720,
      bottom: 720,
      left: 720,
      right: 720,
      header: 360,
      footer: 360,
      gutter: 0,
    },
  },
  styles: { normal: { fontSize: 10 } },
  componentDefaults: { heading: { level: 2 } },
  noProofWords: ['Wiseair'],
};

const rootKeys = Object.keys(
  (ThemeConfigSchema as unknown as { properties: Record<string, unknown> })
    .properties
);

describe('ensureThemeDefaults keeps what the schema allows', () => {
  it('is exercising every root property the schema declares', () => {
    // The fixture is only a round-trip check if it actually carries every key.
    expect(Object.keys(COMPLETE).sort()).toEqual([...rootKeys].sort());
  });

  it.each(rootKeys)('keeps `%s`', (key) => {
    const result = ensureThemeDefaults(COMPLETE) as Record<string, unknown>;
    expect(result).toHaveProperty(key);
    expect(result[key]).toEqual((COMPLETE as Record<string, unknown>)[key]);
  });

  it('keeps a root key it has never heard of', () => {
    // The regression in its general form: the next layer added to the theme
    // must not need this function edited to survive.
    const result = ensureThemeDefaults({
      ...COMPLETE,
      typography: { roles: { eyebrow: { size: 8 } } },
    } as ThemeConfigJson) as Record<string, unknown>;
    expect(result.typography).toEqual({ roles: { eyebrow: { size: 8 } } });
  });

  it('keeps a font role it has never heard of', () => {
    // `fonts` is rebuilt role by role, so it drops unknown roles the same way
    // the root used to. Four roles exist today; a fifth is exactly what the
    // extended theme schema would add.
    const result = ensureThemeDefaults({
      ...COMPLETE,
      fonts: { ...COMPLETE.fonts, display: { family: 'Inter', size: 40 } },
    } as ThemeConfigJson);
    expect((result.fonts as Record<string, unknown>).display).toEqual({
      family: 'Inter',
      size: 40,
    });
  });

  it('still fills in every default for a bare theme', () => {
    // The reason the function exists, unchanged: a partial theme comes back
    // complete rather than merely intact.
    const result = ensureThemeDefaults({ name: 'bare' });
    expect(result.name).toBe('bare');
    expect(result.displayName).toBe('Default Theme');
    expect(result.colors.primary).toBeTruthy();
    expect(result.fonts.heading.family).toBeTruthy();
    expect(result.page.margins.top).toBeGreaterThan(0);
  });

  it('lets the theme win over the defaults it backfills', () => {
    const result = ensureThemeDefaults({
      name: 'override',
      colors: { primary: '#123456' } as ThemeConfigJson['colors'],
      page: { size: 'LETTER' } as ThemeConfigJson['page'],
    });
    expect(result.colors.primary).toBe('#123456');
    expect(result.page.size).toBe('LETTER');
    // …while the keys it did not state are still filled in.
    expect(result.colors.text).toBeTruthy();
    expect(result.page.margins.top).toBeGreaterThan(0);
  });
});

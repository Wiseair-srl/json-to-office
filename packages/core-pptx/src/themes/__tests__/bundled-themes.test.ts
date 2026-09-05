/**
 * Every built-in PPTX theme must satisfy the theme schema.
 *
 * The DOCX twin (`core-docx/src/themes/__tests__/bundled-themes.test.ts`)
 * exists because themes once shipped with dead `componentDefaults.table`
 * properties that no renderer read and the validator rejects. PPTX had no
 * equivalent guard at all, and it is the format that needs one more: its
 * themes are TypeScript object literals rather than JSON files, so nothing
 * ever runs them past `ThemeConfigSchema` — `tsc` checks them against the
 * hand-written `PptxThemeConfig` interface, which is a different thing and
 * has drifted from the schema before.
 *
 * The timing matters. `ir/compiler.ts` reads `ctx.theme.defaults.fontSize`
 * unguarded, so a theme the schema would have rejected surfaces as a
 * TypeError deep in the compiler rather than as a diagnostic naming the
 * field. That is survivable while three hand-written themes are the whole
 * set; it stops being survivable the moment the extended schema lands and
 * themes grow type ladders, spacing scales and chrome recipes (#328).
 */

import { describe, expect, it } from 'vitest';
import { validatePptxTheme } from '@json-to-office/shared-pptx';
import {
  DEFAULT_PPTX_THEME,
  getPptxTheme,
  hasPptxTheme,
  pptxThemes,
} from '../defaults';

function errorsFor(theme: unknown): string[] {
  const result = validatePptxTheme(theme);
  return result.valid
    ? []
    : result.errors.map((error) => `${error.path}: ${error.message}`);
}

const names = Object.keys(pptxThemes).sort();

describe('built-in pptx themes', () => {
  it('registers the themes the docs and the schema enum promise', () => {
    expect(names).toEqual(['dark', 'default', 'minimal']);
  });

  it.each(names)('%s validates against the theme schema', (name) => {
    expect(errorsFor(pptxThemes[name])).toEqual([]);
  });

  it.each(names)('%s survives the round trip through JSON', (name) => {
    // What reaches a `--theme-path` consumer is parsed JSON, not the literal:
    // `undefined` members vanish on the way, which is exactly how an optional
    // property that is secretly required goes unnoticed.
    expect(errorsFor(JSON.parse(JSON.stringify(pptxThemes[name])))).toEqual([]);
  });

  it('names each theme the same way it is registered', () => {
    // `getPptxTheme` falls back to the default on a miss, so a theme whose
    // `name` disagrees with its key is a lookup that silently returns
    // something else wearing the wrong label.
    for (const name of names) {
      expect(pptxThemes[name].name).toBe(name);
    }
  });
});

describe('the theme lookup', () => {
  it.each(names)(
    'getPptxTheme(%s) returns the theme registered for it',
    (name) => {
      // Identity, not just validity: a lookup that returned the default theme
      // for every name would satisfy the schema and break the contract.
      const theme = getPptxTheme(name);
      expect(theme).toBe(pptxThemes[name]);
      expect(errorsFor(theme)).toEqual([]);
    }
  );

  it('falls back to the default theme, and says so separately', () => {
    // The fallback is deliberate and documented; `hasPptxTheme` is the only
    // way a caller can tell a real built-in from a name that missed.
    expect(getPptxTheme('no-such-theme')).toBe(DEFAULT_PPTX_THEME);
    expect(hasPptxTheme('no-such-theme')).toBe(false);
    expect(hasPptxTheme('minimal')).toBe(true);
  });
});

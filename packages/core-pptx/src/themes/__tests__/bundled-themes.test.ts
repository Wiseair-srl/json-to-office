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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSafeFont } from '@json-to-office/shared';
import {
  BUILT_IN_PPTX_THEME_NAMES,
  PresentationPropsSchema,
  validatePptxTheme,
} from '@json-to-office/shared-pptx';
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

/**
 * The `examples` of the string branch of `props.theme` — what the editor
 * offers when the caller types `"theme": ""`.
 */
function schemaThemeExamples(): string[] {
  const theme = (PresentationPropsSchema as any).properties.theme;
  const stringBranch = theme.anyOf.find((b: any) => b.type === 'string');
  return [...stringBranch.examples].sort();
}

describe('built-in pptx themes', () => {
  it('registers exactly the themes the schema names', () => {
    expect(names).toEqual([...BUILT_IN_PPTX_THEME_NAMES].sort());
  });

  /**
   * This assertion is the point of the list existing in one place. The
   * predecessor of this test hardcoded its own second copy of the names and
   * called itself a check on "the schema enum", which is how `vermilion` and
   * `devportal` reached the registry, and the renderer, while the schema went
   * on offering only the four names it was born with — the editor completed
   * `"theme": ""` to a set that had been wrong since they landed.
   */
  it('offers every registered theme for completion', () => {
    expect(schemaThemeExamples()).toEqual(names);
  });

  it('names the built-ins in its own description', () => {
    const theme = (PresentationPropsSchema as any).properties.theme;
    const stringBranch = theme.anyOf.find((b: any) => b.type === 'string');
    for (const name of names) {
      expect(stringBranch.description).toContain(name);
    }
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

describe.each(['consulting', 'vermilion', 'devportal'])(
  'the %s twin',
  (name) => {
    // The DOCX theme is the source of the tokens; the deck must not drift from
    // the report it accompanies. Read the JSON rather than importing core-docx,
    // so this package keeps no dependency on the other core.
    const docx = JSON.parse(
      readFileSync(
        new URL(
          `../../../../core-docx/src/templates/themes/${name}.docx.theme.json`,
          import.meta.url
        ),
        'utf8'
      )
    );
    const pptx = pptxThemes[name];

    it('shares palette roles, chart series, chrome recipes and motif with the report theme', () => {
      expect(pptx.palette).toEqual(docx.palette);
      // One deliberate substitution: the recipes that paint small projected
      // text use the darker grey so a 9pt run clears the contrast rule.
      const projected = JSON.parse(
        JSON.stringify(pptx.chrome).replace(
          /"color":"text2"/g,
          '"color":"textMuted"'
        )
      );
      expect(projected).toEqual(docx.chrome);
      expect(pptx.motif).toEqual(docx.motif);
    });

    it('shares ink, greys, accent and chart slots', () => {
      expect(pptx.colors.primary).toBe(docx.colors.primary);
      expect(pptx.colors.secondary).toBe(docx.colors.secondary);
      expect(pptx.colors.accent).toBe(docx.colors.accent);
      expect(pptx.colors.text).toBe(docx.colors.textPrimary);
      expect(pptx.colors.text2).toBe(docx.colors.textSecondary);
      expect(pptx.colors.background2).toBe(docx.colors.backgroundSecondary);
      for (const slot of ['accent4', 'accent5', 'accent6'] as const) {
        expect(pptx.colors[slot]).toBe(docx.colors[slot]);
      }
    });

    it('names only safe fonts, the same families as the report', () => {
      expect(pptx.fonts).toEqual({
        heading: docx.fonts.heading.family,
        body: docx.fonts.body.family,
        mono: docx.fonts.mono.family,
      });
      for (const family of Object.values(pptx.fonts)) {
        expect(isSafeFont(family as string)).toBe(true);
      }
      expect(pptx.fontRegistry).toBeUndefined();
    });

    it('declares every type role the report declares', () => {
      expect(Object.keys(pptx.typography?.roles ?? {}).sort()).toEqual(
        Object.keys(docx.typography.roles).sort()
      );
    });

    it('is a twin in name and in the layers the design guide reads', () => {
      expect(pptx.name).toBe(docx.name);
      expect(pptx.displayName).toBe(docx.displayName);
      expect(`${pptx.description} ${pptx.whenToUse}`).toContain('twin');
      for (const layer of ['typography', 'spacing', 'chrome', 'motif'] as const)
        expect(pptx[layer], layer).toBeDefined();
    });
  }
);

/**
 * The Word theme the compiler hands the backends: which jto token each scheme
 * slot holds, the heading and body faces, the name, and what happens to a slot
 * whose token does not resolve.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { consultingTheme } from '../../templates/themes';
import type { ReportComponentDefinition } from '../../types';
import { compileTheme, THEME_COLOR_TOKENS } from '../theme';
import type { DocxIR, DocxIrTheme } from '../types';
import { validateDocxIr } from '../validation';

async function compile(props: Record<string, unknown>): Promise<DocxIR> {
  const compiled = await compileDocumentToIr(
    {
      name: 'docx',
      props,
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    } as unknown as ReportComponentDefinition,
    { warnings: [] }
  );
  return compiled.ir;
}

async function themeOf(props: Record<string, unknown>): Promise<DocxIrTheme> {
  const ir = await compile(props);
  if (!ir.theme) throw new Error('the compiler set no theme');
  return ir.theme;
}

describe('compiled Word theme', () => {
  it('maps consulting slot by slot, and leaves the link colours alone', async () => {
    expect(await themeOf({ theme: 'consulting' })).toEqual({
      name: 'consulting',
      colors: {
        dark1: { hex: '1A1F26' },
        light1: { hex: 'FFFFFF' },
        dark2: { hex: '4B5563' },
        light2: { hex: 'F2F4F7' },
        accent1: { hex: '1A1F26' },
        accent2: { hex: '4B5563' },
        accent3: { hex: '1B4F8A' },
        accent4: { hex: '5B8DC9' },
        accent5: { hex: 'A9C4E4' },
        accent6: { hex: '7B8794' },
      },
      headingFont: 'Arial',
      bodyFont: 'Calibri',
    });
  }, 60_000);

  it('follows themeOverrides', async () => {
    const theme = await themeOf({
      theme: 'consulting',
      themeOverrides: {
        colors: { accent: '#FF0000' },
        fonts: { heading: { family: 'Georgia' } },
      },
    });
    expect(theme.colors.accent3).toEqual({ hex: 'FF0000' });
    expect(theme.headingFont).toBe('Georgia');
    expect(theme.name).toBe('consulting');
  }, 60_000);

  it('names the theme the document fell back to', async () => {
    expect((await themeOf({ theme: 'nope' })).name).toBe('consulting');
  }, 60_000);
});

describe('compileTheme', () => {
  const consulting = () => structuredClone(consultingTheme);

  it('omits a slot whose token is unset or does not resolve', () => {
    const theme = consulting();
    delete (theme.colors as Record<string, unknown>).accent4;
    (theme.colors as Record<string, unknown>).accent5 = 'nonsense';
    const compiled = compileTheme(theme, 'consulting');
    expect(compiled.colors).not.toHaveProperty('accent4');
    expect(compiled.colors).not.toHaveProperty('accent5');
    expect(compiled.colors.accent6).toEqual({ hex: '7B8794' });
  }, 60_000);

  it('follows a token that names another token', () => {
    const theme = consulting();
    (theme.colors as Record<string, unknown>).accent6 = 'primary';
    expect(compileTheme(theme, 'consulting').colors.accent6).toEqual({
      hex: '1A1F26',
    });
  }, 60_000);

  it('drops characters XML cannot carry from the name', () => {
    const theme = consulting();
    theme.name = 'a\u0001b';
    expect(compileTheme(theme, 'consulting').name).toBe('ab');
  }, 60_000);

  it('falls back to the requested name when the theme has none', () => {
    const theme = consulting();
    theme.name = '';
    expect(compileTheme(theme, 'requested').name).toBe('requested');
  }, 60_000);
});

/**
 * The twin deck's pairing, copied by hand from `SCHEME_SLOTS` in
 * `core-pptx/src/renderers/office-open/index.ts` (module-private). An
 * independent oracle, not an import: if either side changes its pairing, this
 * fails.
 */
const PPTX_SCHEME_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ['dark1', 'text'],
  ['light1', 'background'],
  ['dark2', 'text2'],
  ['light2', 'background2'],
  ['accent1', 'primary'],
  ['accent2', 'secondary'],
  ['accent3', 'accent'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
];

describe.each(['consulting', 'vermilion', 'devportal'])(
  'twin of the %s deck',
  (name) => {
    it('offers the same scheme colours and fonts', async () => {
      const pptx = JSON.parse(
        readFileSync(
          new URL(
            `../../../../core-pptx/src/themes/${name}.pptx.theme.json`,
            import.meta.url
          ),
          'utf8'
        )
      ) as {
        colors: Record<string, string>;
        fonts: { heading: string; body: string };
      };
      const theme = await themeOf({ theme: name });

      expect(THEME_COLOR_TOKENS.map(([slot]) => slot)).toEqual(
        PPTX_SCHEME_SLOTS.map(([slot]) => slot)
      );
      for (const [slot, token] of PPTX_SCHEME_SLOTS) {
        expect(
          theme.colors[slot as keyof DocxIrTheme['colors']]?.hex,
          slot
        ).toBe(pptx.colors[token].replace('#', '').toUpperCase());
      }
      expect(theme.headingFont).toBe(pptx.fonts.heading);
      expect(theme.bodyFont).toBe(pptx.fonts.body);
    }, 60_000);
  }
);

describe.each(['consulting', 'minimal', 'devportal', 'vermilion'])(
  'the %s theme',
  (name) => {
    it('compiles to an IR that validates', async () => {
      const ir = await compile({ theme: name });
      expect(ir.theme?.name).toBe(name);
      expect(validateDocxIr(ir)).toEqual([]);
    }, 60_000);
  }
);

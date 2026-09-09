/**
 * The two alternate themes on the shared visual layers (#330).
 *
 * `vermilion` and `devportal` carry what `consulting` carried alone — palette
 * roles, type roles and a scale, spacing and a safe area, chrome recipes, a
 * motif — so a report scaffolded on either paints its own chrome. What
 * matters is observable from outside: safe fonts only, every role resolving
 * to a size on the theme's own scale, the safe area written into the margins,
 * a plain document as warning-clean as on `minimal`, and no chrome of the
 * theme's own. Schema validity is `bundled-themes.test.ts`; rendered bytes are
 * the corpus goldens `theme/builtin-vermilion` and `theme/builtin-devportal`.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  collectFontNamesFromDocx,
  isSafeFont,
  resolveTypeRoles,
  TYPE_ROLES,
} from '@json-to-office/shared';
import { CASES as THEME_CASES } from '../../__tests__/fixtures/corpus-theme';
import { generateBufferFromJson } from '../../core/generator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { getTheme } from '../../templates/themes';
import { resolveDocxDesignSystem } from '../design-system';

function sampler(theme: string): Record<string, unknown> {
  const base = THEME_CASES.find(
    (entry) => entry.name === 'theme/builtin-minimal'
  )!.document as { props: Record<string, unknown> };
  return structuredClone({ ...base, props: { ...base.props, theme } });
}

const starter = (theme: string) => ({
  name: 'docx',
  props: { theme, metadata: { title: 'Quarterly report', author: 'Author' } },
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { text: 'Summary', level: 1 } },
        {
          name: 'paragraph',
          props: { text: 'One paragraph of context before the numbers.' },
        },
        {
          name: 'statistic',
          props: { number: '42', unit: '%', description: 'Growth' },
        },
        {
          name: 'table',
          props: {
            columns: [
              { header: { content: 'Region' }, cells: [{ content: 'North' }] },
              {
                header: { content: 'Revenue (€m)' },
                cells: [{ content: '4.2' }],
              },
            ],
          },
        },
      ],
    },
  ],
});

const EXPECTED = {
  vermilion: {
    accent: 'EF4130',
    safeArea: 0.8,
    base: 10.5,
    display: { color: 'accent' },
  },
  devportal: {
    accent: 'E35B3F',
    safeArea: 0.75,
    base: 9.5,
    display: { color: 'primary', tracking: -2 },
  },
} as const;

describe.each(['vermilion', 'devportal'] as const)(
  'the %s theme on the shared layers',
  (name) => {
    const theme = getTheme(name)!;
    const expected = EXPECTED[name];

    it('names safe fonts only and registers none', () => {
      const families = [...collectFontNamesFromDocx(theme)];
      expect(families.length).toBeGreaterThan(0);
      expect(families.filter((family) => !isSafeFont(family))).toEqual([]);
      expect(theme.fontRegistry).toBeUndefined();
    });

    it('declares every layer consulting declares, every type role, and a chart series from its own accent', () => {
      for (const layer of [
        'palette',
        'typography',
        'spacing',
        'chrome',
        'motif',
      ] as const)
        expect(theme[layer], layer).toBeDefined();
      expect(Object.keys(theme.typography!.roles!).sort()).toEqual(
        [...TYPE_ROLES].sort()
      );
      expect(theme.palette!.chart![0]).toBe('accent');
      expect(theme.typography!.scale!.a4!.base).toBe(expected.base);
      expect(theme.typography!.roles!.display).toMatchObject(expected.display);
      expect(theme.chrome!.cover!.rule!.color).toBe('accent');
      expect(theme.motif).toMatchObject({ kind: 'rule', color: 'accent' });
    });

    it('resolves every type role to a size on its own scale, and the safe area into the margins', () => {
      const roles = resolveTypeRoles(theme, 'a4', expected.base);
      for (const role of TYPE_ROLES)
        expect(roles[role]?.size, role).toBeGreaterThanOrEqual(8);
      expect(roles.display!.size).toBeGreaterThan(roles.stat!.size / 1.5);
      expect(roles.source!.size).toBe(8);
      const resolved = resolveDocxDesignSystem(theme);
      expect(resolved.styles).toMatchObject({
        display: { fontWeight: 700, font: 'heading' },
        stat: { fontWeight: 700, color: 'accent' },
        chartLabel: { size: 9, fontWeight: 400 },
        source: { size: 8, color: 'textMuted' },
        tracker: { size: 8, case: 'upper' },
        tableCell: { size: 9.5 },
      });
      const margin = expected.safeArea * 1440;
      expect(resolved.page.margins).toMatchObject({
        top: margin,
        bottom: margin,
        left: margin,
        right: margin,
      });
    });

    it('keeps a plain document exactly as warning-clean as minimal does', () => {
      const codes = (on: string) =>
        analyzeDocxQuality(sampler(on))
          .diagnostics.map((entry) => entry.code)
          .sort();
      expect(codes(name)).toEqual(codes('minimal'));
      expect(analyzeDocxQuality(starter(name)).counts).toEqual({
        error: 0,
        warning: 0,
        info: 0,
      });
    });

    it('renders the starter in its own type and accent and adds no chrome', async () => {
      const buffer = await generateBufferFromJson(starter(name) as never);
      const zip = await JSZip.loadAsync(buffer);
      expect(
        Object.keys(zip.files).some((file) =>
          /word\/(header|footer)\d/.test(file)
        )
      ).toBe(false);
      const styles = await zip.file('word/styles.xml')!.async('string');
      expect(styles).toContain(theme.fonts.body.family);
      expect(styles).toContain(expected.accent);
    });
  }
);

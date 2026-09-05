import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Value } from '@sinclair/typebox/value';
import {
  ThemeConfigSchema,
  ThemeOverridesSchema,
} from '@json-to-office/shared-docx';
import { generateBufferFromJson } from '../core/generator';
import { createDocumentGenerator } from '../plugin/createDocumentGenerator';
import { vermilionTheme } from '../templates/themes';
import { applyThemeOverrides } from '../themes/overrides';
import { resolveDocxDesignSystem } from '../themes/design-system';
import { prepareDocxQualityDocument } from '../quality/facts';

export const foundation = {
  palette: {
    rule: '#123456',
    textMuted: 'rule',
    positive: '#337755',
    chart: ['positive', 'rule'],
  },
  typography: {
    roles: {
      display: {
        face: 'heading' as const,
        weight: 300,
        case: 'upper' as const,
        color: 'textMuted',
        lineHeight: 1.5,
        tracking: 2,
      },
      source: { size: 9, case: 'smallCaps' as const },
    },
    scale: { a4: { base: 12, ratio: 1.25, baselinePt: 4 } },
  },
  spacing: { canvas: { a4: { safeAreaIn: 0.5, gutterIn: 0.1 } } },
  chrome: { actionTitle: { type: 'display' as const } },
  motif: { kind: 'rule' as const, color: 'rule' },
};
const document = {
  name: 'docx',
  props: { theme: 'vermilion', themeOverrides: foundation },
  children: [
    {
      name: 'section',
      children: [
        {
          name: 'paragraph',
          props: { text: 'Mixed Case', themeStyle: 'display' },
        },
        {
          name: 'paragraph',
          props: { text: 'A source', themeStyle: 'source' },
        },
        {
          name: 'paragraph',
          props: {
            text: 'Explicit',
            themeStyle: 'display',
            font: { size: 14, case: 'none', color: '#ABCDEF', fontWeight: 900 },
          },
        },
      ],
    },
  ],
};

describe('DOCX theme foundation', () => {
  it('exposes the extended palette to quality checks', () => {
    const prepared = prepareDocxQualityDocument(document as never);
    const fact = prepared.facts.find((entry) => entry.kind === 'docx/theme');
    expect(fact).toMatchObject({
      paletteHexes: { rule: '#123456', positive: '#337755' },
    });
  });

  it('applies the ordered palette to native charts', async () => {
    const input = {
      name: 'docx',
      renderer: 'office-open',
      props: document.props,
      children: [
        {
          name: 'chart',
          props: {
            type: 'bar',
            data: [
              { name: 'Revenue', labels: ['Q1'], values: [10] },
              { name: 'Cost', labels: ['Q1'], values: [5] },
            ],
          },
        },
      ],
    };
    const zip = await JSZip.loadAsync(
      await generateBufferFromJson(input as never)
    );
    const charts = await Promise.all(
      Object.keys(zip.files)
        .filter((path) => /word\/charts\/chart\d+\.xml$/.test(path))
        .map((path) => zip.file(path)!.async('string'))
    );
    expect(charts).toHaveLength(1);
    expect(charts[0]).toContain('337755');
    expect(charts[0]).toContain('123456');
  });
  it('validates on both theme and override surfaces; preserves values', () => {
    const theme = applyThemeOverrides(vermilionTheme, foundation);
    expect(Value.Check(ThemeOverridesSchema, foundation)).toBe(true);
    expect(Value.Check(ThemeConfigSchema, theme)).toBe(true);
    const merged = applyThemeOverrides(theme, {
      palette: { chart: ['rule'] },
      typography: { roles: { display: { size: 32 } } },
    });
    expect(merged.palette).toEqual({ ...foundation.palette, chart: ['rule'] });
    expect(merged.typography?.roles?.display).toEqual({
      ...foundation.typography.roles.display,
      size: 32,
    });
    expect(theme.typography?.roles?.display).not.toHaveProperty('size');
    expect(resolveDocxDesignSystem(theme).styles?.display).toMatchObject({
      size: 28,
      fontWeight: 300,
      case: 'upper',
    });
  });

  for (const renderer of ['docxjs', 'office-open'] as const) {
    it(`renders roles, spacing and explicit overrides through both ${renderer} pipelines`, async () => {
      const input = { ...document, renderer };
      const core = await generateBufferFromJson(
        structuredClone(input) as never
      );
      const plugin = await createDocumentGenerator({}).generateBuffer(
        structuredClone(input) as never
      );
      const a = await JSZip.loadAsync(core);
      const b = await JSZip.loadAsync(plugin.buffer);
      for (const part of ['word/document.xml', 'word/styles.xml'])
        expect(await b.file(part)!.async('string')).toBe(
          await a.file(part)!.async('string')
        );
      const styles = await a.file('word/styles.xml')!.async('string');
      const display = styles.match(
        /<w:style\b[^>]*w:styleId="display"[\s\S]*?<\/w:style>/
      )?.[0];
      expect(display).toContain('w:sz w:val="56"');
      expect(display).toContain('Light');
      expect(display).toContain('123456');
      expect(display).toContain('w:caps');
      expect(styles).toContain('w:smallCaps');
      const xml = await a.file('word/document.xml')!.async('string');
      expect(xml).toContain('w:pStyle w:val="display"');
      expect(xml).toContain('w:left="720"');
      expect(xml).toContain('w:sz w:val="28"');
      expect(xml).toContain('ABCDEF');
      const explicit = [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].find(
        ([run]) => run.includes('Explicit')
      )?.[0];
      expect(explicit).toContain('<w:caps w:val="false"/>');
      expect(explicit).toMatch(/<w:smallCaps w:val="(?:false|0)"\/>/);
      expect(explicit).toContain('Arial Black');
      expect(
        Object.keys(a.files).some((name) =>
          /word\/(header|footer)\d/.test(name)
        )
      ).toBe(false);
    });
  }
});

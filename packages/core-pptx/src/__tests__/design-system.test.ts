import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Value } from '@sinclair/typebox/value';
import { ThemeConfigSchema } from '@json-to-office/shared-pptx';
import { generateBufferFromJson } from '../core/generator';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';
import { DEFAULT_PPTX_THEME } from '../themes';
import { designGrid, resolvePptxDesignSystem } from '../themes/design-system';
import { definedChartColorTokens, resolveColor } from '../utils/color';
import { preparePptxQualityDocument } from '../quality/facts';

const theme = {
  ...DEFAULT_PPTX_THEME,
  palette: {
    rule: '#123456',
    positive: '#337755',
    chart: ['positive', 'rule'],
  },
  typography: {
    roles: {
      display: {
        face: 'heading' as const,
        weight: 300,
        case: 'upper' as const,
        color: 'rule',
      },
      source: { size: 10, case: 'smallCaps' as const },
    },
    scale: {
      wide169: { base: 16, ratio: 1.25, baselinePt: 4 },
      standard43: { base: 12 },
    },
  },
  spacing: {
    canvas: {
      wide169: { safeAreaIn: 0.5, gutterIn: 0.2, columns: 6, rows: 4 },
    },
  },
  chrome: { actionTitle: { type: 'display' as const } },
  motif: { kind: 'rule' as const },
};

describe('PPTX theme foundation', () => {
  it('exposes extended colors as legal component literals to quality fixes', () => {
    const prepared = preparePptxQualityDocument({
      name: 'pptx',
      props: { theme },
      children: [],
    } as never);
    const fact = prepared.facts.find((entry) => entry.kind === 'pptx/theme');
    expect(fact).toMatchObject({
      paletteHexes: { '#123456': '#123456', '#337755': '#337755' },
    });
  });
  it('validates inline values and derives font/grid/chart defaults', () => {
    expect(Value.Check(ThemeConfigSchema, theme)).toBe(true);
    expect(resolvePptxDesignSystem(theme, 16, 9).styles?.display).toMatchObject(
      { fontSize: 40, fontColor: '123456', fontWeight: 300 }
    );
    expect(designGrid(theme, 16, 9)).toEqual({
      margin: 0.5,
      gutter: 0.2,
      columns: 6,
      rows: 4,
    });
    expect(
      definedChartColorTokens(theme).map((color) => resolveColor(color, theme))
    ).toEqual(['337755', '123456']);
    expect(theme.styles).not.toHaveProperty('display');
  });

  for (const renderer of ['pptxgenjs', 'office-open'] as const) {
    it(`renders roles through both ${renderer} pipelines without required chrome`, async () => {
      const input = {
        name: 'pptx',
        renderer,
        props: { theme, slideWidth: 16, slideHeight: 9 },
        children: [
          {
            name: 'slide',
            children: [
              {
                name: 'text',
                props: {
                  text: 'Mixed Case',
                  style: 'display',
                  x: 1,
                  y: 1,
                  w: 8,
                  h: 1,
                },
              },
              {
                name: 'text',
                props: {
                  text: 'A source',
                  style: 'source',
                  x: 1,
                  y: 3,
                  w: 8,
                  h: 1,
                },
              },
              {
                name: 'text',
                props: {
                  text: 'Explicit',
                  style: 'display',
                  fontSize: 14,
                  color: '#ABCDEF',
                  x: 1,
                  y: 5,
                  w: 8,
                  h: 1,
                },
              },
            ],
          },
        ],
      };
      const core = await generateBufferFromJson(
        structuredClone(input) as never
      );
      const plugin = await createPresentationGenerator({}).generateBuffer(
        structuredClone(input) as never
      );
      const a = await JSZip.loadAsync(core as Buffer);
      const b = await JSZip.loadAsync(plugin.buffer);
      const xml = await a.file('ppt/slides/slide1.xml')!.async('string');
      expect(await b.file('ppt/slides/slide1.xml')!.async('string')).toBe(xml);
      expect(xml).toContain('MIXED CASE');
      expect(xml).toContain('sz="4000"');
      expect(xml).toContain('123456');
      expect(xml).toContain('Light');
      expect(xml).toContain('sz="1400"');
      expect(xml).toContain('ABCDEF');
      expect(xml).toContain('sz="800"');
      expect((xml.match(/<p:sp>/g) ?? []).length).toBe(3);
    });
  }
});

/**
 * The PPTX twin of `componentDefaults.highcharts`: slide placement and
 * resources as partial props, the theme's Highcharts `options` from the
 * shared schema.
 */
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { ThemeConfigSchema } from '../schemas/theme';
import { validate } from '../validation/unified';

function theme(highcharts: unknown) {
  return {
    name: 'presets',
    colors: {
      primary: '#1D2130',
      secondary: '#383F5D',
      accent: '#586CC9',
      background: '#FFFFFF',
      text: '#1D2130',
    },
    fonts: { heading: 'Arial', body: 'Arial' },
    defaults: { fontSize: 18, fontColor: '#1D2130' },
    componentDefaults: { highcharts },
  };
}

function deck(highcharts: unknown) {
  return {
    name: 'pptx',
    props: { componentDefaults: { highcharts } },
    children: [{ name: 'slide', children: [] }],
  };
}

describe('componentDefaults.highcharts in a pptx theme', () => {
  it('accepts placement defaults next to options', () => {
    expect(
      Value.Check(
        ThemeConfigSchema,
        theme({
          w: '80%',
          scale: 2,
          options: {
            chart: { backgroundColor: 'transparent' },
            plotOptions: { bar: { borderWidth: 0 } },
          },
        })
      )
    ).toBe(true);
  });

  it('accepts the same block on the presentation', () => {
    expect(
      validate.document(deck({ options: { legend: { align: 'left' } } })).valid
    ).toBe(true);
  });

  it('still takes resources, as it did before', () => {
    expect(
      Value.Check(
        ThemeConfigSchema,
        theme({ resources: { css: '@font-face { font-family: Inter; }' } })
      )
    ).toBe(true);
  });

  it('takes any option without judging the content', () => {
    expect(
      Value.Check(
        ThemeConfigSchema,
        theme({ options: { chart: { events: { render: 'any string' } } } })
      )
    ).toBe(true);
  });

  it('no longer demands chart.width and height of the theme options', () => {
    expect(
      Value.Check(
        ThemeConfigSchema,
        theme({ options: { legend: { align: 'left' } } })
      )
    ).toBe(true);
  });

  it('refuses a key it does not know', () => {
    expect(Value.Check(ThemeConfigSchema, theme({ option: {} }))).toBe(false);
    expect(Value.Check(ThemeConfigSchema, theme({ byType: {} }))).toBe(false);
    expect(validate.document(deck({ callbacks: {} })).valid).toBe(false);
  });
});

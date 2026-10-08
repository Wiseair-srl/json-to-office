/**
 * `componentDefaults.highcharts`: the theme's Highcharts options.
 *
 * `options` is an open record, like the component's own `options`: the
 * library does not judge what a theme puts there. The block refuses keys it
 * does not know, so a typo does not pass as a default.
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';
import { createMinimalTheme } from '../schemas/theme';

const DEFAULTS = {
  options: {
    chart: { backgroundColor: 'transparent' },
    legend: { align: 'left' },
    plotOptions: {
      bar: { borderWidth: 0, pointPadding: 0.06 },
      pie: { dataLabels: { format: '{point.percentage:.1f}%' } },
    },
  },
};

function theme(highcharts: unknown) {
  return {
    ...createMinimalTheme('presets'),
    componentDefaults: { highcharts },
  };
}

function document(highcharts: unknown): string {
  return JSON.stringify({
    name: 'docx',
    props: { theme: 'minimal', componentDefaults: { highcharts } },
    children: [{ name: 'paragraph', props: { text: 'Body.' } }],
  });
}

describe('componentDefaults.highcharts in a theme', () => {
  it('accepts options', () => {
    expect(validate.theme(theme(DEFAULTS)).valid).toBe(true);
  });

  it('accepts the same block on the document, where it merges over the theme', () => {
    expect(validate.jsonDocument(document(DEFAULTS)).valid).toBe(true);
  });

  it('is still optional: a theme without it validates as before', () => {
    expect(validate.theme(createMinimalTheme('plain')).valid).toBe(true);
  });

  it('takes any Highcharts option without judging the content', () => {
    expect(
      validate.theme(
        theme({
          options: {
            chart: { events: { render: 'any string the theme wrote' } },
            tooltip: { formatter: '(p) => p.y' },
          },
        })
      ).valid
    ).toBe(true);
  });

  it('refuses a key it does not know', () => {
    expect(validate.theme(theme({ option: {} })).valid).toBe(false);
    expect(validate.theme(theme({ byType: {} })).valid).toBe(false);
    expect(validate.jsonDocument(document({ option: {} })).valid).toBe(false);
  });
});

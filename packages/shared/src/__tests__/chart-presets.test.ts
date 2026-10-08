import { describe, expect, it } from 'vitest';
import { withChartPresets } from '../theme/chart-presets';

const CHART = { chart: { width: 600, height: 400 } };

describe('withChartPresets', () => {
  it("writes the theme's options beneath the chart's, never replacing a value", () => {
    const options = withChartPresets(
      {
        ...CHART,
        chart: { ...CHART.chart, type: 'bar' },
        legend: { align: 'right' },
        yAxis: { visible: true },
      },
      {
        options: {
          legend: { align: 'left', verticalAlign: 'top' },
          yAxis: { visible: false, gridLineWidth: 0 },
          plotOptions: { bar: { borderWidth: 0 } },
          credits: { text: 'Theme' },
        },
      }
    );
    // The author's value is kept at every level it set.
    expect(options.legend).toEqual({ align: 'right', verticalAlign: 'top' });
    expect(options.yAxis).toEqual({ visible: true, gridLineWidth: 0 });
    expect(options.plotOptions).toEqual({ bar: { borderWidth: 0 } });
    expect(options.credits).toEqual({ text: 'Theme' });
  });

  it('keeps an authored array and scalar, as the typography fill does', () => {
    const options = withChartPresets(
      { ...CHART, colors: ['#111111'], legend: false },
      { options: { colors: ['#999999'], legend: { align: 'left' } } }
    );
    expect(options.colors).toEqual(['#111111']);
    expect(options.legend).toBe(false);
  });

  it('posts any string the theme put in options as it is', () => {
    const options = withChartPresets(
      { ...CHART },
      { options: { tooltip: { formatter: 'whatever the theme wrote' } } }
    );
    expect(options.tooltip).toEqual({ formatter: 'whatever the theme wrote' });
  });

  it('returns the same options object when the theme states no options', () => {
    const options = { ...CHART, series: [] };
    expect(withChartPresets(options, undefined)).toBe(options);
    expect(withChartPresets(options, {})).toBe(options);
  });
});

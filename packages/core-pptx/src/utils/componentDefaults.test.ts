import { describe, expect, it } from 'vitest';
import type { PptxThemeConfig } from '../types';
import { resolveHighchartsProps } from './componentDefaults';

const theme = {
  name: 'presets',
  componentDefaults: {
    highcharts: {
      w: '80%',
      scale: 2,
      options: { legend: { align: 'left' } },
    },
  },
} as unknown as PptxThemeConfig;

describe('resolveHighchartsProps', () => {
  it('merges the placement defaults and leaves options to the expansion', () => {
    const props = resolveHighchartsProps(
      { options: { chart: { width: 600, height: 400 } }, scale: 1 },
      theme
    );
    // The theme's options are written beneath the chart's own by
    // `expandHighcharts`; they must not land on the component as if they were
    // a prop.
    expect(props).toEqual({
      options: { chart: { width: 600, height: 400 } },
      scale: 1,
      w: '80%',
    });
  });
});

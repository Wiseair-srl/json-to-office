/**
 * The theme's Highcharts options, written into a chart's request.
 *
 * `componentDefaults.highcharts.options` (see `schemas/highcharts-defaults.ts`)
 * is the theme-level equivalent of `Highcharts.setOptions`. This module
 * writes it beneath a chart's own options, in both formats, with the one rule
 * the palette and the typography already follow — an authored value is never
 * replaced. Per series type, a theme uses `plotOptions.<type>` inside
 * `options`, as Highcharts itself does. What the theme puts there is posted
 * as it is; the library does not judge the content.
 */

import { fillChartOptions } from './chart-typography';

type Options = Record<string, unknown>;

/** What a theme's `componentDefaults.highcharts` carries, as the cores read it. */
export interface HighchartsThemePresets {
  options?: Options;
}

/**
 * The theme's `options` written beneath the chart's own options. Without
 * `options` the chart's options come back as they were, the same object.
 */
export function withChartPresets<T extends Options>(
  options: T,
  presets: HighchartsThemePresets | undefined
): T {
  if (!presets?.options) return options;
  return fillChartOptions(options, presets.options);
}

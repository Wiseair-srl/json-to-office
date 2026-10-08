/**
 * `componentDefaults.highcharts`: the theme's Highcharts options.
 *
 * A theme already paints a chart's palette and type (see `chart-palette.ts`
 * and `chart-typography.ts`); `options` is the rest of its form — the
 * options an author would otherwise repeat on every `highcharts` node. It is
 * the theme-level equivalent of `Highcharts.setOptions`: written beneath
 * every chart's own options, key by key, where an authored value always
 * wins. Per series type, use `plotOptions.<type>` inside it, as Highcharts
 * itself does.
 *
 * `options` is an open record, exactly like the `options` of the
 * `highcharts` component: any Highcharts option goes, and the library does
 * not judge the content. Format-neutral: the DOCX and PPTX theme schemas
 * embed it as it is.
 */

import { Type, type Static } from '@sinclair/typebox';

export const HighchartsThemeDefaultsSchema = Type.Object(
  {
    options: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          'Highcharts options written beneath every chart’s own options, key by key, as `Highcharts.setOptions` would; an authored value always wins. Any Highcharts option goes; per series type, use `plotOptions.<type>`.',
      })
    ),
  },
  {
    additionalProperties: false,
    description:
      'The theme’s Highcharts options, the equivalent of `Highcharts.setOptions`: `options` is written beneath every chart’s own options; the chart’s own values win.',
  }
);

export type HighchartsThemeDefaults = Static<
  typeof HighchartsThemeDefaultsSchema
>;

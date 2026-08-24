/**
 * Chart Component Schema (DOCX) — a native Word chart, drawn by `office-open`.
 *
 * The sibling of the pptx `chart` component, and deliberately spelled the same
 * way: `type`, `data`, `title`, `showLegend`, `chartColors` carry identical
 * names and shapes here, so an author who has charted a slide can chart a
 * document without relearning the vocabulary. What differs is placement, and
 * only placement — a slide chart is positioned with `x`/`y`/`w`/`h`, a document
 * chart flows, so it takes the `width`/`height`/`alignment`/`caption` props
 * `image` and `highcharts` already use. The slide coordinates are refused
 * rather than ignored, because a chart that silently lands somewhere other than
 * where it was told to is worse than one that fails.
 *
 * Distinct from `highcharts`, which is a PNG from an export server. This is a
 * real chart part: editable, vector, and reachable without a service.
 */

import { Type, Static } from '@sinclair/typebox';
import {
  AlignmentSchema,
  SpacingSchema,
  FloatingPropertiesSchema,
} from './common';

/**
 * The chart types v1 draws.
 *
 * `@office-open/core` reaches twelve; these are the ones the pptx `chart`
 * component also offers, so the two formats agree, plus `column` — which
 * PowerPoint spells as a bar with a vertical direction and Word spells as its
 * own type. `stock`, `surface`, `ofPie` and the 3-D variants are left out until
 * there is a counterpart to be consistent with.
 *
 * `bubble` is left out for a harder reason: `@office-open` spells a bubble
 * series as `xValues`/`yValues`/`bubbleSize` rather than categories and values,
 * and handing it the latter throws a TypeError from inside its own bundle.
 * There is also no unambiguous reading of a category label as a numeric x. The
 * pptx component refuses it by name for the same reason; here the type simply
 * does not exist, because `office-open` is the only renderer that draws a docx
 * chart at all.
 */
const ChartTypeSchema = Type.Union(
  [
    Type.Literal('area'),
    Type.Literal('bar'),
    Type.Literal('column'),
    Type.Literal('doughnut'),
    Type.Literal('line'),
    Type.Literal('pie'),
    Type.Literal('radar'),
    Type.Literal('scatter'),
  ],
  { description: 'Chart type' }
);

/**
 * One series.
 *
 * `labels` and `values` are needed on EVERY series, not just the first, and the
 * same rule and wording as the pptx component: a series missing either drops
 * the whole chart. They stay schema-optional because the compiler owns that
 * refusal and names the series that caused it.
 */
const ChartDataSeriesSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ description: 'Series name' })),
    labels: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Category labels. Needed on every series, not just the first, and the same length as `values`; a series without both `labels` and `values` drops the whole chart.',
      })
    ),
    values: Type.Optional(
      Type.Array(Type.Number(), {
        description:
          'Data values, one per label. Needed on every series — see `labels`.',
      })
    ),
  },
  { additionalProperties: false }
);

export const ChartPropsSchema = Type.Object(
  {
    type: ChartTypeSchema,
    data: Type.Array(ChartDataSeriesSchema, {
      description: 'Chart data series',
      minItems: 1,
    }),

    // Title
    title: Type.Optional(Type.String({ description: 'Chart title text' })),
    showTitle: Type.Optional(
      Type.Boolean({
        description:
          'Show the chart title. Defaults to true when `title` is set.',
      })
    ),

    // Legend
    showLegend: Type.Optional(
      Type.Boolean({ description: 'Show chart legend' })
    ),
    legendPos: Type.Optional(
      Type.Union(
        [
          Type.Literal('b'),
          Type.Literal('l'),
          Type.Literal('r'),
          Type.Literal('t'),
          Type.Literal('tr'),
        ],
        { description: 'Legend position' }
      )
    ),

    // Series colors
    chartColors: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Series colors (hex or semantic theme names). Defaults to the theme palette.',
      })
    ),

    // Axis titles
    catAxisTitle: Type.Optional(
      Type.String({ description: 'Category axis title' })
    ),
    valAxisTitle: Type.Optional(
      Type.String({ description: 'Value axis title' })
    ),

    // Flow placement — the same vocabulary as `image` and `highcharts`.
    width: Type.Optional(
      Type.Number({
        minimum: 0,
        exclusiveMinimum: 0,
        description: 'Chart width in inches. Defaults to the content width.',
      })
    ),
    height: Type.Optional(
      Type.Number({
        minimum: 0,
        exclusiveMinimum: 0,
        description: 'Chart height in inches. Defaults to 3.',
      })
    ),
    alignment: Type.Optional(AlignmentSchema),
    caption: Type.Optional(
      Type.String({
        description:
          'Chart caption (supports rich text with **bold**, *italic*, ***both***)',
      })
    ),
    alt: Type.Optional(
      Type.String({ description: 'Alternative text for accessibility' })
    ),
    spacing: Type.Optional(SpacingSchema),
    floating: Type.Optional(FloatingPropertiesSchema),
    keepNext: Type.Optional(
      Type.Boolean({
        description: 'Keep paragraph with next paragraph on same page',
      })
    ),
    keepLines: Type.Optional(
      Type.Boolean({
        description: 'Keep all lines of paragraph together on same page',
      })
    ),
  },
  {
    description:
      'Native Word chart - editable, scalable, no export server needed. Requires renderer "office-open".',
    additionalProperties: false,
  }
);

export type ChartProps = Static<typeof ChartPropsSchema>;

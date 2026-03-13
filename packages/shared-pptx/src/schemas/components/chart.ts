/**
 * Chart Component Schema (PPTX) — native PowerPoint charts via pptxgenjs
 */

import { Type, Static } from '@sinclair/typebox';
import { GridPositionSchema } from './common';

const PositionValue = Type.Union([
  Type.Number(),
  Type.String({ pattern: '^\\d+(\\.\\d+)?%$' }),
]);

const ChartTypeSchema = Type.Union(
  [
    Type.Literal('area'),
    Type.Literal('bar'),
    Type.Literal('bar3D'),
    Type.Literal('bubble'),
    Type.Literal('doughnut'),
    Type.Literal('line'),
    Type.Literal('pie'),
    Type.Literal('radar'),
    Type.Literal('scatter'),
  ],
  { description: 'Chart type' }
);

const ChartDataSeriesSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ description: 'Series name' })),
    labels: Type.Optional(Type.Array(Type.String(), { description: 'Category labels' })),
    values: Type.Optional(Type.Array(Type.Number(), { description: 'Data values' })),
    sizes: Type.Optional(Type.Array(Type.Number(), { description: 'Bubble sizes (bubble charts only)' })),
  },
  { additionalProperties: false }
);

export const PptxChartPropsSchema = Type.Object(
  {
    type: ChartTypeSchema,
    data: Type.Array(ChartDataSeriesSchema, {
      description: 'Chart data series',
      minItems: 1,
    }),

    // Display toggles
    showLegend: Type.Optional(Type.Boolean({ description: 'Show chart legend' })),
    showTitle: Type.Optional(Type.Boolean({ description: 'Show chart title' })),
    showValue: Type.Optional(Type.Boolean({ description: 'Show data values' })),
    showPercent: Type.Optional(Type.Boolean({ description: 'Show percentages (pie/doughnut)' })),
    showLabel: Type.Optional(Type.Boolean({ description: 'Show category labels on data points' })),
    showSerName: Type.Optional(Type.Boolean({ description: 'Show series name on data points' })),

    // Title
    title: Type.Optional(Type.String({ description: 'Chart title text' })),
    titleFontSize: Type.Optional(Type.Number({ description: 'Title font size (points)' })),
    titleColor: Type.Optional(Type.String({ description: 'Title color (hex or semantic)' })),
    titleFontFace: Type.Optional(Type.String({ description: 'Title font face' })),

    // Chart colors
    chartColors: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Series colors (hex or semantic theme names). Defaults to theme palette.',
      })
    ),

    // Legend
    legendPos: Type.Optional(
      Type.Union(
        [Type.Literal('b'), Type.Literal('l'), Type.Literal('r'), Type.Literal('t'), Type.Literal('tr')],
        { description: 'Legend position' }
      )
    ),
    legendFontSize: Type.Optional(Type.Number({ description: 'Legend font size' })),
    legendFontFace: Type.Optional(Type.String({ description: 'Legend font face' })),
    legendColor: Type.Optional(Type.String({ description: 'Legend text color' })),

    // Category axis
    catAxisTitle: Type.Optional(Type.String({ description: 'Category axis title' })),
    catAxisHidden: Type.Optional(Type.Boolean({ description: 'Hide category axis' })),
    catAxisLabelRotate: Type.Optional(Type.Number({ description: 'Category axis label rotation (degrees)' })),
    catAxisLabelFontSize: Type.Optional(Type.Number({ description: 'Category axis label font size' })),
    catAxisLabelColor: Type.Optional(Type.String({ description: 'Category axis label color (hex or semantic)' })),

    // Value axis
    valAxisTitle: Type.Optional(Type.String({ description: 'Value axis title' })),
    valAxisHidden: Type.Optional(Type.Boolean({ description: 'Hide value axis' })),
    valAxisMinVal: Type.Optional(Type.Number({ description: 'Value axis minimum' })),
    valAxisMaxVal: Type.Optional(Type.Number({ description: 'Value axis maximum' })),
    valAxisLabelFormatCode: Type.Optional(Type.String({ description: 'Value axis label format (e.g. "$0.00", "#%")' })),
    valAxisMajorUnit: Type.Optional(Type.Number({ description: 'Value axis major unit / tick interval' })),
    valAxisLabelColor: Type.Optional(Type.String({ description: 'Value axis label color (hex or semantic)' })),

    // Bar-specific
    barDir: Type.Optional(
      Type.Union([Type.Literal('bar'), Type.Literal('col')], {
        description: 'Bar direction: "bar" (horizontal) or "col" (vertical, default)',
      })
    ),
    barGrouping: Type.Optional(
      Type.Union(
        [Type.Literal('clustered'), Type.Literal('stacked'), Type.Literal('percentStacked')],
        { description: 'Bar grouping style' }
      )
    ),
    barGapWidthPct: Type.Optional(
      Type.Number({ minimum: 0, maximum: 500, description: 'Bar gap width (0-500%)' })
    ),

    // Line-specific
    lineSmooth: Type.Optional(Type.Boolean({ description: 'Smooth lines' })),
    lineDataSymbol: Type.Optional(
      Type.Union(
        [
          Type.Literal('circle'),
          Type.Literal('dash'),
          Type.Literal('diamond'),
          Type.Literal('dot'),
          Type.Literal('none'),
          Type.Literal('square'),
          Type.Literal('triangle'),
        ],
        { description: 'Line data point marker symbol' }
      )
    ),
    lineSize: Type.Optional(Type.Number({ description: 'Line width (points)' })),

    // Pie/doughnut-specific
    firstSliceAng: Type.Optional(Type.Number({ minimum: 0, maximum: 359, description: 'Angle of first slice (degrees)' })),
    holeSize: Type.Optional(Type.Number({ minimum: 10, maximum: 90, description: 'Doughnut hole size (%)' })),

    // Radar-specific
    radarStyle: Type.Optional(
      Type.Union(
        [Type.Literal('standard'), Type.Literal('marker'), Type.Literal('filled')],
        { description: 'Radar chart style' }
      )
    ),

    // Data labels
    dataLabelColor: Type.Optional(Type.String({ description: 'Data label text color' })),
    dataLabelFontSize: Type.Optional(Type.Number({ description: 'Data label font size' })),
    dataLabelFontFace: Type.Optional(Type.String({ description: 'Data label font face' })),
    dataLabelFontBold: Type.Optional(Type.Boolean({ description: 'Bold data labels' })),
    dataLabelPosition: Type.Optional(
      Type.Union(
        [
          Type.Literal('b'),
          Type.Literal('bestFit'),
          Type.Literal('ctr'),
          Type.Literal('l'),
          Type.Literal('r'),
          Type.Literal('t'),
          Type.Literal('inEnd'),
          Type.Literal('outEnd'),
        ],
        { description: 'Data label position' }
      )
    ),

    // Positioning
    x: Type.Optional(PositionValue),
    y: Type.Optional(PositionValue),
    w: Type.Optional(PositionValue),
    h: Type.Optional(PositionValue),
    grid: Type.Optional(GridPositionSchema),
  },
  {
    description: 'Native PowerPoint chart component props',
    additionalProperties: false,
  }
);

export type PptxChartProps = Static<typeof PptxChartPropsSchema>;

/**
 * Chart Component Schema (PPTX) — native PowerPoint charts via pptxgenjs
 */

import { Type, Static } from '@sinclair/typebox';
import { GridPositionSchema } from './common';

/**
 * A position or size, in inches or as a percentage of the slide.
 *
 * Described per axis, exactly as `text`, `image`, `shape` and `table` describe
 * theirs: a bare number with no unit leaves an agent guessing between inches,
 * points and EMU on the one component it reaches for to chart a quarter.
 */
const positionValue = (inches: string, percent: string) =>
  Type.Union([
    Type.Number({ description: inches }),
    Type.String({
      pattern: '^\\d+(\\.\\d+)?%$',
      description: percent,
    }),
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

/**
 * One series.
 *
 * `labels` and `values` are needed on EVERY series, not just the first: the
 * compiler drops the whole chart the moment one series is missing either. They
 * stay schema-optional only because the compiler still owns that refusal and
 * warns about it by name; the descriptions say so, because "optional" alone
 * left an agent to discover it from a rendered file with no chart in it.
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
    sizes: Type.Optional(
      Type.Array(Type.Number(), {
        description: 'Bubble sizes (bubble charts only)',
      })
    ),
  },
  { additionalProperties: false }
);

const ChartGridLineSchema = Type.Object(
  {
    style: Type.Optional(
      Type.Union(
        [
          Type.Literal('solid'),
          Type.Literal('dash'),
          Type.Literal('dot'),
          Type.Literal('none'),
        ],
        { description: 'Grid line style' }
      )
    ),
    size: Type.Optional(
      Type.Number({ minimum: 0, description: 'Grid line width (points)' })
    ),
    color: Type.Optional(
      Type.String({ description: 'Grid line color (hex or semantic)' })
    ),
  },
  { additionalProperties: false, description: 'Axis grid line styling' }
);

export const PptxChartPropsSchema = Type.Object(
  {
    type: ChartTypeSchema,
    data: Type.Array(ChartDataSeriesSchema, {
      description: 'Chart data series',
      minItems: 1,
    }),

    // Display toggles
    showLegend: Type.Optional(
      Type.Boolean({ description: 'Show chart legend' })
    ),
    showTitle: Type.Optional(Type.Boolean({ description: 'Show chart title' })),
    showValue: Type.Optional(Type.Boolean({ description: 'Show data values' })),
    showPercent: Type.Optional(
      Type.Boolean({ description: 'Show percentages (pie/doughnut)' })
    ),
    showLabel: Type.Optional(
      Type.Boolean({ description: 'Show category labels on data points' })
    ),
    showSerName: Type.Optional(
      Type.Boolean({ description: 'Show series name on data points' })
    ),

    // Title
    title: Type.Optional(Type.String({ description: 'Chart title text' })),
    titleFontSize: Type.Optional(
      Type.Number({ description: 'Title font size (points)' })
    ),
    titleColor: Type.Optional(
      Type.String({ description: 'Title color (hex or semantic)' })
    ),
    titleFontFace: Type.Optional(
      Type.String({ description: 'Title font face' })
    ),
    titleFontWeight: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 900,
        description:
          'Title weight (100–900). Rendered as a sub-family alias — see `dataLabelFontWeight`.',
      })
    ),

    // Chart colors
    chartColors: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Series colors (hex or semantic theme names). Defaults to theme palette.',
      })
    ),

    // Data element border (bars/slices/areas)
    dataBorder: Type.Optional(
      Type.Object(
        {
          pt: Type.Number({
            minimum: 0,
            description: 'Border width (points)',
          }),
          color: Type.String({
            description: 'Border color (hex or semantic)',
          }),
        },
        {
          additionalProperties: false,
          description: 'Outline on data elements (bars, slices, areas)',
        }
      )
    ),

    // Legend
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
    legendFontSize: Type.Optional(
      Type.Number({ description: 'Legend font size' })
    ),
    legendFontFace: Type.Optional(
      Type.String({ description: 'Legend font face' })
    ),
    legendFontWeight: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 900,
        description:
          'Legend weight (100–900). Rendered as a sub-family alias — see `dataLabelFontWeight`. PowerPoint gives the legend no bold toggle, so 400 and 700 both render Regular (700 warns).',
      })
    ),
    legendColor: Type.Optional(
      Type.String({ description: 'Legend text color' })
    ),

    // Category axis
    catAxisTitle: Type.Optional(
      Type.String({ description: 'Category axis title' })
    ),
    catAxisHidden: Type.Optional(
      Type.Boolean({ description: 'Hide category axis' })
    ),
    catAxisLabelRotate: Type.Optional(
      Type.Number({ description: 'Category axis label rotation (degrees)' })
    ),
    catAxisLabelFontSize: Type.Optional(
      Type.Number({ description: 'Category axis label font size' })
    ),
    catAxisLabelColor: Type.Optional(
      Type.String({
        description: 'Category axis label color (hex or semantic)',
      })
    ),
    catAxisLabelFontFace: Type.Optional(
      Type.String({ description: 'Category axis label font face' })
    ),
    catAxisLabelFontWeight: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 900,
        description:
          'Category axis label weight (100–900). Rendered as a sub-family alias — see `dataLabelFontWeight`.',
      })
    ),
    catGridLine: Type.Optional(ChartGridLineSchema),

    // Value axis
    valAxisTitle: Type.Optional(
      Type.String({ description: 'Value axis title' })
    ),
    valAxisHidden: Type.Optional(
      Type.Boolean({ description: 'Hide value axis' })
    ),
    valAxisMinVal: Type.Optional(
      Type.Number({ description: 'Value axis minimum' })
    ),
    valAxisMaxVal: Type.Optional(
      Type.Number({ description: 'Value axis maximum' })
    ),
    valAxisLabelFormatCode: Type.Optional(
      Type.String({
        description: 'Value axis label format (e.g. "$0.00", "#%")',
      })
    ),
    valAxisMajorUnit: Type.Optional(
      Type.Number({ description: 'Value axis major unit / tick interval' })
    ),
    valAxisLabelColor: Type.Optional(
      Type.String({ description: 'Value axis label color (hex or semantic)' })
    ),
    valAxisLabelFontFace: Type.Optional(
      Type.String({ description: 'Value axis label font face' })
    ),
    valAxisLabelFontWeight: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 900,
        description:
          'Value axis label weight (100–900). Rendered as a sub-family alias — see `dataLabelFontWeight`.',
      })
    ),
    valAxisLabelFontSize: Type.Optional(
      Type.Number({ description: 'Value axis label font size' })
    ),
    valGridLine: Type.Optional(ChartGridLineSchema),
    catAxisLineShow: Type.Optional(
      Type.Boolean({ description: 'Show the category axis line' })
    ),
    valAxisLineShow: Type.Optional(
      Type.Boolean({ description: 'Show the value axis line' })
    ),

    // Bar-specific
    barDir: Type.Optional(
      Type.Union([Type.Literal('bar'), Type.Literal('col')], {
        description:
          'Bar direction: "bar" (horizontal) or "col" (vertical, default)',
      })
    ),
    barGrouping: Type.Optional(
      Type.Union(
        [
          Type.Literal('clustered'),
          Type.Literal('stacked'),
          Type.Literal('percentStacked'),
        ],
        { description: 'Bar grouping style' }
      )
    ),
    barGapWidthPct: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 500,
        description: 'Bar gap width (0-500%)',
      })
    ),
    barOverlapPct: Type.Optional(
      Type.Number({
        minimum: -100,
        maximum: 100,
        description:
          'Overlap between series bars (-100 to 100%). 100 = fully overlapped, negative = gap.',
      })
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
    lineSize: Type.Optional(
      Type.Number({ description: 'Line width (points)' })
    ),
    lineDataSymbolSize: Type.Optional(
      Type.Number({
        minimum: 2,
        maximum: 72,
        description: 'Line data point marker size (points)',
      })
    ),

    // Pie/doughnut-specific
    firstSliceAng: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 359,
        description: 'Angle of first slice (degrees)',
      })
    ),
    holeSize: Type.Optional(
      Type.Number({
        minimum: 10,
        maximum: 90,
        description: 'Doughnut hole size (%)',
      })
    ),

    // Radar-specific
    radarStyle: Type.Optional(
      Type.Union(
        [
          Type.Literal('standard'),
          Type.Literal('marker'),
          Type.Literal('filled'),
        ],
        { description: 'Radar chart style' }
      )
    ),

    // Data labels
    dataLabelColor: Type.Optional(
      Type.String({ description: 'Data label text color' })
    ),
    dataLabelFontSize: Type.Optional(
      Type.Number({ description: 'Data label font size' })
    ),
    dataLabelFontFace: Type.Optional(
      Type.String({ description: 'Data label font face' })
    ),
    dataLabelFontWeight: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 900,
        description:
          'Data label weight (100–900); overrides `dataLabelFontBold`. PowerPoint chart labels carry no numeric weight, so a non-RIBBI weight renders by rewriting the font face to the matching sub-family ("Inter" at 300 → "Inter Light") — 400 and 700 stay on the family and use the bold toggle. Falls back to the theme body font when the sibling font face is unset.',
      })
    ),
    dataLabelFontBold: Type.Optional(
      Type.Boolean({ description: 'Bold data labels' })
    ),
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
    x: Type.Optional(positionValue('X position in inches', 'X as percentage')),
    y: Type.Optional(positionValue('Y position in inches', 'Y as percentage')),
    w: Type.Optional(positionValue('Width in inches', 'Width as percentage')),
    h: Type.Optional(positionValue('Height in inches', 'Height as percentage')),
    grid: Type.Optional(GridPositionSchema),
  },
  {
    description: 'Native PowerPoint chart component props',
    additionalProperties: false,
  }
);

export type PptxChartProps = Static<typeof PptxChartPropsSchema>;

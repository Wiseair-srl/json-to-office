/**
 * Highcharts Component Schema (PPTX)
 */

import { Type, Static } from '@sinclair/typebox';
import { GridPositionSchema } from './common';

export const PptxHighchartsPropsSchema = Type.Object(
  {
    options: Type.Intersect([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Object({
        chart: Type.Object({
          width: Type.Number(),
          height: Type.Number(),
        }),
      }),
    ]),
    scale: Type.Optional(Type.Number()),
    serverUrl: Type.Optional(
      Type.String({
        description:
          'Highcharts Export Server URL (default: http://localhost:7801)',
      })
    ),
    // Optional resources forwarded verbatim to the export server (CSS/JS/files).
    // Notably enables @font-face rules so charts render in custom fonts.
    resources: Type.Optional(
      Type.Object({
        css: Type.Optional(Type.String()),
        js: Type.Optional(Type.String()),
        files: Type.Optional(Type.Array(Type.String())),
      })
    ),
    x: Type.Optional(
      Type.Union([
        Type.Number({ description: 'X position in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'X as percentage',
        }),
      ])
    ),
    y: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Y position in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Y as percentage',
        }),
      ])
    ),
    w: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Width in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Width as percentage',
        }),
      ])
    ),
    h: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Height in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Height as percentage',
        }),
      ])
    ),
    grid: Type.Optional(GridPositionSchema),
  },
  {
    description: 'PPTX Highcharts component props',
    additionalProperties: false,
  }
);

export type PptxHighchartsProps = Static<typeof PptxHighchartsPropsSchema>;

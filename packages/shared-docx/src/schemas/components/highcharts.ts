/**
 * Highcharts Component Schema
 *
 * Standard module for rendering charts using Highcharts export server.
 */

import { Type, Static } from '@sinclair/typebox';

/**
 * Highcharts component props schema
 * Accepts options that will be passed to Highcharts export server
 */
export const HighchartsPropsSchema = Type.Object({
  // Highcharts chart options - can be anything but must at least have chart.width and chart.height
  options: Type.Intersect([
    Type.Record(Type.String(), Type.Unknown()),
    Type.Object({
      chart: Type.Object({
        width: Type.Number(),
        height: Type.Number(),
      }),
    }),
  ]),
  // Optional scale factor for export
  scale: Type.Optional(Type.Number()),
  // Optional Highcharts Export Server URL override
  serverUrl: Type.Optional(Type.String({ description: 'Highcharts Export Server URL (default: http://localhost:7801)' })),
  // Optional width for rendering (overrides chart width)
  width: Type.Optional(
    Type.Union(
      [
        Type.Number({
          minimum: 1,
          description: 'Image width in pixels',
        }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description:
            'Image width as percentage (e.g., "90%") relative to content width',
        }),
      ],
      {
        description:
          'Rendered image width in pixels (number) or as percentage string (e.g., "90%")',
      }
    )
  ),
  // Optional height for rendering (overrides chart height)
  height: Type.Optional(
    Type.Union(
      [
        Type.Number({
          minimum: 1,
          description: 'Image height in pixels',
        }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description:
            'Image height as percentage (e.g., "90%") relative to content height',
        }),
      ],
      {
        description:
          'Rendered image height in pixels (number) or as percentage string (e.g., "90%")',
      }
    )
  ),
});

export type HighchartsProps = Static<typeof HighchartsPropsSchema>;

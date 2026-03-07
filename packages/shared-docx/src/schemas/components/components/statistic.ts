/**
 * Statistic Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { AlignmentSchema, SpacingSchema } from './common';

export const StatisticPropsSchema = Type.Object(
  {
    number: Type.String({
      description: 'Statistic number/value (required)',
    }),
    description: Type.String({
      description: 'Statistic description (required)',
    }),
    unit: Type.Optional(
      Type.String({
        description: 'Unit of measurement',
      })
    ),
    format: Type.Optional(
      Type.String({
        description: 'Number format pattern',
      })
    ),
    trend: Type.Optional(
      Type.Union([
        Type.Literal('up'),
        Type.Literal('down'),
        Type.Literal('neutral'),
      ])
    ),
    trendValue: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    alignment: Type.Optional(AlignmentSchema),
    spacing: Type.Optional(SpacingSchema),
    size: Type.Optional(
      Type.Union([
        Type.Literal('small'),
        Type.Literal('medium'),
        Type.Literal('large'),
      ])
    ),
  },
  {
    description: 'Statistic component props',
    additionalProperties: false,
  }
);

export type StatisticProps = Static<typeof StatisticPropsSchema>;

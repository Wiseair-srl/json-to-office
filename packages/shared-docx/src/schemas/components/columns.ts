/**
 * Columns Component Schema
 */

import { Type, Static } from '@sinclair/typebox';

// Single column descriptor
const ColumnDescriptorSchema = Type.Object(
  {
    width: Type.Optional(
      Type.Union([
        Type.Number({
          minimum: 1,
          description: 'Column width in points',
        }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description:
            'Column width as percentage of available width (e.g., "30%")',
        }),
        Type.Literal('auto', {
          description:
            'Auto width: consume remaining space after fixed widths and gaps',
        }),
      ])
    ),
    gap: Type.Optional(
      Type.Union([
        Type.Number({
          minimum: 0,
          description: 'Gap after this column in points',
        }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description:
            'Gap after this column as percentage of available width (e.g., "5%")',
        }),
      ])
    ),
  },
  { additionalProperties: false }
);

export const ColumnsPropsSchema = Type.Object(
  {
    columns: Type.Union([
      Type.Number({
        minimum: 1,
        description:
          'Number of equal-width columns (converter will normalize to array)',
      }),
      Type.Array(ColumnDescriptorSchema, {
        minItems: 1,
        description:
          'List of columns in order; width and gap can be points, percentages, or auto width',
      }),
    ]),
    gap: Type.Optional(
      Type.Union([
        Type.Number({
          minimum: 0,
          description:
            'Default gap applied after each column except the last (points)',
        }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description:
            'Default gap applied after each column except the last as percentage of available width (e.g., "5%")',
        }),
      ])
    ),
  },
  {
    description: 'Columns component props',
    additionalProperties: false,
  }
);

export type ColumnsProps = Static<typeof ColumnsPropsSchema>;

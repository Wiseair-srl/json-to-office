/**
 * Common Types and Schemas for PPTX Components
 */

import { Type, Static } from '@sinclair/typebox';
import { ColorValueSchema } from './theme';

export const PptxAlignmentSchema = Type.Union(
  [Type.Literal('left'), Type.Literal('center'), Type.Literal('right')],
  { description: 'Horizontal alignment options' }
);

export const VerticalAlignmentSchema = Type.Union(
  [Type.Literal('top'), Type.Literal('middle'), Type.Literal('bottom')],
  { description: 'Vertical alignment options' }
);

export const ShadowSchema = Type.Object(
  {
    type: Type.Optional(
      Type.Union([Type.Literal('outer'), Type.Literal('inner')], {
        description: 'Shadow type',
      })
    ),
    color: Type.Optional(ColorValueSchema),
    blur: Type.Optional(
      Type.Number({ description: 'Shadow blur radius in points' })
    ),
    offset: Type.Optional(
      Type.Number({ description: 'Shadow offset in points' })
    ),
    angle: Type.Optional(
      Type.Number({ description: 'Shadow angle in degrees' })
    ),
    opacity: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 1,
        description: 'Shadow opacity (0-1)',
      })
    ),
  },
  {
    description: 'Shadow configuration',
    additionalProperties: false,
  }
);

export const GridPositionSchema = Type.Object(
  {
    column: Type.Number({
      minimum: 0,
      description: 'Starting column (0-indexed)',
    }),
    row: Type.Number({ minimum: 0, description: 'Starting row (0-indexed)' }),
    columnSpan: Type.Optional(
      Type.Number({
        minimum: 1,
        description: 'Number of columns to span (default: 1)',
      })
    ),
    rowSpan: Type.Optional(
      Type.Number({
        minimum: 1,
        description: 'Number of rows to span (default: 1)',
      })
    ),
  },
  { additionalProperties: false, description: 'Grid-based positioning' }
);

export type GridPosition = Static<typeof GridPositionSchema>;

// ============================================================================
// TypeScript Types
// ============================================================================

export type PptxAlignment = Static<typeof PptxAlignmentSchema>;
export type VerticalAlignment = Static<typeof VerticalAlignmentSchema>;
export type Shadow = Static<typeof ShadowSchema>;

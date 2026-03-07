/**
 * Common Types and Schemas for PPTX Components
 */

import { Type, Static } from '@sinclair/typebox';

// ============================================================================
// PPTX-Specific Common Types
// ============================================================================

export const PositionSchema = Type.Object(
  {
    x: Type.Optional(
      Type.Union([
        Type.Number({ description: 'X position in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'X position as percentage (e.g., "10%")',
        }),
      ])
    ),
    y: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Y position in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Y position as percentage (e.g., "10%")',
        }),
      ])
    ),
    w: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Width in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Width as percentage (e.g., "80%")',
        }),
      ])
    ),
    h: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Height in inches' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Height as percentage (e.g., "20%")',
        }),
      ])
    ),
  },
  {
    description: 'Position and size in inches or percentages',
    additionalProperties: false,
  }
);

export const SlideBackgroundSchema = Type.Object(
  {
    color: Type.Optional(
      Type.String({
        description: 'Background color as hex (e.g., "FF0000") or named color',
      })
    ),
    image: Type.Optional(
      Type.Object(
        {
          path: Type.Optional(Type.String({ description: 'Image file path or URL' })),
          base64: Type.Optional(
            Type.String({ description: 'Base64-encoded image data' })
          ),
        },
        { description: 'Background image', additionalProperties: false }
      )
    ),
  },
  {
    description: 'Slide background configuration',
    additionalProperties: false,
  }
);

export const TransitionSchema = Type.Object(
  {
    type: Type.Optional(
      Type.Union(
        [
          Type.Literal('fade'),
          Type.Literal('push'),
          Type.Literal('wipe'),
          Type.Literal('zoom'),
          Type.Literal('none'),
        ],
        { description: 'Transition effect type' }
      )
    ),
    speed: Type.Optional(
      Type.Union(
        [Type.Literal('slow'), Type.Literal('medium'), Type.Literal('fast')],
        { description: 'Transition speed' }
      )
    ),
  },
  {
    description: 'Slide transition configuration',
    additionalProperties: false,
  }
);

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
    color: Type.Optional(Type.String({ description: 'Shadow color (hex)' })),
    blur: Type.Optional(Type.Number({ description: 'Shadow blur radius in points' })),
    offset: Type.Optional(Type.Number({ description: 'Shadow offset in points' })),
    angle: Type.Optional(Type.Number({ description: 'Shadow angle in degrees' })),
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
    column: Type.Number({ minimum: 0, description: 'Starting column (0-indexed)' }),
    row: Type.Number({ minimum: 0, description: 'Starting row (0-indexed)' }),
    columnSpan: Type.Optional(Type.Number({ minimum: 1, description: 'Number of columns to span (default: 1)' })),
    rowSpan: Type.Optional(Type.Number({ minimum: 1, description: 'Number of rows to span (default: 1)' })),
  },
  { additionalProperties: false, description: 'Grid-based positioning' }
);

export type GridPosition = Static<typeof GridPositionSchema>;

// ============================================================================
// TypeScript Types
// ============================================================================

export type Position = Static<typeof PositionSchema>;
export type SlideBackground = Static<typeof SlideBackgroundSchema>;
export type Transition = Static<typeof TransitionSchema>;
export type PptxAlignment = Static<typeof PptxAlignmentSchema>;
export type VerticalAlignment = Static<typeof VerticalAlignmentSchema>;
export type Shadow = Static<typeof ShadowSchema>;

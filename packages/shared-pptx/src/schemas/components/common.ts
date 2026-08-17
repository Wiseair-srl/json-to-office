/**
 * Common Types and Schemas for PPTX Components
 */

import { Type, Static } from '@sinclair/typebox';
import {
  ColorValueSchema,
  GradientFillSchema,
} from '@json-to-office/shared/schemas/slide-content';

export {
  PptxAlignmentSchema,
  VerticalAlignmentSchema,
  ShadowSchema,
  GridPositionSchema,
} from '@json-to-office/shared/schemas/slide-content';

export type {
  PptxAlignment,
  VerticalAlignment,
  Shadow,
  GridPosition,
} from '@json-to-office/shared/schemas/slide-content';

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
    color: Type.Optional(ColorValueSchema),
    gradient: Type.Optional(GradientFillSchema),
    image: Type.Optional(
      Type.Object(
        {
          path: Type.Optional(
            Type.String({ description: 'Image file path or URL' })
          ),
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

export type Position = Static<typeof PositionSchema>;
export type SlideBackground = Static<typeof SlideBackgroundSchema>;
export type Transition = Static<typeof TransitionSchema>;

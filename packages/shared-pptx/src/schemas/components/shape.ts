/**
 * Shape Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { PptxAlignmentSchema, VerticalAlignmentSchema, ShadowSchema, GridPositionSchema } from './common';
import { StyleNameSchema } from '../theme';

export const ShapeTypeSchema = Type.Union(
  [
    Type.Literal('rect'),
    Type.Literal('roundRect'),
    Type.Literal('ellipse'),
    Type.Literal('triangle'),
    Type.Literal('diamond'),
    Type.Literal('pentagon'),
    Type.Literal('hexagon'),
    Type.Literal('star5'),
    Type.Literal('star6'),
    Type.Literal('line'),
    Type.Literal('arrow'),
    Type.Literal('chevron'),
    Type.Literal('cloud'),
    Type.Literal('heart'),
    Type.Literal('lightning'),
  ],
  { description: 'Shape type' }
);

export const TextSegmentSchema = Type.Object(
  {
    text: Type.String(),
    fontSize: Type.Optional(Type.Number({ minimum: 1 })),
    fontFace: Type.Optional(Type.String()),
    color: Type.Optional(Type.String({ description: 'Segment color (hex without # or semantic name)' })),
    bold: Type.Optional(Type.Boolean()),
    italic: Type.Optional(Type.Boolean()),
    breakLine: Type.Optional(Type.Boolean({ description: 'Insert line break after this segment' })),
    spaceBefore: Type.Optional(Type.Number({ minimum: 0, description: 'Space before paragraph in points' })),
    spaceAfter: Type.Optional(Type.Number({ minimum: 0, description: 'Space after paragraph in points' })),
    charSpacing: Type.Optional(Type.Number({ description: 'Character spacing in points' })),
  },
  { additionalProperties: false }
);

export type TextSegment = Static<typeof TextSegmentSchema>;

export const ShapePropsSchema = Type.Object(
  {
    type: ShapeTypeSchema,
    x: Type.Optional(
      Type.Union([
        Type.Number({ description: 'X position in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'X as percentage' }),
      ])
    ),
    y: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Y position in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'Y as percentage' }),
      ])
    ),
    w: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Width in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'Width as percentage' }),
      ])
    ),
    h: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Height in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'Height as percentage' }),
      ])
    ),
    fill: Type.Optional(
      Type.Object(
        {
          color: Type.String({ description: 'Fill color (hex without #)' }),
          transparency: Type.Optional(
            Type.Number({ minimum: 0, maximum: 100, description: 'Fill transparency (0-100)' })
          ),
        },
        { additionalProperties: false }
      )
    ),
    line: Type.Optional(
      Type.Object(
        {
          color: Type.Optional(Type.String({ description: 'Line color (hex without #)' })),
          width: Type.Optional(Type.Number({ minimum: 0, description: 'Line width in points' })),
          dashType: Type.Optional(
            Type.Union([
              Type.Literal('solid'),
              Type.Literal('dash'),
              Type.Literal('dot'),
              Type.Literal('dashDot'),
            ])
          ),
        },
        { additionalProperties: false }
      )
    ),
    text: Type.Optional(Type.Union([
      Type.String({ description: 'Plain text' }),
      Type.Array(TextSegmentSchema, { description: 'Rich text segments with per-segment formatting' }),
    ], { description: 'Text content inside the shape' })),
    fontSize: Type.Optional(Type.Number({ minimum: 1, description: 'Font size for shape text' })),
    fontFace: Type.Optional(Type.String({ description: 'Font family for shape text' })),
    fontColor: Type.Optional(Type.String({ description: 'Font color for shape text (hex without #)' })),
    charSpacing: Type.Optional(Type.Number({ description: 'Character spacing in points for shape text' })),
    bold: Type.Optional(Type.Boolean({ description: 'Bold shape text' })),
    italic: Type.Optional(Type.Boolean({ description: 'Italic shape text' })),
    align: Type.Optional(PptxAlignmentSchema),
    valign: Type.Optional(VerticalAlignmentSchema),
    rotate: Type.Optional(Type.Number({ description: 'Rotation angle in degrees' })),
    shadow: Type.Optional(ShadowSchema),
    rectRadius: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Corner radius for roundRect shape in inches',
      })
    ),
    grid: Type.Optional(GridPositionSchema),
    style: Type.Optional(StyleNameSchema),
  },
  {
    description: 'Shape component props',
    additionalProperties: false,
  }
);

export type ShapeType = Static<typeof ShapeTypeSchema>;
export type ShapeProps = Static<typeof ShapePropsSchema>;

/**
 * Text Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { FontFamilyNameSchema } from '@json-to-office/shared';
import { PptxAlignmentSchema, VerticalAlignmentSchema, ShadowSchema, GridPositionSchema } from './common';
import { StyleNameSchema } from '../theme';

export const TextPropsSchema = Type.Object(
  {
    text: Type.String({ description: 'Text content to display' }),
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
    fontSize: Type.Optional(
      Type.Number({ minimum: 1, description: 'Font size in points' })
    ),
    fontFace: Type.Optional(FontFamilyNameSchema),
    color: Type.Optional(
      Type.String({ description: 'Text color (hex without #, e.g., "FF0000")' })
    ),
    bold: Type.Optional(Type.Boolean({ description: 'Bold text' })),
    italic: Type.Optional(Type.Boolean({ description: 'Italic text' })),
    underline: Type.Optional(
      Type.Union([
        Type.Boolean({ description: 'Simple underline toggle' }),
        Type.Object(
          {
            style: Type.Optional(
              Type.Union([
                Type.Literal('sng'),
                Type.Literal('dbl'),
                Type.Literal('dash'),
                Type.Literal('dotted'),
              ])
            ),
            color: Type.Optional(Type.String({ description: 'Underline color (hex)' })),
          },
          { additionalProperties: false }
        ),
      ])
    ),
    strike: Type.Optional(Type.Boolean({ description: 'Strikethrough text' })),
    align: Type.Optional(PptxAlignmentSchema),
    valign: Type.Optional(VerticalAlignmentSchema),
    breakLine: Type.Optional(
      Type.Boolean({ description: 'Add line break after text' })
    ),
    bullet: Type.Optional(
      Type.Union([
        Type.Boolean({ description: 'Enable default bullet' }),
        Type.Object(
          {
            type: Type.Optional(
              Type.Union([Type.Literal('bullet'), Type.Literal('number')])
            ),
            style: Type.Optional(Type.String({ description: 'Bullet character or style' })),
            startAt: Type.Optional(Type.Number({ description: 'Starting number for numbered lists' })),
          },
          { additionalProperties: false }
        ),
      ])
    ),
    margin: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Margin in points (all sides)' }),
        Type.Array(Type.Number(), {
          description: 'Margins as [top, right, bottom, left] in points',
          minItems: 4,
          maxItems: 4,
        }),
      ])
    ),
    rotate: Type.Optional(Type.Number({ description: 'Rotation angle in degrees' })),
    shadow: Type.Optional(ShadowSchema),
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
    hyperlink: Type.Optional(
      Type.Object(
        {
          url: Type.Optional(Type.String({ description: 'Hyperlink URL' })),
          slide: Type.Optional(Type.Number({ description: 'Slide number to link to' })),
          tooltip: Type.Optional(Type.String({ description: 'Hyperlink tooltip' })),
        },
        { additionalProperties: false }
      )
    ),
    lineSpacing: Type.Optional(Type.Number({ description: 'Line spacing in points' })),
    charSpacing: Type.Optional(Type.Number({ description: 'Character spacing in points (positive = wider, negative = tighter)' })),
    paraSpaceBefore: Type.Optional(Type.Number({ description: 'Space before paragraph in points' })),
    paraSpaceAfter: Type.Optional(Type.Number({ description: 'Space after paragraph in points' })),
    grid: Type.Optional(GridPositionSchema),
    style: Type.Optional(StyleNameSchema),
  },
  {
    description: 'Text component props',
    additionalProperties: false,
  }
);

export type TextProps = Static<typeof TextPropsSchema>;

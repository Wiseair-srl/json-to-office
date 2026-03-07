/**
 * Image Component Schema (PPTX)
 */

import { Type, Static } from '@sinclair/typebox';
import { ShadowSchema, GridPositionSchema } from './common';

export const PptxImagePropsSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description: 'Image file path or URL (mutually exclusive with base64)',
      })
    ),
    base64: Type.Optional(
      Type.String({
        description:
          'Base64-encoded image data in data URI format (mutually exclusive with path)',
      })
    ),
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
    sizing: Type.Optional(
      Type.Object(
        {
          type: Type.Union(
            [
              Type.Literal('contain'),
              Type.Literal('cover'),
              Type.Literal('crop'),
            ],
            { description: 'Image sizing strategy' }
          ),
          w: Type.Optional(Type.Number({ description: 'Target width in inches' })),
          h: Type.Optional(Type.Number({ description: 'Target height in inches' })),
        },
        { description: 'Image sizing options', additionalProperties: false }
      )
    ),
    rotate: Type.Optional(
      Type.Number({ description: 'Rotation angle in degrees' })
    ),
    rounding: Type.Optional(
      Type.Boolean({ description: 'Apply rounded corners to image' })
    ),
    shadow: Type.Optional(ShadowSchema),
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
    alt: Type.Optional(
      Type.String({ description: 'Alternative text for accessibility' })
    ),
    grid: Type.Optional(GridPositionSchema),
  },
  {
    description: 'PPTX image component props',
    additionalProperties: false,
  }
);

export type PptxImageProps = Static<typeof PptxImagePropsSchema>;

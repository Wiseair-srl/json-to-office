/**
 * Image Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import {
  AlignmentSchema,
  SpacingSchema,
  FloatingPropertiesSchema,
} from './common';

export const ImagePropsSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description:
          'Image source URL or file path (mutually exclusive with base64)',
      })
    ),
    base64: Type.Optional(
      Type.String({
        description:
          'Base64-encoded image data in data URI format (e.g., "data:image/png;base64,iVBORw0KGgo...") (mutually exclusive with path)',
      })
    ),
    alt: Type.Optional(
      Type.String({
        description: 'Alternative text for accessibility',
      })
    ),
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
              'Image width as percentage (e.g., "90%") relative to widthRelativeTo (defaults to content width)',
          }),
        ],
        {
          description:
            'Image width in pixels (number) or as percentage string (e.g., "90%")',
          default: '100%',
        }
      )
    ),
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
              'Image height as percentage (e.g., "90%") relative to heightRelativeTo (defaults to content height)',
          }),
        ],
        {
          description:
            'Image height in pixels (number) or as percentage string (e.g., "90%")',
        }
      )
    ),
    widthRelativeTo: Type.Optional(
      Type.Union([Type.Literal('content'), Type.Literal('page')], {
        description:
          'Reference for width percentages: content (page width minus margins) or page (full page width)',
        default: 'content',
      })
    ),
    heightRelativeTo: Type.Optional(
      Type.Union([Type.Literal('content'), Type.Literal('page')], {
        description:
          'Reference for height percentages: content (page height minus margins) or page (full page height)',
        default: 'content',
      })
    ),
    alignment: Type.Optional(AlignmentSchema),
    caption: Type.Optional(
      Type.String({
        description:
          'Image caption (supports rich text with **bold**, *italic*, ***both***)',
      })
    ),
    spacing: Type.Optional(SpacingSchema),
    floating: Type.Optional(FloatingPropertiesSchema),
    keepNext: Type.Optional(
      Type.Boolean({
        description: 'Keep paragraph with next paragraph on same page',
      })
    ),
    keepLines: Type.Optional(
      Type.Boolean({
        description: 'Keep all lines of paragraph together on same page',
      })
    ),
  },
  {
    description: 'Image component props',
    additionalProperties: false,
  }
);

export type ImageProps = Static<typeof ImagePropsSchema>;

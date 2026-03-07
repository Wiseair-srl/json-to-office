/**
 * Font-related Schemas (shared)
 * Extracted to avoid circular dependencies between theme and module schemas.
 */

import { Type } from '@sinclair/typebox';

// ----------------------------------------------------------------------------
// Shared Text Formatting Properties
// ----------------------------------------------------------------------------

/**
 * Shared schema for text formatting properties.
 * Used as base for both font definitions and style definitions.
 */
export const TextFormattingPropertiesSchema = Type.Object(
  {
    size: Type.Optional(Type.Number({ minimum: 8, maximum: 72 })),
    color: Type.Optional(Type.String()),
    bold: Type.Optional(Type.Boolean()),
    italic: Type.Optional(Type.Boolean()),
    underline: Type.Optional(Type.Boolean()),
    lineSpacing: Type.Optional(
      Type.Object({
        type: Type.Union([
          Type.Literal('single'),
          Type.Literal('atLeast'),
          Type.Literal('exactly'),
          Type.Literal('double'),
          Type.Literal('multiple'),
        ]),
        value: Type.Optional(Type.Number({ minimum: 0 })),
      })
    ),
    spacing: Type.Optional(
      Type.Object({
        before: Type.Optional(Type.Number({ minimum: 0 })),
        after: Type.Optional(Type.Number({ minimum: 0 })),
      })
    ),
    characterSpacing: Type.Optional(
      Type.Object({
        type: Type.Union([Type.Literal('condensed'), Type.Literal('expanded')]),
        value: Type.Number(),
      })
    ),
  },
  { additionalProperties: false }
);

// ----------------------------------------------------------------------------
// Font Definition Schema
// ----------------------------------------------------------------------------

/**
 * Font definition schema with full text formatting properties.
 * All properties except 'family' are optional.
 */
export const FontDefinitionSchema = Type.Object(
  {
    family: Type.String(),
    ...TextFormattingPropertiesSchema.properties,
  },
  {
    description:
      'Font definition with family and optional formatting properties',
    additionalProperties: false,
  }
);

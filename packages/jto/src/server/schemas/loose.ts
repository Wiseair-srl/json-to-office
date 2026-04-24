/**
 * Loose schemas for initial request validation before plugin-aware validation.
 * These schemas allow unknown types that will be validated by plugin-aware validators.
 */

import { Type } from '@sinclair/typebox';

/**
 * Loose presentation generation request schema that allows plugin module types.
 * The strict validation is performed later with plugin-aware validators.
 */
/**
 * Font options accepted over the wire. Caps prevent client-supplied
 * substitution maps from landing unbounded strings into the tree walker.
 */
const FontOptionsSchema = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([Type.Literal('substitute'), Type.Literal('custom')])
    ),
    substitution: Type.Optional(
      Type.Record(
        Type.String({ maxLength: 128 }),
        Type.String({ maxLength: 128 }),
        { maxProperties: 256 }
      )
    ),
    strict: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

export const LooseDocumentGenerationRequestSchema = Type.Object(
  {
    jsonDefinition: Type.Union([
      Type.String(), // Allow JSON string
      Type.Object({}, { additionalProperties: true }), // Allow any object
    ]),
    customThemes: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    options: Type.Optional(
      Type.Object(
        {
          bypassCache: Type.Optional(Type.Boolean()),
          returnUrl: Type.Optional(Type.Boolean()),
          fonts: Type.Optional(FontOptionsSchema),
        },
        { additionalProperties: true }
      )
    ),
  },
  { additionalProperties: true }
);

/**
 * Loose document validation request schema that allows plugin module types.
 */
export const LooseDocumentValidationRequestSchema = Type.Object(
  {
    jsonDefinition: Type.Union([
      Type.String(), // Allow JSON string
      Type.Object({}, { additionalProperties: true }), // Allow any object
    ]),
  },
  { additionalProperties: true }
);

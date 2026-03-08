/**
 * Loose schemas for initial request validation before plugin-aware validation.
 * These schemas allow unknown types that will be validated by plugin-aware validators.
 */

import { Type } from '@sinclair/typebox';

/**
 * Loose presentation generation request schema that allows plugin module types.
 * The strict validation is performed later with plugin-aware validators.
 */
export const LooseDocumentGenerationRequestSchema = Type.Object(
  {
    jsonDefinition: Type.Union([
      Type.String(), // Allow JSON string
      Type.Object({}, { additionalProperties: true }), // Allow any object
    ]),
    customThemes: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    options: Type.Optional(Type.Object({}, { additionalProperties: true })),
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

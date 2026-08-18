/**
 * Loose schemas for initial request validation before plugin-aware validation.
 * These schemas allow unknown types that will be validated by plugin-aware validators.
 */

import { Type } from '@sinclair/typebox';

/**
 * Loose presentation generation request schema that allows plugin component names.
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
          // Name of the discovered document this definition came from; the
          // server maps it to that document's directory so relative asset
          // paths resolve against it (#142). Names, never paths — a client
          // cannot point the server at an arbitrary directory.
          sourceName: Type.Optional(Type.String()),
        },
        { additionalProperties: true }
      )
    ),
  },
  { additionalProperties: true }
);

/**
 * Loose document validation request schema that allows plugin component names.
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

/**
 * Diff request: two DOCX definitions to compare into a tracked-change
 * redline. Strict validation of both documents happens in the handler.
 */
export const LooseDocumentDiffRequestSchema = Type.Object(
  {
    oldDefinition: Type.Union([
      Type.String(),
      Type.Object({}, { additionalProperties: true }),
    ]),
    newDefinition: Type.Union([
      Type.String(),
      Type.Object({}, { additionalProperties: true }),
    ]),
    options: Type.Optional(
      Type.Object(
        {
          author: Type.Optional(Type.String({ maxLength: 128 })),
          date: Type.Optional(Type.String({ maxLength: 64 })),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: true }
);

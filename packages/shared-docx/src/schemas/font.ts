/**
 * Font-related Schemas (shared)
 * Extracted to avoid circular dependencies between theme and module schemas.
 */

import { Type } from '@sinclair/typebox';
import { FontFamilyNameSchema } from '@json-to-office/shared';

// ----------------------------------------------------------------------------
// Shared Color Schema
// ----------------------------------------------------------------------------

/** Hex color with # prefix (e.g. "#000000") or a theme color name (e.g. "primary") */
export const HexColorSchema = Type.String({
  pattern: '^(#[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$',
  description: 'Hex color with # prefix (e.g. "#000000") or theme color name',
});

/** Like HexColorSchema but also accepts "transparent" (used for backgroundColor) */
export const HexColorOrTransparentSchema = Type.String({
  pattern: '^(transparent|#[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$',
  description: 'Hex color with # prefix, theme color name, or "transparent"',
});

// ----------------------------------------------------------------------------
// Shared Language / Proofing Schemas
// ----------------------------------------------------------------------------

/**
 * BCP-47 / IETF language tag used by Word for spell- and grammar-checking
 * (e.g. "en-US", "fr-FR", "de-DE"). Set on the document to change the default
 * proofing language, or on a component to override it for that text only.
 */
export const LanguageSchema = Type.String({
  pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$',
  description:
    'BCP-47 language tag for spell/grammar checking (e.g. "en-US", "fr-FR", "de-DE")',
  examples: ['en-US', 'fr-FR', 'de-DE', 'it-IT', 'es-ES'],
});

/**
 * Disable spell/grammar checking ("do not proof") for the text, e.g. code
 * snippets, identifiers, or product names Word would otherwise flag.
 */
export const NoProofSchema = Type.Boolean({
  description:
    'Disable spell/grammar checking for this text (e.g. code snippets or identifiers)',
});

/**
 * A "known words" allowlist: every whole-word, case-insensitive occurrence of
 * these terms is wrapped in a no-proof run so Word never flags them, while the
 * surrounding text is still spell-checked. Acts as a portable, document-embedded
 * stand-in for a custom dictionary (Word's real dictionaries can't be shipped
 * inside a .docx). Set on the document to apply everywhere; a component's list
 * is merged with (added to) the document list.
 */
export const NoProofWordsSchema = Type.Array(Type.String({ minLength: 1 }), {
  description:
    'Words that should never be flagged as misspelled (whole-word, case-insensitive). E.g. brand names or technical terms.',
  examples: [['Wiseair', 'json-to-office', 'pptx']],
});

// ----------------------------------------------------------------------------
// Shared Text Formatting Properties
// ----------------------------------------------------------------------------

/**
 * Shared schema for text formatting properties.
 * Used as base for both font definitions and style definitions.
 */
export const TextFormattingPropertiesSchema = Type.Object(
  {
    size: Type.Optional(
      Type.Number({
        minimum: 8,
        maximum: 1638,
        description:
          'Font size in points. Emitted as OOXML half-points (`w:sz` = size × 2), whose type `ST_HpsMeasure` has no 72pt ceiling — Word itself accepts up to 1638pt. Sizes well above body copy are legitimate display type (cover numerals, chapter headings, pull quotes).',
      })
    ),
    color: Type.Optional(HexColorSchema),
    bold: Type.Optional(Type.Boolean()),
    fontWeight: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 900,
        description:
          'Per-run weight (100–900). Any integer accepted; renderer picks the closest embedded variant via CSS font-matching. `bold: true` is shorthand for `fontWeight: 700`; if both are set, `fontWeight` wins.',
      })
    ),
    italic: Type.Optional(Type.Boolean()),
    underline: Type.Optional(Type.Boolean()),
    lineSpacing: Type.Optional(
      Type.Object(
        {
          type: Type.Union([
            Type.Literal('single'),
            Type.Literal('atLeast'),
            Type.Literal('exactly'),
            Type.Literal('double'),
            Type.Literal('multiple'),
          ]),
          value: Type.Optional(Type.Number({ minimum: 0 })),
        },
        { additionalProperties: false }
      )
    ),
    spacing: Type.Optional(
      Type.Object(
        {
          before: Type.Optional(Type.Number({ minimum: 0 })),
          after: Type.Optional(Type.Number({ minimum: 0 })),
        },
        { additionalProperties: false }
      )
    ),
    characterSpacing: Type.Optional(
      Type.Object(
        {
          type: Type.Union([
            Type.Literal('condensed'),
            Type.Literal('expanded'),
          ]),
          value: Type.Number(),
        },
        { additionalProperties: false }
      )
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
    family: FontFamilyNameSchema,
    ...TextFormattingPropertiesSchema.properties,
  },
  {
    description:
      'Font definition with family and optional formatting properties',
    additionalProperties: false,
  }
);

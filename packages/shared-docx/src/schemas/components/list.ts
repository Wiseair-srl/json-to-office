/**
 * List Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import {
  ListSpacingSchema,
  JustifiedAlignmentSchema,
  IndentSchema,
} from './common';

/**
 * Level format options for docx numbering
 * Maps to docx LevelFormat enum
 */
export const LevelFormatSchema = Type.Union(
  [
    Type.Literal('decimal'),
    Type.Literal('upperRoman'),
    Type.Literal('lowerRoman'),
    Type.Literal('upperLetter'),
    Type.Literal('lowerLetter'),
    Type.Literal('bullet'),
    Type.Literal('ordinal'),
    Type.Literal('cardinalText'),
    Type.Literal('ordinalText'),
    Type.Literal('hex'),
    Type.Literal('chicago'),
    Type.Literal('ideographDigital'),
    Type.Literal('japaneseCounting'),
    Type.Literal('aiueo'),
    Type.Literal('iroha'),
    Type.Literal('decimalFullWidth'),
    Type.Literal('decimalHalfWidth'),
    Type.Literal('japaneseLegal'),
    Type.Literal('japaneseDigitalTenThousand'),
    Type.Literal('decimalEnclosedCircle'),
    Type.Literal('decimalFullWidth2'),
    Type.Literal('aiueoFullWidth'),
    Type.Literal('irohaFullWidth'),
    Type.Literal('decimalZero'),
    Type.Literal('ganada'),
    Type.Literal('chosung'),
    Type.Literal('decimalEnclosedFullstop'),
    Type.Literal('decimalEnclosedParen'),
    Type.Literal('decimalEnclosedCircleChinese'),
    Type.Literal('ideographEnclosedCircle'),
    Type.Literal('ideographTraditional'),
    Type.Literal('ideographZodiac'),
    Type.Literal('ideographZodiacTraditional'),
    Type.Literal('taiwaneseCounting'),
    Type.Literal('ideographLegalTraditional'),
    Type.Literal('taiwaneseCountingThousand'),
    Type.Literal('taiwaneseDigital'),
    Type.Literal('chineseCounting'),
    Type.Literal('chineseLegalSimplified'),
    Type.Literal('chineseCountingThousand'),
    Type.Literal('koreanDigital'),
    Type.Literal('koreanCounting'),
    Type.Literal('koreanLegal'),
    Type.Literal('koreanDigital2'),
    Type.Literal('vietnameseCounting'),
    Type.Literal('russianLower'),
    Type.Literal('russianUpper'),
    Type.Literal('none'),
    Type.Literal('numberInDash'),
    Type.Literal('hebrew1'),
    Type.Literal('hebrew2'),
    Type.Literal('arabicAlpha'),
    Type.Literal('arabicAbjad'),
    Type.Literal('hindiVowels'),
    Type.Literal('hindiConsonants'),
    Type.Literal('hindiNumbers'),
    Type.Literal('hindiCounting'),
    Type.Literal('thaiLetters'),
    Type.Literal('thaiNumbers'),
    Type.Literal('thaiCounting'),
  ],
  {
    description: 'Number or bullet format for list levels',
  }
);

/**
 * Configuration for a single numbering level
 */
export const ListLevelPropsSchema = Type.Object(
  {
    level: Type.Number({
      minimum: 0,
      maximum: 8,
      description: 'Nesting level (0 = root, 1 = first sublevel, etc.)',
    }),
    format: Type.Optional(LevelFormatSchema),
    text: Type.Optional(
      Type.String({
        description:
          'Number format string (e.g., "%1." for "1.", "%1)" for "1)", custom bullet character for bullet format)',
      })
    ),
    alignment: Type.Optional(
      Type.Union(
        [
          Type.Literal('start'),
          Type.Literal('end'),
          Type.Literal('left'),
          Type.Literal('right'),
          Type.Literal('center'),
        ],
        {
          description: 'Alignment of the numbering/bullet',
        }
      )
    ),
    indent: Type.Optional(IndentSchema),
    start: Type.Optional(
      Type.Number({
        minimum: 1,
        description: 'Starting number for this level (default: 1)',
      })
    ),
  },
  {
    description: 'Configuration for a single list level',
  }
);

export const ListPropsSchema = Type.Object(
  {
    items: Type.Array(
      Type.Union([
        Type.String(),
        Type.Object({
          text: Type.String(),
          level: Type.Optional(
            Type.Number({
              minimum: 0,
              maximum: 8,
              description: 'Nesting level for this item',
            })
          ),
        }),
      ]),
      {
        description: 'List items (required)',
        minItems: 1,
      }
    ),
    reference: Type.Optional(
      Type.String({
        description:
          'Unique reference ID for this numbering configuration (auto-generated if not provided)',
      })
    ),
    levels: Type.Optional(
      Type.Array(ListLevelPropsSchema, {
        description: 'Configuration for each nesting level',
        minItems: 1,
        maxItems: 9,
      })
    ),
    // Simplified options for common use cases (when levels not specified)
    format: Type.Optional(
      Type.Union(
        [LevelFormatSchema, Type.Literal('numbered'), Type.Literal('none')],
        {
          description:
            'Format for level 0 (simplified option when levels not specified)',
        }
      )
    ),
    bullet: Type.Optional(
      Type.String({
        description:
          'Custom bullet character (simplified option when levels not specified)',
      })
    ),
    start: Type.Optional(
      Type.Number({
        minimum: 1,
        description:
          'Starting number for level 0 (simplified option when levels not specified)',
      })
    ),
    spacing: Type.Optional(ListSpacingSchema),
    alignment: Type.Optional(JustifiedAlignmentSchema),
    indent: Type.Optional(
      Type.Union([Type.Number({ minimum: 0 }), IndentSchema])
    ),
  },
  {
    description: 'List component props',
    additionalProperties: false,
  }
);

export type LevelFormat = Static<typeof LevelFormatSchema>;
export type ListLevelProps = Static<typeof ListLevelPropsSchema>;
export type ListProps = Static<typeof ListPropsSchema>;

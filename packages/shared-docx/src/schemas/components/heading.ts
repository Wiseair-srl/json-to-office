/**
 * Heading Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import {
  FontDefinitionSchema,
  LanguageSchema,
  NoProofSchema,
  NoProofWordsSchema,
} from '../font';
import {
  HeadingLevelSchema,
  JustifiedAlignmentSchema,
  SpacingSchema,
  LineSpacingSchema,
  ParagraphIndentSchema,
} from './common';
import { RevisionSchema } from './revision';
import { CommentSchema } from './comment';

export const HeadingPropsSchema = Type.Object(
  {
    text: Type.String({
      description: 'Heading text (required)',
    }),
    level: Type.Optional(HeadingLevelSchema),
    // Local font override: allows customizing family/size/color/bold/italic/underline
    // without modifying theme styles. Supports partial overrides.
    font: Type.Optional(Type.Partial(FontDefinitionSchema)),
    // Local language override (BCP-47). Falls back to the document default when omitted.
    language: Type.Optional(LanguageSchema),
    // Disable spell/grammar checking for this heading's text
    noProof: Type.Optional(NoProofSchema),
    // Known-words allowlist for this heading (merged with the document list)
    noProofWords: Type.Optional(NoProofWordsSchema),
    alignment: Type.Optional(JustifiedAlignmentSchema),
    spacing: Type.Optional(SpacingSchema),
    // Paragraph indentation (w:ind) in twips
    indent: Type.Optional(ParagraphIndentSchema),
    lineSpacing: Type.Optional(
      Type.Union([Type.Number({ minimum: 0 }), LineSpacingSchema])
    ),
    pageBreak: Type.Optional(
      Type.Boolean({
        description: 'Insert page break before heading',
      })
    ),
    columnBreak: Type.Optional(
      Type.Boolean({
        description: 'Insert column break before heading',
      })
    ),
    numbering: Type.Optional(
      Type.Boolean({
        description: 'Include in numbering',
      })
    ),
    keepNext: Type.Optional(
      Type.Boolean({
        description: 'Keep heading with next paragraph on same page',
      })
    ),
    keepLines: Type.Optional(
      Type.Boolean({
        description: 'Keep all lines of heading together on same page',
      })
    ),
    revision: Type.Optional(RevisionSchema),
    comment: Type.Optional(CommentSchema),
  },
  {
    description: 'Heading component props',
    additionalProperties: false,
  }
);

export type HeadingProps = Static<typeof HeadingPropsSchema>;

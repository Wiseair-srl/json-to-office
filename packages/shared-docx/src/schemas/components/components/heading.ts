/**
 * Heading Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { FontDefinitionSchema } from '../font';
import {
  HeadingLevelSchema,
  JustifiedAlignmentSchema,
  SpacingSchema,
  LineSpacingSchema,
} from './common';

export const HeadingPropsSchema = Type.Object(
  {
    text: Type.String({
      description: 'Heading text (required)',
    }),
    level: Type.Optional(HeadingLevelSchema),
    // Local font override: allows customizing family/size/color/bold/italic/underline
    // without modifying theme styles. Supports partial overrides.
    font: Type.Optional(Type.Partial(FontDefinitionSchema)),
    alignment: Type.Optional(JustifiedAlignmentSchema),
    spacing: Type.Optional(SpacingSchema),
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
  },
  {
    description: 'Heading component props',
    additionalProperties: false,
  }
);

export type HeadingProps = Static<typeof HeadingPropsSchema>;

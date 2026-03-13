/**
 * Presentation Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { MasterSlideDefinitionSchema } from './master';

export const PresentationPropsSchema = Type.Object(
  {
    title: Type.Optional(
      Type.String({ description: 'Presentation title metadata' })
    ),
    author: Type.Optional(
      Type.String({ description: 'Presentation author metadata' })
    ),
    subject: Type.Optional(
      Type.String({ description: 'Presentation subject metadata' })
    ),
    company: Type.Optional(
      Type.String({ description: 'Company name metadata' })
    ),
    theme: Type.Optional(
      Type.String({
        description: 'Theme name to apply (default: "default")',
        default: 'default',
      })
    ),
    slideWidth: Type.Optional(
      Type.Number({
        description: 'Slide width in inches (default: 10)',
        default: 10,
      })
    ),
    slideHeight: Type.Optional(
      Type.Number({
        description: 'Slide height in inches (default: 7.5)',
        default: 7.5,
      })
    ),
    rtlMode: Type.Optional(
      Type.Boolean({ description: 'Right-to-left text direction' })
    ),
    masters: Type.Optional(
      Type.Array(MasterSlideDefinitionSchema, {
        description: 'Master slide definitions (reusable slide templates)',
      })
    ),
  },
  {
    description: 'Presentation container props',
    additionalProperties: false,
  }
);

export type PresentationProps = Static<typeof PresentationPropsSchema>;

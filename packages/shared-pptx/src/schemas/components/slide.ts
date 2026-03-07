/**
 * Slide Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { SlideBackgroundSchema, TransitionSchema } from './common';

export const SlidePropsSchema = Type.Object(
  {
    background: Type.Optional(SlideBackgroundSchema),
    transition: Type.Optional(TransitionSchema),
    notes: Type.Optional(
      Type.String({ description: 'Speaker notes for this slide' })
    ),
    layout: Type.Optional(
      Type.String({
        description: 'Slide layout name (e.g., "Title Slide", "Blank")',
      })
    ),
    hidden: Type.Optional(
      Type.Boolean({ description: 'Hide this slide from presentation' })
    ),
  },
  {
    description: 'Slide container props',
    additionalProperties: false,
  }
);

export type SlideProps = Static<typeof SlidePropsSchema>;

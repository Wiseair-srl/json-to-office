/**
 * Slide Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { SlideBackgroundSchema, TransitionSchema } from './common';

export const SlidePropsSchema = Type.Object(
  {
    meta: Type.Optional(
      Type.Object(
        {
          title: Type.Optional(
            Type.String({
              description:
                'Authoring label for this slide, shown in editors and outlines. Never rendered — slide content is unaffected.',
            })
          ),
        },
        {
          additionalProperties: false,
          description: 'Authoring metadata; has no effect on the presentation.',
        }
      )
    ),
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
    template: Type.Optional(
      Type.String({ description: 'Template slide name to apply' })
    ),
    // Note: `placeholders` is added dynamically by the component registry
    // with the recursive component ref, to avoid circular imports.
  },
  {
    description: 'Slide container props',
    additionalProperties: false,
  }
);

export type SlideProps = Static<typeof SlidePropsSchema>;

/**
 * Cover block.
 *
 * A report's first page: title, subtitle, client, date and confidentiality,
 * with an optional logo, drawn as the theme's cover recipe. The block says
 * what the page holds; the theme decides the rule, the type roles and where
 * on the page the title sits. Put it in a section of its own so the report
 * proper starts on a fresh page with its own running head.
 *
 * Every text slot is one line by construction — a line break inside a cover
 * title is a layout decision the theme should be making — so the shape is a
 * schema bound. The word budgets are quality findings (`W_QUALITY_SLOT_BUDGET`),
 * because a long subtitle is a repair, not a refusal.
 */

import { Type, Static } from '@sinclair/typebox';
import { ImagePropsSchema } from './image';
import { oneLineText } from './common';

/** The slot budgets the compiler and the quality rules both read. */
export const COVER_BUDGET = {
  title: { maxWords: 12 },
  subtitle: { maxWords: 30 },
} as const;

/**
 * The image props a cover logo accepts: a source and a size, nothing about
 * flow. Alignment comes from the theme's `logoSlot` recipe.
 */
export const CoverLogoSchema = Type.Object(
  {
    path: ImagePropsSchema.properties.path,
    base64: ImagePropsSchema.properties.base64,
    svg: ImagePropsSchema.properties.svg,
    alt: ImagePropsSchema.properties.alt,
    width: ImagePropsSchema.properties.width,
    height: ImagePropsSchema.properties.height,
  },
  {
    additionalProperties: false,
    // One source, as the image component itself requires.
    anyOf: [
      { required: ['path'] },
      { required: ['base64'] },
      { required: ['svg'] },
    ],
    description:
      "The logo: one of `path`, `base64` or `svg`, plus an optional `width`/`height` (default: a quarter of the measure). Placed where the theme's `logoSlot` recipe says.",
  }
);

export const CoverPropsSchema = Type.Object(
  {
    title: oneLineText(
      `The report title, one line, at most ${COVER_BUDGET.title.maxWords} words. Set in the theme's cover type role.`
    ),
    subtitle: Type.Optional(
      oneLineText(
        `What the report answers, one line, at most ${COVER_BUDGET.subtitle.maxWords} words. Set in the theme's subtitle style.`
      )
    ),
    client: Type.Optional(
      oneLineText(
        'Who the report is for — a client or organisation name. Drawn as an eyebrow above the title.'
      )
    ),
    date: Type.Optional(
      oneLineText(
        'The report date as it should read ("September 2026", "Q3 2026"). Free text: the block never reformats it.'
      )
    ),
    confidentiality: Type.Optional(
      oneLineText(
        'A confidentiality statement ("Confidential", "For internal use"). Drawn on the meta line under the title.'
      )
    ),
    logo: Type.Optional(CoverLogoSchema),
  },
  {
    description:
      "Cover block: title, subtitle, client, date, confidentiality and an optional logo, drawn as the theme's cover recipe. Put it in a section of its own; never hand-build a cover from paragraphs and spacing.",
    additionalProperties: false,
  }
);

export type CoverProps = Static<typeof CoverPropsSchema>;

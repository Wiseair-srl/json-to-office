/**
 * Presentation Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import {
  BlockDefinitionsSchema,
  FontRegistrySchema,
} from '@json-to-office/shared';
import { GridConfigSchema, ThemeConfigSchema } from '../theme';
import { PptxComponentDefaultsSchema } from '../component-defaults';

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
      Type.Union(
        [
          Type.String({
            description:
              'Theme name to apply (default: "default"). Built-ins: consulting (the house style), default, dark, minimal.',
            examples: ['consulting', 'default', 'dark', 'minimal'],
            default: 'default',
          }),
          ThemeConfigSchema,
        ],
        {
          description:
            'Theme to apply: a built-in/custom theme name (default: ' +
            '"default"), or an inline theme config object so the document ' +
            'stays self-contained',
        }
      )
    ),
    fontRegistry: Type.Optional(FontRegistrySchema),
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
    language: Type.Optional(
      Type.String({
        pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$',
        description:
          'Default presentation language (BCP-47 tag, e.g. "en-US"). Sets the spell-check language for all text; individual text components can override it.',
        examples: ['en-US', 'fr-FR', 'de-DE', 'it-IT', 'es-ES'],
      })
    ),
    pageNumberFormat: Type.Optional(
      Type.Union([Type.Literal('9'), Type.Literal('09')], {
        description:
          'Format for {PAGE_NUMBER} placeholders: "9" = bare number (default), "09" = zero-padded',
        default: '9',
      })
    ),
    componentDefaults: Type.Optional(PptxComponentDefaultsSchema),
    grid: Type.Optional(GridConfigSchema),
    blocks: Type.Optional(BlockDefinitionsSchema),
    qualityProfile: Type.Optional(
      Type.String({
        description:
          'The quality profile validation judges this deck by when the caller names none — a blueprint scaffold writes its archetype’s profile here. A profile names required structure and content; the theme only paints. Built-ins: consulting-deck, executive-presentation, technical-presentation; an unknown name falls back to the format default.',
        examples: [
          'consulting-deck',
          'executive-presentation',
          'technical-presentation',
        ],
      })
    ),
  },
  {
    description: 'Presentation container props',
    additionalProperties: false,
  }
);

export type PresentationProps = Static<typeof PresentationPropsSchema>;

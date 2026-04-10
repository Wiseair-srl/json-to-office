/**
 * Presentation Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { TemplateSlideDefinitionSchema } from './template';
import { GridConfigSchema } from '../theme';
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
    pageNumberFormat: Type.Optional(
      Type.Union([Type.Literal('9'), Type.Literal('09')], {
        description: 'Format for {PAGE_NUMBER} placeholders: "9" = bare number (default), "09" = zero-padded',
        default: '9',
      })
    ),
    componentDefaults: Type.Optional(PptxComponentDefaultsSchema),
    grid: Type.Optional(GridConfigSchema),
    templates: Type.Optional(
      Type.Array(TemplateSlideDefinitionSchema, {
        description: 'Template slide definitions (reusable slide templates)',
      })
    ),
  },
  {
    description: 'Presentation container props',
    additionalProperties: false,
  }
);

export type PresentationProps = Static<typeof PresentationPropsSchema>;

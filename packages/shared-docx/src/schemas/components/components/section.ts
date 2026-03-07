/**
 * Section Component Schema
 */

import { Type, Static, TSchema } from '@sinclair/typebox';
import { SpacingSchema } from './common';

// Create a function to generate SectionPropsSchema with recursive component reference
export const createSectionPropsSchema = (moduleRef?: TSchema) =>
  Type.Object(
    {
      title: Type.Optional(
        Type.String({
          description: 'Section title (optional)',
        })
      ),
      level: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 9,
          description: 'Heading level for section title (1-9)',
          default: 1,
        })
      ),
      header: Type.Optional(
        Type.Union([
          Type.Array(moduleRef || Type.Any(), {
            description: 'Section header modules',
          }),
          Type.Literal('linkToPrevious', {
            description: 'Link header to previous section',
          }),
        ])
      ),
      footer: Type.Optional(
        Type.Union([
          Type.Array(moduleRef || Type.Any(), {
            description: 'Section footer modules',
          }),
          Type.Literal('linkToPrevious', {
            description: 'Link footer to previous section',
          }),
        ])
      ),
      pageBreak: Type.Optional(
        Type.Boolean({
          description: 'Insert page break before section',
          default: true,
        })
      ),
      spacing: Type.Optional(SpacingSchema),
      page: Type.Optional(
        Type.Object(
          {
            size: Type.Optional(
              Type.Union([
                Type.Literal('A4'),
                Type.Literal('A3'),
                Type.Literal('LETTER'),
                Type.Literal('LEGAL'),
                Type.Object({
                  width: Type.Number({ minimum: 0 }),
                  height: Type.Number({ minimum: 0 }),
                }),
              ])
            ),
            margins: Type.Optional(
              Type.Object(
                {
                  top: Type.Optional(Type.Number({ minimum: 0 })),
                  bottom: Type.Optional(Type.Number({ minimum: 0 })),
                  left: Type.Optional(Type.Number({ minimum: 0 })),
                  right: Type.Optional(Type.Number({ minimum: 0 })),
                  header: Type.Optional(Type.Number({ minimum: 0 })),
                  footer: Type.Optional(Type.Number({ minimum: 0 })),
                  gutter: Type.Optional(Type.Number({ minimum: 0 })),
                },
                {
                  additionalProperties: false,
                }
              )
            ),
          },
          {
            description:
              'Page configuration override for this section (overrides theme page settings)',
            additionalProperties: false,
          }
        )
      ),
    },
    {
      description: 'Section component props',
      additionalProperties: false,
    }
  );

export const SectionPropsSchema = createSectionPropsSchema();

export type SectionProps = Static<typeof SectionPropsSchema>;

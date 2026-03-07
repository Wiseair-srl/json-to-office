/**
 * Header Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { AlignmentSchema } from './common';

export const HeaderPropsSchema = Type.Object(
  {
    text: Type.Optional(
      Type.String({
        description: 'Header text',
      })
    ),
    logo: Type.Optional(
      Type.String({
        description: 'Logo image URL or path',
      })
    ),
    alignment: Type.Optional(AlignmentSchema),
    position: Type.Optional(
      Type.Union([Type.Literal('top'), Type.Literal('bottom')])
    ),
    firstPage: Type.Optional(
      Type.Boolean({
        description: 'Show header on first page',
      })
    ),
    oddPages: Type.Optional(
      Type.Boolean({
        description: 'Show header on odd pages',
      })
    ),
    evenPages: Type.Optional(
      Type.Boolean({
        description: 'Show header on even pages',
      })
    ),
    showPageNumbers: Type.Optional(Type.Boolean()),
    showDate: Type.Optional(Type.Boolean()),
    height: Type.Optional(Type.Number({ minimum: 0 })),
  },
  {
    description: 'Document header configuration',
    additionalProperties: false,
  }
);

export type HeaderProps = Static<typeof HeaderPropsSchema>;

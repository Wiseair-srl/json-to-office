/**
 * Footer Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { AlignmentSchema } from './common';

export const FooterPropsSchema = Type.Object(
  {
    text: Type.Optional(
      Type.String({
        description: 'Footer text',
      })
    ),
    alignment: Type.Optional(AlignmentSchema),
    position: Type.Optional(
      Type.Union([Type.Literal('top'), Type.Literal('bottom')])
    ),
    firstPage: Type.Optional(
      Type.Boolean({
        description: 'Show footer on first page',
      })
    ),
    oddPages: Type.Optional(
      Type.Boolean({
        description: 'Show footer on odd pages',
      })
    ),
    evenPages: Type.Optional(
      Type.Boolean({
        description: 'Show footer on even pages',
      })
    ),
    showPageNumbers: Type.Optional(Type.Boolean()),
    showDate: Type.Optional(Type.Boolean()),
    height: Type.Optional(Type.Number({ minimum: 0 })),
  },
  {
    description: 'Document footer configuration',
    additionalProperties: false,
  }
);

export type FooterProps = Static<typeof FooterPropsSchema>;

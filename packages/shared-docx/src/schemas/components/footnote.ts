/**
 * Footnote Schema
 *
 * A footnote is authored in two halves: an inline marker in the text and a body
 * declared on the paragraph that carries it.
 *
 *   { "text": "Revenue grew 12%.[^rev]",
 *     "footnotes": [{ "id": "rev", "text": "Source: FY26 audited accounts." }] }
 *
 * `[^id]` is only treated as a marker when `id` matches a declared footnote, so
 * text that merely looks like one — a regex character class in a code sample,
 * say — is left exactly as written.
 */

import { Type, Static } from '@sinclair/typebox';

export const FootnoteSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      pattern: '^[^\\]\\s]+$',
      description:
        'Marker id referenced from the text as `[^id]`. Any characters except whitespace and "]".',
    }),
    text: Type.String({
      minLength: 1,
      description:
        'Footnote body. Newlines split it into separate paragraphs at the page foot.',
    }),
  },
  {
    description: 'A footnote body bound to an inline `[^id]` marker',
    additionalProperties: false,
  }
);

export const FootnotesSchema = Type.Array(FootnoteSchema, {
  description:
    'Footnote bodies for the `[^id]` markers in this paragraph. An unreferenced body is not emitted.',
  minItems: 1,
});

export type Footnote = Static<typeof FootnoteSchema>;

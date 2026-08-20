/**
 * Note Schemas (footnotes and endnotes)
 *
 * A note is authored in two halves: an inline `[^id]` marker in the text and a
 * body declared on the paragraph that carries it.
 *
 *   { "text": "Revenue grew 12%.[^rev]",
 *     "footnotes": [{ "id": "rev", "text": "Source: FY26 audited accounts." }] }
 *
 * Footnotes and endnotes share the marker syntax and differ only in where Word
 * puts the body — the foot of the page, or the end of the document. An id is
 * resolved against the paragraph's `footnotes` first, then its `endnotes`.
 *
 * `[^id]` is only treated as a marker when `id` matches a declared note, so
 * text that merely looks like one — a regex character class in a code sample,
 * say — is left exactly as written.
 */

import { Type, Static } from '@sinclair/typebox';

export const NoteSchema = Type.Object(
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
        'Note body. Newlines split it into separate paragraphs where the note is placed.',
    }),
  },
  {
    description: 'A note body bound to an inline `[^id]` marker',
    additionalProperties: false,
  }
);

export const FootnotesSchema = Type.Array(NoteSchema, {
  description:
    'Footnote bodies for `[^id]` markers in this paragraph, placed at the foot of the page. An unreferenced body is not emitted.',
  minItems: 1,
});

export const EndnotesSchema = Type.Array(NoteSchema, {
  description:
    'Endnote bodies for `[^id]` markers in this paragraph, collected at the end of the document. An unreferenced body is not emitted.',
  minItems: 1,
});

export type Note = Static<typeof NoteSchema>;

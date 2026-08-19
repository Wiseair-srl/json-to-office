/**
 * Comment Schema
 * Word review comments anchored to a text-bearing component.
 *
 * A comment attaches to the component that carries it: the rendered text is
 * wrapped in a `w:commentRangeStart` / `w:commentRangeEnd` pair and followed by
 * a `w:commentReference`, with the body living in `word/comments.xml`. The
 * component's own text is unaffected, so a reader that ignores comments sees
 * exactly the same document.
 *
 * Comment ids live in their own OOXML namespace, separate from the
 * `w:ins` / `w:del` ids used by [`RevisionSchema`](./revision.ts).
 */

import { Type, Static } from '@sinclair/typebox';

export const CommentSchema = Type.Object(
  {
    text: Type.String({
      minLength: 1,
      description:
        'Comment body. Newlines split it into separate paragraphs in the comment pane.',
    }),
    author: Type.Optional(
      Type.String({
        description: 'Comment author shown in Word (default: "json-to-office")',
      })
    ),
    initials: Type.Optional(
      Type.String({
        description:
          'Author initials shown on the comment bubble (derived from the author when omitted)',
      })
    ),
    date: Type.Optional(
      Type.String({
        format: 'date-time',
        description:
          'Comment timestamp (ISO 8601). Defaults to the Unix epoch for deterministic output',
      })
    ),
  },
  {
    description:
      "A Word review comment anchored to this component's text (unthreaded)",
    additionalProperties: false,
  }
);

export type Comment = Static<typeof CommentSchema>;

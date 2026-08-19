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

/** Fields every comment in a thread shares. */
const CommentBodyFields = {
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
};

/**
 * A reply in a comment thread. Word threads are one level deep — a reply
 * cannot itself carry replies — so this is deliberately not recursive.
 */
export const CommentReplySchema = Type.Object(CommentBodyFields, {
  description: 'A reply within a comment thread',
  additionalProperties: false,
});

export const CommentSchema = Type.Object(
  {
    ...CommentBodyFields,
    replies: Type.Optional(
      Type.Array(CommentReplySchema, {
        minItems: 1,
        description:
          'Replies, in order. They anchor to the same text and Word shows them as one thread.',
      })
    ),
    resolved: Type.Optional(
      Type.Boolean({
        description:
          'Mark the whole thread resolved (w15:done). Word writes the thread state only when the document contains at least one reply.',
      })
    ),
  },
  {
    description: "A Word review comment anchored to this component's text",
    additionalProperties: false,
  }
);

export type CommentReply = Static<typeof CommentReplySchema>;
export type Comment = Static<typeof CommentSchema>;

/**
 * Revision Schema
 * Tracked-change (redline) metadata for text-bearing components.
 *
 * When a component carries a `revision`, its text is rendered from
 * `revision.segments` as native Word tracked changes (w:ins / w:del)
 * instead of the plain `text` prop. The `text` prop should hold the
 * new (post-change) text so the document degrades gracefully when
 * revisions are ignored.
 */

import { Type, Static } from '@sinclair/typebox';

export const RevisionSegmentSchema = Type.Object(
  {
    type: Type.Union(
      [Type.Literal('equal'), Type.Literal('insert'), Type.Literal('delete')],
      {
        description:
          "Segment kind: 'equal' renders as normal text, 'insert' as a tracked insertion, 'delete' as a tracked deletion",
      }
    ),
    text: Type.String({
      description: 'Literal text of this segment (rendered without markdown)',
    }),
  },
  {
    description: 'A contiguous run of text sharing one revision state',
    additionalProperties: false,
  }
);

export const RevisionSchema = Type.Object(
  {
    author: Type.Optional(
      Type.String({
        description:
          'Revision author shown in Word (default: "json-to-office")',
      })
    ),
    date: Type.Optional(
      Type.String({
        format: 'date-time',
        description:
          'Revision timestamp (ISO 8601). Defaults to the Unix epoch for deterministic output',
      })
    ),
    segments: Type.Array(RevisionSegmentSchema, {
      minItems: 1,
      description:
        'Ordered text segments; concatenating equal+insert segments yields the new text, equal+delete the old text',
    }),
  },
  {
    description:
      'Tracked-change data: renders the component text as native Word revisions (accept/reject in Word)',
    additionalProperties: false,
  }
);

export type RevisionSegment = Static<typeof RevisionSegmentSchema>;
export type Revision = Static<typeof RevisionSchema>;

/**
 * A structural revision: an insertion or deletion of a whole element (a table
 * row, say) rather than a run of text.
 *
 * `RevisionSchema` cannot express this — it requires `segments` with at least
 * one entry, and a structural mark has no text of its own.
 */
export const RevisionMarkSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('insert'), Type.Literal('delete')], {
      description: 'Whether the element was inserted or deleted',
    }),
    author: Type.Optional(
      Type.String({
        description:
          'Revision author shown in Word (default: "json-to-office")',
      })
    ),
    date: Type.Optional(
      Type.String({
        format: 'date-time',
        description:
          'Revision timestamp (ISO 8601). Defaults to the Unix epoch for deterministic output',
      })
    ),
  },
  {
    description:
      'Structural tracked change: the element itself was inserted or deleted',
    additionalProperties: false,
  }
);

export type RevisionMark = Static<typeof RevisionMarkSchema>;

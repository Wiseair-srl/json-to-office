/**
 * Key-takeaways block.
 *
 * The first of the DOCX blocks: content components with bounded slots that
 * compile into the existing primitives, styled from the theme, so a report's
 * structure comes from data rather than from hand-built paragraphs. A block
 * says what it holds — here, three to five takeaways of a sentence each — and
 * the theme decides how that looks.
 *
 * The count is a schema bound so a violation is a path-addressed schema
 * error; the word budget is a quality finding (`W_QUALITY_SLOT_BUDGET`), since
 * a schema cannot count words and a long takeaway is a repair, not a refusal.
 */

import { Type, Static } from '@sinclair/typebox';

/** The slot budgets the compiler and the quality rules both read. */
export const KEY_TAKEAWAYS_BUDGET = {
  items: { min: 3, max: 5, maxWords: 25 },
} as const;

export const KeyTakeawaysPropsSchema = Type.Object(
  {
    items: Type.Array(
      Type.String({
        minLength: 1,
        description: `One takeaway: a single claim in one sentence, at most ${KEY_TAKEAWAYS_BUDGET.items.maxWords} words.`,
      }),
      {
        minItems: KEY_TAKEAWAYS_BUDGET.items.min,
        maxItems: KEY_TAKEAWAYS_BUDGET.items.max,
        description: `${KEY_TAKEAWAYS_BUDGET.items.min}–${KEY_TAKEAWAYS_BUDGET.items.max} takeaways, the messages a reader should leave with. Lead with the conclusion; keep each to one sentence.`,
      }
    ),
    label: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          'The box label (default "Key takeaways"). Keep it short; it is set in the theme\'s label role.',
      })
    ),
  },
  {
    description:
      "Key-takeaways block: 3–5 one-sentence takeaways under a label, drawn as the theme's takeaways recipe. Opens a document or a major section; never hand-build one from paragraphs.",
    additionalProperties: false,
  }
);

export type KeyTakeawaysProps = Static<typeof KeyTakeawaysPropsSchema>;

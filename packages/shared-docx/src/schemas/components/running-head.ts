/**
 * Running-head block.
 *
 * The page chrome of a report — a header with the document title and the
 * section tracker, a footer with the confidentiality line, the page as
 * `n / N` and the date — drawn as the theme's `runningHead` and
 * `confidentialFooter` recipes. Declared once, as a child of the first
 * section it should appear on: it fills that section's header and footer and
 * every later section's, and the tracker changes with each section's
 * `section-opener`. A section that authors its own `header` or `footer`, or
 * carries a `running-head` of its own, keeps what it wrote.
 *
 * Every slot is optional and one line: a block with no props draws the
 * document title and the page number, which is what most reports need.
 */

import { Type, Static } from '@sinclair/typebox';

/** The slot budgets the compiler and the quality rules both read. */
export const RUNNING_HEAD_BUDGET = {
  title: { maxWords: 12 },
  tracker: { maxWords: 6 },
  confidentiality: { maxWords: 6 },
  date: { maxWords: 6 },
} as const;

const oneLine = (description: string) =>
  Type.String({
    minLength: 1,
    pattern: '^[^\\r\\n]+$',
    description,
  });

export const RunningHeadPropsSchema = Type.Object(
  {
    title: Type.Optional(
      oneLine(
        `The header's left-hand text, at most ${RUNNING_HEAD_BUDGET.title.maxWords} words (default: the document's metadata.title).`
      )
    ),
    tracker: Type.Optional(
      oneLine(
        `The header's right-hand tracker for sections that have no section-opener, at most ${RUNNING_HEAD_BUDGET.tracker.maxWords} words. A section-opener's tracker (or title) wins for its section.`
      )
    ),
    confidentiality: Type.Optional(
      oneLine(
        `The footer's left-hand text ("Confidential"), at most ${RUNNING_HEAD_BUDGET.confidentiality.maxWords} words.`
      )
    ),
    date: Type.Optional(
      oneLine(
        `The footer's right-hand date as it should read ("September 2026"), at most ${RUNNING_HEAD_BUDGET.date.maxWords} words. Free text: the block never reformats it.`
      )
    ),
    pageNumbers: Type.Optional(
      Type.Boolean({
        description:
          'Draw the page as `n / N` in the footer centre (default true).',
      })
    ),
  },
  {
    description:
      "Running-head block: header (title, section tracker) and footer (confidentiality, page n / N, date) from the theme's chrome recipes, for this section and every later one. Declare it once, in the first section that should carry chrome; never hand-build page chrome from header paragraphs.",
    additionalProperties: false,
  }
);

export type RunningHeadProps = Static<typeof RunningHeadPropsSchema>;

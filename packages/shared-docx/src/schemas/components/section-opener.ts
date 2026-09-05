/**
 * Section-opener block.
 *
 * What starts a major section of a report: a number, a title and the tracker
 * label the running head shows while the section lasts. The title lowers to a
 * level-1 heading, so a table of contents, cross-references and heading
 * numbering see it as the heading it is; the number is drawn above it in the
 * theme's eyebrow role; the tracker is never drawn in the flow — it is what
 * the `running-head` block in force reads for the enclosing section.
 */

import { Type, Static } from '@sinclair/typebox';
import { oneLineText } from './common';

/** The slot budgets the compiler and the quality rules both read. */
export const SECTION_OPENER_BUDGET = {
  title: { maxWords: 12 },
  tracker: { maxWords: 6 },
} as const;

export const SectionOpenerPropsSchema = Type.Object(
  {
    number: Type.Optional(
      Type.Union(
        [
          oneLineText(
            'The section number as it should read ("02", "Part II"). Drawn as an eyebrow above the title.'
          ),
          Type.Integer({ minimum: 0 }),
        ],
        {
          description:
            'The section number, as text ("02", "Part II") or an integer. Drawn as an eyebrow above the title; omit it for an unnumbered section.',
        }
      )
    ),
    title: oneLineText(
      `The section title, one line, at most ${SECTION_OPENER_BUDGET.title.maxWords} words. Say what the section concludes, not what it contains.`
    ),
    tracker: Type.Optional(
      oneLineText(
        `The label the running head shows for this section, at most ${SECTION_OPENER_BUDGET.tracker.maxWords} words (default: the title).`
      )
    ),
    pageBreak: Type.Optional(
      Type.Boolean({
        description:
          'Start the section on a new page (default false). Leave it off when the opener is the first thing in a docx `section`, which already starts one.',
      })
    ),
  },
  {
    description:
      'Section-opener block: number, title and running-head tracker label for a major section. The title is a level-1 heading; the tracker feeds the running head. Never hand-build one from a paragraph and a heading.',
    additionalProperties: false,
  }
);

export type SectionOpenerProps = Static<typeof SectionOpenerPropsSchema>;

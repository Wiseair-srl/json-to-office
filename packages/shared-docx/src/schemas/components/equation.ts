/**
 * Equation Component Schema
 *
 * A display equation: a formula on a line of its own, written as LaTeX and
 * drawn as Word's own equation (`m:oMath`), the kind Word's equation editor
 * makes and a reader can click into and edit.
 *
 * LaTeX rather than a JSON tree of fractions and scripts because it is what
 * authors — and the agents writing for them — already write formulas in, and
 * because docx's `latexToMath` turns it into the same `Math*` components a
 * tree would build, so nothing goes around the renderer. A formula inside a
 * sentence is written in the text itself, between `\(` and `\)`.
 */

import { Type, Static } from '@sinclair/typebox';
import { SpacingSchema } from './common';

export const EquationPropsSchema = Type.Object(
  {
    latex: Type.String({
      minLength: 1,
      description:
        'The formula in LaTeX math, e.g. "x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}" (every backslash doubled in JSON). Fractions, scripts, roots, sums, integrals, \\left/\\right brackets, accents, \\mathbb/\\mathrm fonts, \\text, Greek letters, matrices, cases and aligned environments are supported; \\tag{1} numbers the equation. Surrounding $…$, $$…$$, \\(…\\) or \\[…\\] are optional. Colours, sizes and manual spacing are left to Word.',
    }),
    alignment: Type.Optional(
      Type.Union(
        [Type.Literal('left'), Type.Literal('center'), Type.Literal('right')],
        {
          description:
            'Where the equation sits across the measure (default "center").',
        }
      )
    ),
    spacing: Type.Optional(SpacingSchema),
  },
  {
    description:
      "Display equation — a formula on its own line, written as LaTeX and drawn as Word's native equation, so it stays editable in Word's equation editor.",
    additionalProperties: false,
  }
);

export type EquationProps = Static<typeof EquationPropsSchema>;

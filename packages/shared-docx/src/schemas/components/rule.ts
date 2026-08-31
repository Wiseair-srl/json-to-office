/**
 * Rule Component Schema
 *
 * A horizontal rule: the thin line a brand system draws between sections.
 *
 * Word has no rule element — it draws one as a paragraph border (`w:pBdr`) on
 * an empty paragraph whose line box is collapsed so the paragraph costs no
 * more height than the line itself. That is degenerate text geometry, and
 * authoring it by hand is what `W_QUALITY_LINE_BOX_COLLAPSE` reports: the
 * observed route to a 3pt rule was an 8pt paragraph with a 1pt exact line box,
 * which renders as a smear the moment anyone puts text in it. This component
 * owns that construction so nobody has to reach for it.
 */

import { Type, Static } from '@sinclair/typebox';
import { SpacingSchema } from './common';
import { HexColorSchema } from '../font';

export const RulePropsSchema = Type.Object(
  {
    thickness: Type.Optional(
      Type.Number({
        minimum: 0.25,
        maximum: 12,
        description:
          'Line weight in points (default 1). OOXML measures a border in eighths of a point and Word stops at 12pt, so this is the whole usable range.',
      })
    ),
    color: Type.Optional(HexColorSchema),
    style: Type.Optional(
      Type.Union(
        [
          Type.Literal('solid'),
          Type.Literal('dashed'),
          Type.Literal('dotted'),
          Type.Literal('double'),
        ],
        {
          description:
            'Line style (default "solid"). `double` draws two lines and is measured per line, so it reads about twice as tall as its thickness.',
        }
      )
    ),
    width: Type.Optional(
      Type.Union(
        [
          Type.Number({
            minimum: 1,
            description: 'Rule width in points',
          }),
          Type.String({
            pattern: '^\\d+(\\.\\d+)?%$',
            description:
              'Rule width as a percentage of the text measure (e.g. "40%")',
          }),
        ],
        {
          description:
            'How far the rule runs (default: the full text measure). A percentage or a point width is turned into paragraph indents, resolved against the theme page — so a partial rule inside a column or a re-margined section is measured against the page, while the default full-measure rule is exact everywhere.',
        }
      )
    ),
    alignment: Type.Optional(
      Type.Union(
        [Type.Literal('left'), Type.Literal('center'), Type.Literal('right')],
        {
          description:
            'Which end of the measure a partial rule sits at (default "left"). Ignored at full width.',
        }
      )
    ),
    spacing: Type.Optional(SpacingSchema),
  },
  {
    description:
      'Horizontal rule — a thin line across the measure, drawn as a Word paragraph border so it stays editable in Word.',
    additionalProperties: false,
  }
);

export type RuleProps = Static<typeof RulePropsSchema>;

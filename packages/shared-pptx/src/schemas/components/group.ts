/**
 * Group Component Schema (PPTX)
 *
 * A transparent container, and the inspectable result of block expansion. With
 * no frame it is a plain sequence: its children position exactly as they would
 * on the slide. With a frame it is a nested coordinate system, and with a
 * `direction` it distributes its children into equal or weighted cells — the
 * engine operation a two-to-four metric row or a two-column split needs, so
 * that adapting to a count never requires a plugin.
 */

import { Type, Static } from '@sinclair/typebox';
import { GridPositionSchema } from '@json-to-office/shared/schemas/slide-content';
import { GridConfigSchema } from '../theme';

const Coord = (inches: string, percent: string) =>
  Type.Union([
    Type.Number({ description: inches }),
    Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: percent }),
  ]);

export const PptxGroupPropsSchema = Type.Object(
  {
    x: Type.Optional(
      Coord(
        'Frame left edge in inches, relative to the enclosing frame or slide',
        'Frame left edge as a percentage of the enclosing width'
      )
    ),
    y: Type.Optional(
      Coord(
        'Frame top edge in inches, relative to the enclosing frame or slide',
        'Frame top edge as a percentage of the enclosing height'
      )
    ),
    w: Type.Optional(
      Coord(
        'Frame width in inches',
        'Frame width as a percentage of the enclosing width'
      )
    ),
    h: Type.Optional(
      Coord(
        'Frame height in inches',
        'Frame height as a percentage of the enclosing height'
      )
    ),
    grid: Type.Optional(GridPositionSchema),
    gridConfig: Type.Optional(
      Type.Object(
        { ...GridConfigSchema.properties },
        {
          additionalProperties: false,
          description:
            'Grid used for grid placements of this group’s descendants, merged over the enclosing grid field by field. Inside a frame the grid spans the frame.',
        }
      )
    ),
    direction: Type.Optional(
      Type.Union([Type.Literal('row'), Type.Literal('column')], {
        description:
          'Distribute the children into cells along this axis: equal cells, or weighted by `weights`. Each child fills its cell unless it states its own offsets; an omitted optional child simply redistributes the rest.',
      })
    ),
    gap: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Space between distributed cells, in inches. Default 0.',
      })
    ),
    weights: Type.Optional(
      Type.Array(Type.Number({ exclusiveMinimum: 0 }), {
        minItems: 1,
        description:
          'Relative cell sizes in child order (e.g. [1.1, 1] for a 1.1 : 1 split). Missing entries count as 1.',
      })
    ),
  },
  {
    additionalProperties: false,
    description:
      'Transparent group. Without a frame, a plain sequence of slide content; with `x`/`y`/`w`/`h` or `grid`, a frame its children position within (numbers are offsets in inches, percentages are fractions of the frame, omitted values fill it); with `direction`, a row or column that distributes its children into cells.',
  }
);

export type PptxGroupProps = Static<typeof PptxGroupPropsSchema>;

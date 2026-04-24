/**
 * Table Component Schema (PPTX)
 */

import { Type, Static } from '@sinclair/typebox';
import { PptxAlignmentSchema, VerticalAlignmentSchema, GridPositionSchema } from './common';

const PptxTableCellSchema = Type.Union([
  Type.String({ description: 'Simple text cell' }),
  Type.Object(
    {
      text: Type.String({ description: 'Cell text content' }),
      color: Type.Optional(Type.String({ description: 'Text color (hex without #)' })),
      fill: Type.Optional(Type.String({ description: 'Cell background color (hex without #)' })),
      fontSize: Type.Optional(Type.Number({ description: 'Font size in points' })),
      fontFace: Type.Optional(Type.String({ description: 'Font family' })),
      bold: Type.Optional(Type.Boolean({ description: 'Bold text' })),
      fontWeight: Type.Optional(
        Type.Integer({
          minimum: 100,
          maximum: 900,
          description: 'Per-cell weight (100–900). Overrides `bold` when set.',
        })
      ),
      italic: Type.Optional(Type.Boolean({ description: 'Italic text' })),
      align: Type.Optional(PptxAlignmentSchema),
      valign: Type.Optional(VerticalAlignmentSchema),
      colspan: Type.Optional(Type.Number({ minimum: 1, description: 'Column span' })),
      rowspan: Type.Optional(Type.Number({ minimum: 1, description: 'Row span' })),
      margin: Type.Optional(
        Type.Union([
          Type.Number({ description: 'Margin in points (all sides)' }),
          Type.Array(Type.Number(), { minItems: 4, maxItems: 4 }),
        ])
      ),
    },
    { additionalProperties: false }
  ),
]);

export const PptxTablePropsSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Array(PptxTableCellSchema, { description: 'Row of cells' }),
      { description: 'Table rows (array of arrays)', minItems: 1 }
    ),
    x: Type.Optional(
      Type.Union([
        Type.Number({ description: 'X position in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'X as percentage' }),
      ])
    ),
    y: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Y position in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'Y as percentage' }),
      ])
    ),
    w: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Width in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'Width as percentage' }),
      ])
    ),
    h: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Height in inches' }),
        Type.String({ pattern: '^\\d+(\\.\\d+)?%$', description: 'Height as percentage' }),
      ])
    ),
    colW: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Uniform column width in inches' }),
        Type.Array(Type.Number(), { description: 'Individual column widths in inches' }),
      ])
    ),
    rowH: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Uniform row height in inches' }),
        Type.Array(Type.Number(), { description: 'Individual row heights in inches' }),
      ])
    ),
    border: Type.Optional(
      Type.Object(
        {
          type: Type.Optional(
            Type.Union([
              Type.Literal('solid'),
              Type.Literal('dash'),
              Type.Literal('dot'),
              Type.Literal('none'),
            ])
          ),
          pt: Type.Optional(Type.Number({ minimum: 0, description: 'Border width in points' })),
          color: Type.Optional(Type.String({ description: 'Border color (hex without #)' })),
        },
        { additionalProperties: false }
      )
    ),
    fill: Type.Optional(Type.String({ description: 'Table background color (hex without #)' })),
    fontSize: Type.Optional(Type.Number({ minimum: 1, description: 'Default font size for all cells' })),
    fontFace: Type.Optional(Type.String({ description: 'Default font family for all cells' })),
    color: Type.Optional(Type.String({ description: 'Default text color for all cells (hex without #)' })),
    align: Type.Optional(PptxAlignmentSchema),
    valign: Type.Optional(VerticalAlignmentSchema),
    autoPage: Type.Optional(
      Type.Boolean({ description: 'Auto-paginate table across multiple slides when content overflows' })
    ),
    autoPageRepeatHeader: Type.Optional(
      Type.Boolean({ description: 'Repeat first row as header on each auto-paged slide' })
    ),
    margin: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Cell margin in points (all sides)' }),
        Type.Array(Type.Number(), { minItems: 4, maxItems: 4 }),
      ])
    ),
    borderRadius: Type.Optional(
      Type.Number({ minimum: 0, description: 'Rounded corner radius in inches. Renders a roundRect shape behind the table.' })
    ),
    grid: Type.Optional(GridPositionSchema),
  },
  {
    description: 'PPTX table component props',
    additionalProperties: false,
  }
);

export type PptxTableProps = Static<typeof PptxTablePropsSchema>;

/**
 * Table Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { HexColorSchema } from '../font';

// Define Cell type - can be plain text or a component definition
const CellContentSchema = Type.Recursive((This) =>
  Type.Union([
    Type.String(),
    Type.Object(
      {
        name: Type.String(),
        props: Type.Object({}, { additionalProperties: true }),
        children: Type.Optional(Type.Array(This)),
      },
      { additionalProperties: false }
    ),
  ])
);

// Horizontal alignment schema
const HorizontalAlignmentSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('justify'),
  ],
  { description: 'Horizontal text alignment' }
);

// Vertical alignment schema
const VerticalAlignmentSchema = Type.Union(
  [Type.Literal('top'), Type.Literal('middle'), Type.Literal('bottom')],
  { description: 'Vertical cell alignment' }
);

// Font configuration schema
const FontConfigSchema = Type.Object({
  family: Type.Optional(Type.String({ description: 'Font family name' })),
  size: Type.Optional(
    Type.Number({ minimum: 0, description: 'Font size in points' })
  ),
  bold: Type.Optional(Type.Boolean({ description: 'Bold text' })),
  italic: Type.Optional(Type.Boolean({ description: 'Italic text' })),
  underline: Type.Optional(Type.Boolean({ description: 'Underlined text' })),
});

// Border color - can be a single string or an object with sides
const BorderColorSchema = Type.Union([
  Type.String({ description: 'Border color for all sides (hex without #)' }),
  Type.Object({
    bottom: Type.Optional(
      Type.String({ description: 'Bottom border color (hex without #)' })
    ),
    top: Type.Optional(
      Type.String({ description: 'Top border color (hex without #)' })
    ),
    right: Type.Optional(
      Type.String({ description: 'Right border color (hex without #)' })
    ),
    left: Type.Optional(
      Type.String({ description: 'Left border color (hex without #)' })
    ),
  }),
]);

// Border size - can be a single number or an object with sides
const BorderSizeSchema = Type.Union([
  Type.Number({
    minimum: 0,
    description: 'Border size for all sides in points',
  }),
  Type.Object({
    bottom: Type.Optional(
      Type.Number({ minimum: 0, description: 'Bottom border size in points' })
    ),
    top: Type.Optional(
      Type.Number({ minimum: 0, description: 'Top border size in points' })
    ),
    right: Type.Optional(
      Type.Number({ minimum: 0, description: 'Right border size in points' })
    ),
    left: Type.Optional(
      Type.Number({ minimum: 0, description: 'Left border size in points' })
    ),
  }),
]);

// Hide borders - can be a boolean or an object with sides
const HideBordersSchema = Type.Union([
  Type.Boolean({
    description: 'Hide all borders when true',
  }),
  Type.Object(
    {
      bottom: Type.Optional(
        Type.Boolean({ description: 'Hide bottom border' })
      ),
      top: Type.Optional(Type.Boolean({ description: 'Hide top border' })),
      right: Type.Optional(Type.Boolean({ description: 'Hide right border' })),
      left: Type.Optional(Type.Boolean({ description: 'Hide left border' })),
      insideHorizontal: Type.Optional(
        Type.Boolean({ description: 'Hide horizontal borders between rows' })
      ),
      insideVertical: Type.Optional(
        Type.Boolean({ description: 'Hide vertical borders between columns' })
      ),
    },
    { description: 'Selectively hide specific borders' }
  ),
]);

// Padding - can be a single number or an object with sides
const PaddingSchema = Type.Union([
  Type.Number({ minimum: 0, description: 'Padding for all sides in points' }),
  Type.Object({
    bottom: Type.Optional(
      Type.Number({ minimum: 0, description: 'Bottom padding in points' })
    ),
    top: Type.Optional(
      Type.Number({ minimum: 0, description: 'Top padding in points' })
    ),
    right: Type.Optional(
      Type.Number({ minimum: 0, description: 'Right padding in points' })
    ),
    left: Type.Optional(
      Type.Number({ minimum: 0, description: 'Left padding in points' })
    ),
  }),
]);

// Cell defaults configuration
const CellDefaultsSchema = Type.Object({
  color: Type.Optional(HexColorSchema),
  backgroundColor: Type.Optional(HexColorSchema),
  horizontalAlignment: Type.Optional(HorizontalAlignmentSchema),
  verticalAlignment: Type.Optional(VerticalAlignmentSchema),
  font: Type.Optional(FontConfigSchema),
  borderColor: Type.Optional(BorderColorSchema),
  borderSize: Type.Optional(BorderSizeSchema),
  padding: Type.Optional(PaddingSchema),
  height: Type.Optional(
    Type.Number({ minimum: 0, description: 'Cell height in points' })
  ),
});

// Header schema - includes all CellDefaults properties plus content
const HeaderSchema = Type.Object({
  color: Type.Optional(HexColorSchema),
  backgroundColor: Type.Optional(HexColorSchema),
  horizontalAlignment: Type.Optional(HorizontalAlignmentSchema),
  verticalAlignment: Type.Optional(VerticalAlignmentSchema),
  font: Type.Optional(FontConfigSchema),
  borderColor: Type.Optional(BorderColorSchema),
  borderSize: Type.Optional(BorderSizeSchema),
  padding: Type.Optional(PaddingSchema),
  height: Type.Optional(
    Type.Number({ minimum: 0, description: 'Cell height in points' })
  ),
  content: Type.Optional(CellContentSchema),
});

// Cell schema - includes all CellDefaults properties plus content
const CellSchema = Type.Object({
  color: Type.Optional(HexColorSchema),
  backgroundColor: Type.Optional(HexColorSchema),
  horizontalAlignment: Type.Optional(HorizontalAlignmentSchema),
  verticalAlignment: Type.Optional(VerticalAlignmentSchema),
  font: Type.Optional(FontConfigSchema),
  borderColor: Type.Optional(BorderColorSchema),
  borderSize: Type.Optional(BorderSizeSchema),
  padding: Type.Optional(PaddingSchema),
  height: Type.Optional(
    Type.Number({ minimum: 0, description: 'Cell height in points' })
  ),
  content: Type.Optional(CellContentSchema),
});

// Column schema with new structure
const ColumnSchema = Type.Object({
  width: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        'Column width in points. When set on some columns, remaining columns will automatically share the leftover table space equally. Leave undefined to distribute space evenly among unspecified columns.',
    })
  ),
  cellDefaults: Type.Optional(CellDefaultsSchema),
  header: Type.Optional(HeaderSchema),
  cells: Type.Optional(Type.Array(CellSchema)),
});

export const TablePropsSchema = Type.Object(
  {
    borderColor: Type.Optional(BorderColorSchema),
    borderSize: Type.Optional(BorderSizeSchema),
    hideBorders: Type.Optional(HideBordersSchema),
    cellDefaults: Type.Optional(CellDefaultsSchema),
    headerCellDefaults: Type.Optional(CellDefaultsSchema),
    width: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 100,
        description: 'Table width in percentage (0-100)',
      })
    ),
    columns: Type.Array(ColumnSchema, {
      description: 'Table columns with headers and cells',
      minItems: 1,
    }),
    keepInOnePage: Type.Optional(
      Type.Boolean({
        description:
          'Keep table rows together on the same page by setting keepNext on all paragraphs',
      })
    ),
    keepNext: Type.Optional(
      Type.Boolean({
        description:
          'Set keepNext on the last row to keep it connected to the next element. Works independently of keepInOnePage. Defaults to false.',
      })
    ),
    repeatHeaderOnPageBreak: Type.Optional(
      Type.Boolean({
        description:
          'Repeat the header row on each page when the table spans multiple pages. Defaults to false.',
        default: true,
      })
    ),
  },
  {
    description: 'Table component props with column-based structure',
  }
);

export type TableProps = Static<typeof TablePropsSchema>;

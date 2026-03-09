/**
 * PPTX Theme Schema
 * Simplified theme configuration for presentations
 */
import { Type, Static } from '@sinclair/typebox';

export const GridMarginSchema = Type.Union(
  [
    Type.Number({ description: 'Margin in inches (all sides)' }),
    Type.Object(
      {
        top: Type.Number({ description: 'Top margin in inches' }),
        right: Type.Number({ description: 'Right margin in inches' }),
        bottom: Type.Number({ description: 'Bottom margin in inches' }),
        left: Type.Number({ description: 'Left margin in inches' }),
      },
      { additionalProperties: false }
    ),
  ],
  { description: 'Slide margins in inches' }
);

export const GridGutterSchema = Type.Union(
  [
    Type.Number({ description: 'Gutter in inches (both axes)' }),
    Type.Object(
      {
        column: Type.Number({ description: 'Column gutter in inches' }),
        row: Type.Number({ description: 'Row gutter in inches' }),
      },
      { additionalProperties: false }
    ),
  ],
  { description: 'Gaps between grid tracks in inches' }
);

export const GridConfigSchema = Type.Object(
  {
    columns: Type.Optional(Type.Number({ minimum: 1, description: 'Number of columns (default: 12)' })),
    rows: Type.Optional(Type.Number({ minimum: 1, description: 'Number of rows (default: 6)' })),
    margin: Type.Optional(GridMarginSchema),
    gutter: Type.Optional(GridGutterSchema),
  },
  { additionalProperties: false, description: 'Grid layout configuration' }
);

export type GridMargin = Static<typeof GridMarginSchema>;
export type GridGutter = Static<typeof GridGutterSchema>;
export type GridConfig = Static<typeof GridConfigSchema>;

const HexColorSchema = Type.String({ pattern: '^#?[0-9A-Fa-f]{6}$', description: 'Hex color (e.g. #FF0000)' });

export const ThemeConfigSchema = Type.Object(
  {
    name: Type.String({ description: 'Theme name' }),
    colors: Type.Object(
      {
        primary: HexColorSchema,
        secondary: HexColorSchema,
        accent: HexColorSchema,
        background: HexColorSchema,
        text: HexColorSchema,
      },
      { additionalProperties: false, description: 'Theme color palette' }
    ),
    fonts: Type.Object(
      {
        heading: Type.String({ description: 'Heading font family' }),
        body: Type.String({ description: 'Body font family' }),
      },
      { additionalProperties: false, description: 'Font families' }
    ),
    defaults: Type.Object(
      {
        fontSize: Type.Number({ description: 'Default font size in points' }),
        fontColor: HexColorSchema,
      },
      { additionalProperties: false, description: 'Default text styling' }
    ),
    grid: Type.Optional(GridConfigSchema),
  },
  { additionalProperties: false, description: 'Presentation theme configuration' }
);

export type ThemeConfigJson = Static<typeof ThemeConfigSchema>;

export function isValidThemeConfig(data: unknown): data is ThemeConfigJson {
  return typeof data === 'object' && data !== null;
}

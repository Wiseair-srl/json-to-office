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

export const ThemeConfigSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ description: 'Theme name' })),
    colors: Type.Optional(
      Type.Object(
        {
          primary: Type.Optional(Type.String()),
          secondary: Type.Optional(Type.String()),
          accent: Type.Optional(Type.String()),
          background: Type.Optional(Type.String()),
          text: Type.Optional(Type.String()),
        },
        { additionalProperties: true }
      )
    ),
    fonts: Type.Optional(
      Type.Object(
        {
          heading: Type.Optional(Type.String()),
          body: Type.Optional(Type.String()),
        },
        { additionalProperties: true }
      )
    ),
    defaults: Type.Optional(
      Type.Object(
        {
          fontSize: Type.Optional(Type.Number()),
          fontColor: Type.Optional(Type.String()),
        },
        { additionalProperties: true }
      )
    ),
    slide: Type.Optional(
      Type.Object(
        {
          width: Type.Optional(Type.Number()),
          height: Type.Optional(Type.Number()),
        },
        { additionalProperties: true }
      )
    ),
    grid: Type.Optional(GridConfigSchema),
  },
  { additionalProperties: true, description: 'Presentation theme configuration' }
);

export type ThemeConfigJson = Static<typeof ThemeConfigSchema>;

export function isValidThemeConfig(data: unknown): data is ThemeConfigJson {
  return typeof data === 'object' && data !== null;
}

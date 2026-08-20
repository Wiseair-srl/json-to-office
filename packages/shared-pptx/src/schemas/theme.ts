/**
 * PPTX Theme Schema
 * Simplified theme configuration for presentations
 */
import { Type, Static } from '@sinclair/typebox';
import {
  FontFamilyNameSchema,
  FontRegistrySchema,
} from '@json-to-office/shared';
import {
  ColorValueSchema,
  STYLE_NAMES,
} from '@json-to-office/shared/schemas/slide-content';
import { PptxComponentDefaultsSchema } from './component-defaults';

export {
  ColorValueSchema,
  SEMANTIC_COLOR_NAMES,
  SEMANTIC_COLOR_ALIASES,
  STYLE_NAMES,
  StyleNameSchema,
} from '@json-to-office/shared/schemas/slide-content';
export type { StyleName } from '@json-to-office/shared/schemas/slide-content';

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
    columns: Type.Optional(
      Type.Number({
        minimum: 1,
        description: 'Number of columns (default: 12)',
      })
    ),
    rows: Type.Optional(
      Type.Number({ minimum: 1, description: 'Number of rows (default: 6)' })
    ),
    margin: Type.Optional(GridMarginSchema),
    gutter: Type.Optional(GridGutterSchema),
  },
  { additionalProperties: false, description: 'Grid layout configuration' }
);

export type GridMargin = Static<typeof GridMarginSchema>;
export type GridGutter = Static<typeof GridGutterSchema>;
export type GridConfig = Static<typeof GridConfigSchema>;

const HexColorSchema = Type.String({
  pattern: '^#?[0-9A-Fa-f]{6}$',
  description: 'Hex color (e.g. #FF0000)',
});

export const TextStyleSchema = Type.Object(
  {
    fontSize: Type.Optional(Type.Number()),
    fontFace: Type.Optional(FontFamilyNameSchema),
    fontColor: Type.Optional(ColorValueSchema),
    bold: Type.Optional(Type.Boolean()),
    fontWeight: Type.Optional(Type.Integer({ minimum: 100, maximum: 900 })),
    italic: Type.Optional(Type.Boolean()),
    align: Type.Optional(
      Type.Union([
        Type.Literal('left'),
        Type.Literal('center'),
        Type.Literal('right'),
        Type.Literal('justify'),
      ])
    ),
    lineSpacing: Type.Optional(Type.Number()),
    charSpacing: Type.Optional(Type.Number()),
    paraSpaceAfter: Type.Optional(Type.Number()),
  },
  { additionalProperties: false, description: 'Text style preset' }
);

export type TextStyle = Static<typeof TextStyleSchema>;

// ── Theme config ───────────────────────────────────────────────────

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
        text2: Type.Optional(HexColorSchema),
        background2: Type.Optional(HexColorSchema),
        accent4: Type.Optional(HexColorSchema),
        accent5: Type.Optional(HexColorSchema),
        accent6: Type.Optional(HexColorSchema),
      },
      {
        additionalProperties: false,
        description: 'Theme color palette (10-slot scheme)',
      }
    ),
    fonts: Type.Object(
      {
        heading: FontFamilyNameSchema,
        body: FontFamilyNameSchema,
      },
      { additionalProperties: false, description: 'Font families' }
    ),
    fontRegistry: Type.Optional(FontRegistrySchema),
    defaults: Type.Object(
      {
        fontSize: Type.Number({ description: 'Default font size in points' }),
        fontColor: HexColorSchema,
      },
      { additionalProperties: false, description: 'Default text styling' }
    ),
    styles: Type.Optional(
      Type.Partial(
        Type.Object(
          Object.fromEntries(
            STYLE_NAMES.map((n) => [n, TextStyleSchema])
          ) as Record<string, typeof TextStyleSchema>
        ),
        { additionalProperties: false, description: 'Named text style presets' }
      )
    ),
    componentDefaults: Type.Optional(PptxComponentDefaultsSchema),
  },
  {
    additionalProperties: false,
    description: 'Presentation theme configuration',
  }
);

export type ThemeConfigJson = Static<typeof ThemeConfigSchema>;

export function isValidThemeConfig(data: unknown): data is ThemeConfigJson {
  return typeof data === 'object' && data !== null;
}

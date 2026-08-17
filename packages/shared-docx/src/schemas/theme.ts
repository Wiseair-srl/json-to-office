/**
 * Theme Schema Definitions using TypeBox
 * This file provides TypeBox schemas for theme configuration validation
 */

import { Type, Static } from '@sinclair/typebox';
import {
  FontDefinitionSchema,
  TextFormattingPropertiesSchema,
  HexColorSchema,
} from './font';
import { IndentSchema } from './components/common';

// ============================================================================
// Document Margins Schema
// ============================================================================

export const DocumentMarginsSchema = Type.Object(
  {
    top: Type.Number({ minimum: 0 }),
    bottom: Type.Number({ minimum: 0 }),
    left: Type.Number({ minimum: 0 }),
    right: Type.Number({ minimum: 0 }),
    header: Type.Number({ minimum: 0 }),
    footer: Type.Number({ minimum: 0 }),
    gutter: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false, description: 'Document margin configuration' }
);

// ============================================================================
// Page Dimensions Schema
// ============================================================================

export const PageDimensionsSchema = Type.Object(
  {
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false, description: 'Page dimensions in twips' }
);

// ============================================================================
// Page Schema (replaces PageSetupSchema)
// ============================================================================

export const PageSchema = Type.Object(
  {
    size: Type.Union(
      [
        Type.Literal('A4'),
        Type.Literal('A3'),
        Type.Literal('LETTER'),
        Type.Literal('LEGAL'),
        Type.Object(
          {
            width: Type.Number({ minimum: 0 }),
            height: Type.Number({ minimum: 0 }),
          },
          { additionalProperties: false }
        ),
      ],
      { description: 'Standard page size or custom dimensions' }
    ),
    margins: DocumentMarginsSchema,
  },
  {
    description: 'Page configuration including dimensions and margins',
    additionalProperties: false,
  }
);

// ============================================================================
// Text formatting and font schemas now imported from './font' to avoid cycles

// ============================================================================
// Fonts Schema
// ============================================================================

export const FontsSchema = Type.Object(
  {
    heading: FontDefinitionSchema,
    body: FontDefinitionSchema,
    mono: FontDefinitionSchema,
    light: FontDefinitionSchema,
  },
  {
    additionalProperties: false,
    description: 'Font definitions for different text types',
  }
);

// ============================================================================
// Style Definitions Schema
// ============================================================================

// Paragraph border style support (matches docx BorderStyle)
const BorderStyleSchema = Type.Union(
  [
    Type.Literal('single'),
    Type.Literal('dashDotStroked'),
    Type.Literal('dashed'),
    Type.Literal('dashSmallGap'),
    Type.Literal('dotDash'),
    Type.Literal('dotDotDash'),
    Type.Literal('dotted'),
    Type.Literal('double'),
    Type.Literal('doubleWave'),
    Type.Literal('inset'),
    Type.Literal('nil'),
    Type.Literal('none'),
    Type.Literal('outset'),
    Type.Literal('thick'),
    Type.Literal('thickThinLargeGap'),
    Type.Literal('thickThinMediumGap'),
    Type.Literal('thickThinSmallGap'),
    Type.Literal('thinThickLargeGap'),
    Type.Literal('thinThickMediumGap'),
    Type.Literal('thinThickSmallGap'),
    Type.Literal('thinThickThinLargeGap'),
    Type.Literal('thinThickThinMediumGap'),
    Type.Literal('thinThickThinSmallGap'),
    Type.Literal('threeDEmboss'),
    Type.Literal('threeDEngrave'),
    Type.Literal('triple'),
    Type.Literal('wave'),
  ],
  { description: 'Paragraph border style' }
);

const BorderDefinitionSchema = Type.Object(
  {
    style: BorderStyleSchema,
    size: Type.Number({
      minimum: 0,
      description: 'Width in eighths of a point (docx sz)',
    }),
    color: HexColorSchema,
    space: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Space between text and border in points',
      })
    ),
  },
  {
    additionalProperties: false,
    description: 'Paragraph border side definition',
  }
);

const BordersSchema = Type.Object(
  {
    top: Type.Optional(BorderDefinitionSchema),
    bottom: Type.Optional(BorderDefinitionSchema),
    left: Type.Optional(BorderDefinitionSchema),
    right: Type.Optional(BorderDefinitionSchema),
  },
  { additionalProperties: false, description: 'Paragraph borders (per side)' }
);

// Alignment schema for paragraph-level alignment (used in styles)
const AlignmentSchema = Type.Optional(
  Type.Union([
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('justify'),
  ])
);

/**
 * Style properties schema that extends text formatting properties
 * with additional style-specific properties (priority, baseStyle, etc.)
 */
const StylePropertiesSchema = Type.Object(
  {
    font: Type.Optional(
      Type.Union([
        Type.Literal('heading'),
        Type.Literal('body'),
        Type.Literal('mono'),
        Type.Literal('light'),
      ])
    ),
    ...TextFormattingPropertiesSchema.properties,
    // Paragraph-level alignment (not a font property)
    alignment: AlignmentSchema,
    // Additional properties specific to styles
    priority: Type.Optional(Type.Number()),
    baseStyle: Type.Optional(Type.String()),
    followingStyle: Type.Optional(Type.String()),
    widowControl: Type.Optional(Type.Boolean()),
    keepNext: Type.Optional(Type.Boolean()),
    keepLinesTogether: Type.Optional(Type.Boolean()),
    outlineLevel: Type.Optional(Type.Number()),
    borders: Type.Optional(BordersSchema),
    indent: Type.Optional(IndentSchema),
  },
  { additionalProperties: false }
);

// ============================================================================
// Tab Stop Schema
// ============================================================================

/**
 * Tab stop leader types matching docx.js LeaderType
 */
const TabStopLeaderSchema = Type.Union(
  [
    Type.Literal('dot'),
    Type.Literal('hyphen'),
    Type.Literal('middleDot'),
    Type.Literal('none'),
    Type.Literal('underscore'),
  ],
  {
    description:
      'Tab leader style: dot (dotted), hyphen (dashed), middleDot, none (blank), or underscore',
  }
);

/**
 * Tab stop type matching docx.js TabStopType
 */
const TabStopTypeSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('right'),
    Type.Literal('center'),
    Type.Literal('bar'),
    Type.Literal('clear'),
    Type.Literal('decimal'),
    Type.Literal('end'),
    Type.Literal('num'),
    Type.Literal('start'),
  ],
  {
    description: 'Tab stop alignment type',
  }
);

/**
 * Tab stop definition schema
 */
const TabStopDefinitionSchema = Type.Object(
  {
    type: TabStopTypeSchema,
    position: Type.Union([
      Type.Number({
        description:
          'Tab stop position in twips (1/1440 inch). Common: 9026 for right-aligned at page margin',
      }),
      Type.Literal('max', {
        description: 'Use maximum position (TabStopPosition.MAX = 9026 twips)',
      }),
    ]),
    leader: Type.Optional(TabStopLeaderSchema),
  },
  {
    description:
      'Tab stop configuration with position, alignment, and optional leader',
    additionalProperties: false,
  }
);

/**
 * TOC style properties schema that extends text formatting properties
 * but EXCLUDES baseStyle to prevent unwanted coupling with Heading styles
 */
const TocStylePropertiesSchema = Type.Object(
  {
    font: Type.Optional(
      Type.Union([
        Type.Literal('heading'),
        Type.Literal('body'),
        Type.Literal('mono'),
        Type.Literal('light'),
      ])
    ),
    ...TextFormattingPropertiesSchema.properties,
    // Paragraph-level alignment (not a font property)
    alignment: AlignmentSchema,
    // Tab stops for controlling TOC entry formatting (leader dots, alignment, etc.)
    tabStops: Type.Optional(
      Type.Array(TabStopDefinitionSchema, {
        description:
          'Tab stops for TOC entries. Use right-aligned tab with leader to create dotted lines to page numbers.',
        default: [{ type: 'right', position: 'max', leader: 'none' }],
      })
    ),
    // Additional properties specific to styles (baseStyle intentionally excluded)
    priority: Type.Optional(Type.Number()),
    followingStyle: Type.Optional(Type.String()),
    widowControl: Type.Optional(Type.Boolean()),
    keepNext: Type.Optional(Type.Boolean()),
    keepLinesTogether: Type.Optional(Type.Boolean()),
    outlineLevel: Type.Optional(Type.Number()),
    borders: Type.Optional(BordersSchema),
    indent: Type.Optional(IndentSchema),
  },
  { additionalProperties: false }
);

export const StyleDefinitionsSchema = Type.Object(
  {
    normal: Type.Optional(StylePropertiesSchema),
    heading1: Type.Optional(StylePropertiesSchema),
    heading2: Type.Optional(StylePropertiesSchema),
    heading3: Type.Optional(StylePropertiesSchema),
    heading4: Type.Optional(StylePropertiesSchema),
    heading5: Type.Optional(StylePropertiesSchema),
    heading6: Type.Optional(StylePropertiesSchema),
    title: Type.Optional(StylePropertiesSchema),
    subtitle: Type.Optional(StylePropertiesSchema),
    // TOC entry styles (used by Word to format TOC entries)
    // Note: TOC styles use TocStylePropertiesSchema which excludes baseStyle to prevent coupling with Headings
    TOC1: Type.Optional(TocStylePropertiesSchema),
    TOC2: Type.Optional(TocStylePropertiesSchema),
    TOC3: Type.Optional(TocStylePropertiesSchema),
    TOC4: Type.Optional(TocStylePropertiesSchema),
    TOC5: Type.Optional(TocStylePropertiesSchema),
    TOC6: Type.Optional(TocStylePropertiesSchema),
  },
  {
    additionalProperties: StylePropertiesSchema,
    description:
      'Style definitions supporting predefined styles (normal, heading1..6, title, subtitle), TOC entry styles (TOC1..TOC6), and arbitrary custom styles.',
  }
);

// ============================================================================
// Heading Definition Schema
// ============================================================================

/**
 * Heading definition schema that uses the same properties as StylePropertiesSchema
 * but adds a required 'level' field.
 */
export const HeadingDefinitionSchema = Type.Object(
  {
    level: Type.Union([
      Type.Literal(1),
      Type.Literal(2),
      Type.Literal(3),
      Type.Literal(4),
      Type.Literal(5),
      Type.Literal(6),
    ]),
    ...StylePropertiesSchema.properties,
  },
  { additionalProperties: false }
);

// ============================================================================
// Component Defaults Schemas (imported from component-defaults.ts to avoid
// circular deps: report.ts needs ComponentDefaultsSchema, but the old location
// here imported from the components barrel which re-exports report.ts)
// ============================================================================

import { ComponentDefaultsSchema } from './component-defaults';

export {
  HeadingComponentDefaultsSchema,
  ParagraphComponentDefaultsSchema,
  ImageComponentDefaultsSchema,
  StatisticComponentDefaultsSchema,
  TableComponentDefaultsSchema,
  SectionComponentDefaultsSchema,
  ColumnsComponentDefaultsSchema,
  ListComponentDefaultsSchema,
  ComponentDefaultsSchema,
} from './component-defaults';

// ============================================================================
// Theme Config Schema
// ============================================================================

export const ThemeColorsSchema = Type.Object(
  {
    primary: HexColorSchema,
    secondary: HexColorSchema,
    accent: HexColorSchema,
    text: HexColorSchema,
    background: HexColorSchema,
    border: HexColorSchema,
    // Additional semantic color names
    textPrimary: HexColorSchema,
    textSecondary: HexColorSchema,
    textMuted: HexColorSchema,
    borderPrimary: HexColorSchema,
    borderSecondary: HexColorSchema,
    backgroundPrimary: HexColorSchema,
    backgroundSecondary: HexColorSchema,
    // Extra chart-series slots, named to match the PPTX theme so both
    // formats share one palette vocabulary. Optional: the bundled DOCX
    // themes leave them unset and charts skip the empty slots.
    accent4: Type.Optional(HexColorSchema),
    accent5: Type.Optional(HexColorSchema),
    accent6: Type.Optional(HexColorSchema),
  },
  { additionalProperties: false }
);

export const ThemeOverridesSchema = Type.Object(
  {
    colors: Type.Optional(Type.Partial(ThemeColorsSchema)),
    fonts: Type.Optional(Type.Partial(FontsSchema)),
    styles: Type.Optional(StyleDefinitionsSchema),
  },
  {
    additionalProperties: false,
    description:
      'Partial theme deep-merged over the resolved named theme: define or override palette tokens, font roles, and named styles in-document.',
  }
);

export const ThemeConfigSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    name: Type.String(),
    displayName: Type.String(),
    description: Type.String(),
    version: Type.String(),
    colors: Type.Object(
      {
        primary: HexColorSchema,
        secondary: HexColorSchema,
        accent: HexColorSchema,
        text: HexColorSchema,
        background: HexColorSchema,
        border: HexColorSchema,
        // Additional semantic color names
        textPrimary: HexColorSchema,
        textSecondary: HexColorSchema,
        textMuted: HexColorSchema,
        borderPrimary: HexColorSchema,
        borderSecondary: HexColorSchema,
        backgroundPrimary: HexColorSchema,
        backgroundSecondary: HexColorSchema,
        // Extra chart-series slots, named to match the PPTX theme so both
        // formats share one palette vocabulary. Optional: the bundled DOCX
        // themes leave them unset and charts skip the empty slots.
        accent4: Type.Optional(HexColorSchema),
        accent5: Type.Optional(HexColorSchema),
        accent6: Type.Optional(HexColorSchema),
      },
      { additionalProperties: false }
    ),
    fonts: FontsSchema,
    page: PageSchema,
    styles: Type.Optional(StyleDefinitionsSchema),
    componentDefaults: Type.Optional(ComponentDefaultsSchema),
    // House-style "known words" allowlist (whole-word, case-insensitive) that
    // should never be flagged as misspelled. The document's `noProofWords` is
    // merged on top of this at render time.
    noProofWords: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          'Words that should never be flagged as misspelled (whole-word, case-insensitive).',
      })
    ),
  },
  {
    additionalProperties: false,
    description: 'Theme configuration',
  }
);

// ============================================================================
// TypeScript Types
// ============================================================================

export type ThemeConfigJson = Static<typeof ThemeConfigSchema>;
export type DocumentMargins = Static<typeof DocumentMarginsSchema>;
export type PageDimensions = Static<typeof PageDimensionsSchema>;
export type Page = Static<typeof PageSchema>;
export type FontDefinition = Static<typeof FontDefinitionSchema>;
export type Fonts = Static<typeof FontsSchema>;
export type StyleDefinitions = Static<typeof StyleDefinitionsSchema>;
export type HeadingDefinition = Static<typeof HeadingDefinitionSchema>;
export type {
  HeadingComponentDefaults,
  ParagraphComponentDefaults,
  ImageComponentDefaults,
  StatisticComponentDefaults,
  TableComponentDefaults,
  SectionComponentDefaults,
  ColumnsComponentDefaults,
  ListComponentDefaults,
  ComponentDefaults,
} from './component-defaults';

// ============================================================================
// Validation Function
// ============================================================================

import { Value } from '@sinclair/typebox/value';

export function isValidThemeConfig(data: unknown): data is ThemeConfigJson {
  return Value.Check(ThemeConfigSchema, data);
}

// ============================================================================
// Minimal Theme Scaffold
// ============================================================================

/**
 * Build a schema-complete theme to start from.
 *
 * Lives next to `ThemeConfigSchema` on purpose: the return type is the schema's
 * `Static` type, so a required property added to the schema breaks the build
 * here instead of shipping a scaffold that only fails at validation time.
 * Colour patterns are runtime-only, so `theme-scaffold.test.ts` validates the
 * result against the schema as well.
 *
 * Browser-safe (no Node built-ins), so the playground can scaffold new themes
 * from the same source as the CLI.
 *
 * @param name - Theme identifier; defaults to `minimal-theme`
 */
export function createMinimalTheme(
  name: string = 'minimal-theme'
): ThemeConfigJson {
  return {
    name,
    displayName:
      name
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') || name,
    description: 'A minimal theme with basic styling',
    version: '1.0.0',
    colors: {
      primary: '#2563EB',
      secondary: '#64748B',
      accent: '#F8FAFC',
      text: '#334155',
      background: '#FFFFFF',
      border: '#E2E8F0',
      textPrimary: '#334155',
      textSecondary: '#64748B',
      textMuted: '#94A3B8',
      borderPrimary: '#CBD5E1',
      borderSecondary: '#E2E8F0',
      backgroundPrimary: '#FFFFFF',
      backgroundSecondary: '#F8FAFC',
    },
    fonts: {
      heading: { family: 'Arial', size: 14 },
      body: { family: 'Arial', size: 11 },
      mono: { family: 'Courier New', size: 10 },
      light: { family: 'Arial', size: 10 },
    },
    page: {
      size: 'A4',
      margins: {
        top: 1440,
        bottom: 1440,
        left: 1440,
        right: 1440,
        header: 720,
        footer: 720,
        gutter: 0,
      },
    },
    styles: {
      normal: {
        font: 'body',
        size: 11,
        color: '#334155',
        alignment: 'left',
        lineSpacing: { type: 'multiple', value: 1.15 },
        spacing: { after: 8 },
      },
    },
  };
}

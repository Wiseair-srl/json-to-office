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
// Component Defaults Schemas
// ============================================================================

// Import component props schemas from components.ts
import {
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ImagePropsSchema,
  StatisticPropsSchema,
  TablePropsSchema,
  SectionPropsSchema,
  ColumnsPropsSchema,
  ListPropsSchema,
} from './components';

// Create component defaults by making all fields optional (Type.Partial)
export const HeadingComponentDefaultsSchema = Type.Partial(HeadingPropsSchema);
export const ParagraphComponentDefaultsSchema =
  Type.Partial(ParagraphPropsSchema);
export const ImageComponentDefaultsSchema = Type.Partial(ImagePropsSchema);
export const StatisticComponentDefaultsSchema =
  Type.Partial(StatisticPropsSchema);
export const TableComponentDefaultsSchema = Type.Partial(TablePropsSchema);
export const SectionComponentDefaultsSchema = Type.Partial(SectionPropsSchema);
export const ColumnsComponentDefaultsSchema = Type.Partial(ColumnsPropsSchema);
export const ListComponentDefaultsSchema = Type.Partial(ListPropsSchema);

export const ComponentDefaultsSchema = Type.Object(
  {
    heading: Type.Optional(HeadingComponentDefaultsSchema),
    paragraph: Type.Optional(ParagraphComponentDefaultsSchema),
    image: Type.Optional(ImageComponentDefaultsSchema),
    statistic: Type.Optional(StatisticComponentDefaultsSchema),
    table: Type.Optional(TableComponentDefaultsSchema),
    section: Type.Optional(SectionComponentDefaultsSchema),
    columns: Type.Optional(ColumnsComponentDefaultsSchema),
    list: Type.Optional(ListComponentDefaultsSchema),
  },
  { additionalProperties: true } // TODO: add a way to add strict custom component defaults when the plugin/registry paradigm will be implemented
);

// ============================================================================
// Theme Config Schema
// ============================================================================

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
      },
      { additionalProperties: false }
    ),
    fonts: FontsSchema,
    page: PageSchema,
    styles: Type.Optional(StyleDefinitionsSchema),
    componentDefaults: Type.Optional(ComponentDefaultsSchema),
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
export type HeadingComponentDefaults = Static<
  typeof HeadingComponentDefaultsSchema
>;
export type ParagraphComponentDefaults = Static<
  typeof ParagraphComponentDefaultsSchema
>;
export type ImageComponentDefaults = Static<
  typeof ImageComponentDefaultsSchema
>;
export type StatisticComponentDefaults = Static<
  typeof StatisticComponentDefaultsSchema
>;
export type TableComponentDefaults = Static<
  typeof TableComponentDefaultsSchema
>;
export type SectionComponentDefaults = Static<
  typeof SectionComponentDefaultsSchema
>;
export type ColumnsComponentDefaults = Static<
  typeof ColumnsComponentDefaultsSchema
>;
export type ListComponentDefaults = Static<typeof ListComponentDefaultsSchema>;
export type ComponentDefaults = Static<typeof ComponentDefaultsSchema>;

// ============================================================================
// Validation Function
// ============================================================================

import { Value } from '@sinclair/typebox/value';

export function isValidThemeConfig(data: unknown): data is ThemeConfigJson {
  return Value.Check(ThemeConfigSchema, data);
}

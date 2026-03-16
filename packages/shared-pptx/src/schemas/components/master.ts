/**
 * Master Slide Definition Schemas
 */

import { Type, Static } from '@sinclair/typebox';
import { SlideBackgroundSchema, GridPositionSchema, PptxAlignmentSchema, VerticalAlignmentSchema } from './common';
import { ColorValueSchema, GridConfigSchema, StyleNameSchema } from '../theme';

// Position helpers (number in inches)
const Inches = Type.Number({ description: 'Position/size in inches' });

// Fixed objects on a master slide
export const MasterObjectSchema = Type.Union([
  Type.Object({
    image: Type.Object({
      path: Type.Optional(Type.String({ description: 'Image file path or URL' })),
      data: Type.Optional(Type.String({ description: 'Base64-encoded image data' })),
      x: Type.Optional(Inches), y: Type.Optional(Inches), w: Type.Optional(Inches), h: Type.Optional(Inches),
      grid: Type.Optional(GridPositionSchema),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    text: Type.Object({
      text: Type.String(),
      x: Type.Optional(Inches), y: Type.Optional(Inches), w: Type.Optional(Inches), h: Type.Optional(Inches),
      grid: Type.Optional(GridPositionSchema),
      fontSize: Type.Optional(Type.Number()),
      fontFace: Type.Optional(Type.String()),
      color: Type.Optional(ColorValueSchema),
      bold: Type.Optional(Type.Boolean()),
      italic: Type.Optional(Type.Boolean()),
      align: Type.Optional(PptxAlignmentSchema),
      charSpacing: Type.Optional(Type.Number()),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    rect: Type.Object({
      x: Type.Optional(Inches), y: Type.Optional(Inches), w: Type.Optional(Inches), h: Type.Optional(Inches),
      grid: Type.Optional(GridPositionSchema),
      fill: Type.Optional(ColorValueSchema),
      line: Type.Optional(Type.Object({
        color: Type.Optional(ColorValueSchema),
        width: Type.Optional(Type.Number()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    line: Type.Object({
      x: Type.Optional(Inches), y: Type.Optional(Inches), w: Type.Optional(Inches), h: Type.Optional(Inches),
      grid: Type.Optional(GridPositionSchema),
      line: Type.Optional(Type.Object({
        color: Type.Optional(ColorValueSchema),
        width: Type.Optional(Type.Number()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
], { description: 'Fixed object on a master slide (image, text, rect, or line)' });

// Placeholder definition
export const PlaceholderDefinitionSchema = Type.Object({
  name: Type.String({ description: 'Unique placeholder name' }),
  type: Type.Union([
    Type.Literal('title'), Type.Literal('body'), Type.Literal('pic'),
    Type.Literal('chart'), Type.Literal('tbl'), Type.Literal('media'),
  ], { description: 'Placeholder content type' }),
  x: Type.Optional(Inches),
  y: Type.Optional(Inches),
  w: Type.Optional(Inches),
  h: Type.Optional(Inches),
  grid: Type.Optional(GridPositionSchema),
  fontSize: Type.Optional(Type.Number({ description: 'Default font size in points' })),
  fontFace: Type.Optional(Type.String({ description: 'Default font family' })),
  color: Type.Optional(ColorValueSchema),
  align: Type.Optional(PptxAlignmentSchema),
  valign: Type.Optional(VerticalAlignmentSchema),
  margin: Type.Optional(Type.Union([Type.Number(), Type.Array(Type.Number(), { minItems: 4, maxItems: 4 })])),
  bold: Type.Optional(Type.Boolean({ description: 'Default bold for components in this placeholder' })),
  italic: Type.Optional(Type.Boolean({ description: 'Default italic for components in this placeholder' })),
  style: Type.Optional(StyleNameSchema),
  charSpacing: Type.Optional(Type.Number({ description: 'Default character spacing in points' })),
  text: Type.Optional(Type.String({ description: 'Default placeholder text (shown until user adds content)' })),
}, { additionalProperties: false, description: 'Placeholder on a master slide' });

// Master slide definition
export const MasterSlideDefinitionSchema = Type.Object({
  name: Type.String({ description: 'Unique master slide name' }),
  background: Type.Optional(SlideBackgroundSchema),
  margin: Type.Optional(Type.Union([
    Type.Number({ description: 'Margin in inches (all sides)' }),
    Type.Array(Type.Number(), { minItems: 4, maxItems: 4, description: 'Margin [top, right, bottom, left] in inches' }),
  ])),
  slideNumber: Type.Optional(Type.Object({
    x: Inches, y: Inches,
    w: Type.Optional(Inches),
    h: Type.Optional(Inches),
    color: Type.Optional(ColorValueSchema),
    fontSize: Type.Optional(Type.Number({ description: 'Slide number font size in points' })),
  }, { additionalProperties: false, description: 'Slide number position and styling' })),
  objects: Type.Optional(Type.Array(MasterObjectSchema, { description: 'Fixed objects (logos, footers, decorations)' })),
  placeholders: Type.Optional(Type.Array(PlaceholderDefinitionSchema, { description: 'Placeholder regions for slide content' })),
  grid: Type.Optional(GridConfigSchema),
}, { additionalProperties: false, description: 'Master slide definition (reusable slide template)' });

export type MasterObject = Static<typeof MasterObjectSchema>;
export type PlaceholderDefinition = Static<typeof PlaceholderDefinitionSchema>;
export type MasterSlideDefinition = Static<typeof MasterSlideDefinitionSchema>;

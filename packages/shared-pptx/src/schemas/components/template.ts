/**
 * Template Slide Definition Schemas
 */

import { Type, Static, TSchema } from '@sinclair/typebox';
import { SlideBackgroundSchema, GridPositionSchema } from './common';
import { ColorValueSchema, GridConfigSchema } from '../theme';
import { TextPropsSchema } from './text';
import { PptxImagePropsSchema } from './image';
import { ShapePropsSchema } from './shape';
import { PptxTablePropsSchema } from './table';
import { PptxChartPropsSchema } from './chart';
import { PptxHighchartsPropsSchema } from './highcharts';

// Position helpers (number in inches OR percentage string e.g. "50%")
const Coord = Type.Union([
  Type.Number({ description: 'Position/size in inches' }),
  Type.String({
    pattern: '^\\d+(\\.\\d+)?%$',
    description: 'Position/size as percentage of slide dimension (e.g., "50%")',
  }),
]);

// Helper: wrap a props schema into { name, props } component format
function contentComponent(name: string, propsSchema: TSchema) {
  return Type.Object({
    name: Type.Literal(name),
    id: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean({
      default: true,
      description: 'When false, this component is filtered out and not rendered. Defaults to true.',
    })),
    props: propsSchema,
  }, { additionalProperties: false });
}

// Content component union — same { name, props } format as slide children
const TemplateObjectComponentSchema = Type.Union([
  contentComponent('text', TextPropsSchema),
  contentComponent('image', PptxImagePropsSchema),
  contentComponent('shape', ShapePropsSchema),
  contentComponent('table', PptxTablePropsSchema),
  contentComponent('chart', PptxChartPropsSchema),
  contentComponent('highcharts', PptxHighchartsPropsSchema),
], {
  discriminator: { propertyName: 'name' },
  description: 'Fixed component on a template slide (same format as slide children)',
});

// Defaults schema — partial component stub (carries styling props, not content)
// Discriminated union so Monaco can autocomplete prop names per component type
function defaultsComponent(name: string, propsSchema: TSchema) {
  return Type.Object({
    name: Type.Literal(name),
    props: Type.Partial(propsSchema, { description: 'Default props inherited by the component placed in this placeholder' }),
  }, { additionalProperties: false });
}

const PlaceholderDefaultsSchema = Type.Union([
  defaultsComponent('text', TextPropsSchema),
  defaultsComponent('image', PptxImagePropsSchema),
  defaultsComponent('shape', ShapePropsSchema),
  defaultsComponent('table', PptxTablePropsSchema),
  defaultsComponent('chart', PptxChartPropsSchema),
  defaultsComponent('highcharts', PptxHighchartsPropsSchema),
], {
  discriminator: { propertyName: 'name' },
  description: 'Partial component stub — styling defaults only',
});

// Placeholder definition
export const PlaceholderDefinitionSchema = Type.Object({
  name: Type.String({ description: 'Unique placeholder name' }),
  x: Type.Optional(Coord),
  y: Type.Optional(Coord),
  w: Type.Optional(Coord),
  h: Type.Optional(Coord),
  grid: Type.Optional(GridPositionSchema),
  defaults: Type.Optional(PlaceholderDefaultsSchema),
}, { additionalProperties: false, description: 'Placeholder on a template slide — defaults is a component stub whose props are inherited by the actual component' });

// Template slide definition
export const TemplateSlideDefinitionSchema = Type.Object({
  name: Type.String({ description: 'Unique template slide name' }),
  background: Type.Optional(SlideBackgroundSchema),
  margin: Type.Optional(Type.Union([
    Type.Number({ description: 'Margin in inches (all sides)' }),
    Type.Array(Type.Number(), { minItems: 4, maxItems: 4, description: 'Margin [top, right, bottom, left] in inches' }),
  ])),
  slideNumber: Type.Optional(Type.Object({
    x: Coord, y: Coord,
    w: Type.Optional(Coord),
    h: Type.Optional(Coord),
    color: Type.Optional(ColorValueSchema),
    fontSize: Type.Optional(Type.Number({ description: 'Slide number font size in points' })),
  }, { additionalProperties: false, description: 'Slide number position and styling' })),
  objects: Type.Optional(Type.Array(TemplateObjectComponentSchema, { description: 'Fixed components (logos, footers, decorations) — same { name, props } format as slide children' })),
  placeholders: Type.Optional(Type.Array(PlaceholderDefinitionSchema, { description: 'Placeholder regions for slide content' })),
  grid: Type.Optional(GridConfigSchema),
}, { additionalProperties: false, description: 'Template slide definition (reusable slide template)' });

export type PlaceholderDefinition = Static<typeof PlaceholderDefinitionSchema>;
export type TemplateSlideDefinition = Static<typeof TemplateSlideDefinitionSchema>;

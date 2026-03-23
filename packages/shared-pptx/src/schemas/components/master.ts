/**
 * Master Slide Definition Schemas
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
const MasterObjectComponentSchema = Type.Union([
  contentComponent('text', TextPropsSchema),
  contentComponent('image', PptxImagePropsSchema),
  contentComponent('shape', ShapePropsSchema),
  contentComponent('table', PptxTablePropsSchema),
  contentComponent('chart', PptxChartPropsSchema),
  contentComponent('highcharts', PptxHighchartsPropsSchema),
], {
  discriminator: { propertyName: 'name' },
  description: 'Fixed component on a master slide (same format as slide children)',
});

// Defaults schema — partial component stub (carries styling props, not content)
// Loose { name, props } because defaults don't require content-specific fields
// (e.g. a text defaults stub doesn't need the "text" prop itself)
const PlaceholderDefaultsSchema = Type.Object({
  name: Type.String({ description: 'Component type name (text, shape, chart, etc.)' }),
  props: Type.Record(Type.String(), Type.Any(), { description: 'Default props inherited by the component placed in this placeholder' }),
}, { additionalProperties: false, description: 'Partial component stub — styling defaults only' });

// Placeholder definition
export const PlaceholderDefinitionSchema = Type.Object({
  name: Type.String({ description: 'Unique placeholder name' }),
  x: Type.Optional(Coord),
  y: Type.Optional(Coord),
  w: Type.Optional(Coord),
  h: Type.Optional(Coord),
  grid: Type.Optional(GridPositionSchema),
  defaults: Type.Optional(PlaceholderDefaultsSchema),
}, { additionalProperties: false, description: 'Placeholder on a master slide — defaults is a component stub whose props are inherited by the actual component' });

// Master slide definition
export const MasterSlideDefinitionSchema = Type.Object({
  name: Type.String({ description: 'Unique master slide name' }),
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
  objects: Type.Optional(Type.Array(MasterObjectComponentSchema, { description: 'Fixed components (logos, footers, decorations) — same { name, props } format as slide children' })),
  placeholders: Type.Optional(Type.Array(PlaceholderDefinitionSchema, { description: 'Placeholder regions for slide content' })),
  grid: Type.Optional(GridConfigSchema),
}, { additionalProperties: false, description: 'Master slide definition (reusable slide template)' });

export type PlaceholderDefinition = Static<typeof PlaceholderDefinitionSchema>;
export type MasterSlideDefinition = Static<typeof MasterSlideDefinitionSchema>;

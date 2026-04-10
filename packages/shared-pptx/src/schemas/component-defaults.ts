/**
 * PPTX Component Defaults Schemas
 *
 * Imports directly from individual component files to avoid circular deps.
 */

import { Type, Static } from '@sinclair/typebox';
import { TextPropsSchema } from './components/text';
import { PptxImagePropsSchema } from './components/image';
import { ShapePropsSchema } from './components/shape';
import { PptxTablePropsSchema } from './components/table';
import { PptxHighchartsPropsSchema } from './components/highcharts';
import { PptxChartPropsSchema } from './components/chart';

// Create component defaults by making all fields optional (Type.Partial)
export const TextComponentDefaultsSchema = Type.Partial(TextPropsSchema);
export const ImageComponentDefaultsSchema = Type.Partial(PptxImagePropsSchema);
export const ShapeComponentDefaultsSchema = Type.Partial(ShapePropsSchema);
export const TableComponentDefaultsSchema = Type.Partial(PptxTablePropsSchema);
export const HighchartsComponentDefaultsSchema = Type.Partial(
  PptxHighchartsPropsSchema
);
export const ChartComponentDefaultsSchema = Type.Partial(PptxChartPropsSchema);

export const PptxComponentDefaultsSchema = Type.Object(
  {
    text: Type.Optional(TextComponentDefaultsSchema),
    image: Type.Optional(ImageComponentDefaultsSchema),
    shape: Type.Optional(ShapeComponentDefaultsSchema),
    table: Type.Optional(TableComponentDefaultsSchema),
    highcharts: Type.Optional(HighchartsComponentDefaultsSchema),
    chart: Type.Optional(ChartComponentDefaultsSchema),
  },
  { additionalProperties: true }
);

// TypeScript types
export type TextComponentDefaults = Static<typeof TextComponentDefaultsSchema>;
export type ImageComponentDefaults = Static<
  typeof ImageComponentDefaultsSchema
>;
export type ShapeComponentDefaults = Static<
  typeof ShapeComponentDefaultsSchema
>;
export type TableComponentDefaults = Static<
  typeof TableComponentDefaultsSchema
>;
export type HighchartsComponentDefaults = Static<
  typeof HighchartsComponentDefaultsSchema
>;
export type ChartComponentDefaults = Static<
  typeof ChartComponentDefaultsSchema
>;
export type PptxComponentDefaults = Static<
  typeof PptxComponentDefaultsSchema
>;

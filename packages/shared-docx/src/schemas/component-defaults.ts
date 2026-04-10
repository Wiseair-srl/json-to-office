/**
 * Component Defaults Schemas
 *
 * Extracted to its own file to avoid circular imports:
 * report.ts needs ComponentDefaultsSchema, but theme.ts (where it was)
 * imports from components.ts barrel which re-exports report.ts.
 *
 * This file imports directly from individual component files.
 */

import { Type, Static } from '@sinclair/typebox';
import { HeadingPropsSchema } from './components/heading';
import { ParagraphPropsSchema } from './components/paragraph';
import { ImagePropsSchema } from './components/image';
import { StatisticPropsSchema } from './components/statistic';
import { TablePropsSchema } from './components/table';
import { SectionPropsSchema } from './components/section';
import { ColumnsPropsSchema } from './components/columns';
import { ListPropsSchema } from './components/list';

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

// TypeScript types
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

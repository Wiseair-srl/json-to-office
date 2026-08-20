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

/**
 * Props that describe one specific occurrence of a component and can never be
 * a shared default.
 *
 * `revision` would silently replace every component's text with the same
 * tracked change; `comment` would attach the same review comment to every
 * component and make the registry allocate a fresh id for each copy;
 * `footnotes` and `endnotes` are bodies bound to markers in one paragraph's
 * own text.
 * `ComponentDefaultsSchema` is embedded in every theme, so either leak is
 * theme-wide.
 *
 * Anything added here must also be added to the table in
 * `__tests__/component-defaults-per-instance.test.ts`, which is driven by this
 * list.
 */
export const PER_INSTANCE_PROPS = [
  'revision',
  'comment',
  'footnotes',
  'endnotes',
] as const;

export type PerInstanceProp = (typeof PER_INSTANCE_PROPS)[number];

// Create component defaults by making all fields optional (Type.Partial),
// minus the per-instance props above.
export const HeadingComponentDefaultsSchema = Type.Partial(
  Type.Omit(HeadingPropsSchema, PER_INSTANCE_PROPS)
);
export const ParagraphComponentDefaultsSchema = Type.Partial(
  Type.Omit(ParagraphPropsSchema, PER_INSTANCE_PROPS)
);
export const ImageComponentDefaultsSchema = Type.Partial(ImagePropsSchema);
export const StatisticComponentDefaultsSchema =
  Type.Partial(StatisticPropsSchema);
/**
 * `rows` is table *content*, not a default: it carries per-row revisions, and
 * `Type.Partial` is shallow, so leaving it in would let a theme mark the same
 * row of every table inserted or deleted.
 *
 * The leak is real only for `rows`, and only because `rows` is optional on the
 * instance. `deepMerge` replaces arrays wholesale rather than merging them
 * element-wise, and `columns` is the one required table prop — so a valid
 * table always supplies its own `columns`, which replaces any the theme
 * declared, cell comments and revisions included. `columns` therefore stays
 * here: it is inert in defaults, and rejecting an inert field would break
 * existing themes for no gain.
 */
export const TableComponentDefaultsSchema = Type.Partial(
  Type.Omit(TablePropsSchema, ['rows'])
);
export const SectionComponentDefaultsSchema = Type.Partial(SectionPropsSchema);
export const ColumnsComponentDefaultsSchema = Type.Partial(ColumnsPropsSchema);
export const ListComponentDefaultsSchema = Type.Partial(
  Type.Omit(ListPropsSchema, PER_INSTANCE_PROPS)
);

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

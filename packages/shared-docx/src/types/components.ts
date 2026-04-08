/**
 * Component Type Definitions for Plugin System
 *
 * This file provides properly typed discriminated union interfaces for all component types.
 * These types enable TypeScript to automatically infer component props based on
 * the 'name' field when building component arrays in render functions.
 */

import type { Static } from '@sinclair/typebox';
import type {
  ReportPropsSchema,
  SectionPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ColumnsPropsSchema,
  ImagePropsSchema,
  HighchartsPropsSchema,
  StatisticPropsSchema,
  TablePropsSchema,
  ListPropsSchema,
  TocPropsSchema,
} from '../schemas/components';

import type { TextSpaceAfterPropsSchema } from '../schemas/custom-components';
import type { TextBoxPropsSchema } from '../schemas/components/text-box';

// ============================================================================
// Standard Component Types with Discriminated Union Support
// ============================================================================

/**
 * Report component with literal name discriminator
 */
export interface ReportComponent {
  name: 'docx';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ReportPropsSchema>;
  children?: ComponentDefinition[];
}

/**
 * Section component with literal name discriminator
 */
export interface SectionComponent {
  name: 'section';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof SectionPropsSchema>;
  children?: ComponentDefinition[];
}

/**
 * Columns component with literal name discriminator
 */
export interface ColumnsComponent {
  name: 'columns';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ColumnsPropsSchema>;
  children?: ComponentDefinition[];
}

/**
 * Heading component with literal name discriminator
 */
export interface HeadingComponent {
  name: 'heading';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof HeadingPropsSchema>;
}

/**
 * Paragraph component with literal name discriminator
 */
export interface ParagraphComponent {
  name: 'paragraph';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ParagraphPropsSchema>;
}

/**
 * Image component with literal name discriminator
 */
export interface ImageComponent {
  name: 'image';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ImagePropsSchema>;
}

/**
 * Statistic component with literal name discriminator
 */
export interface StatisticComponent {
  name: 'statistic';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof StatisticPropsSchema>;
}

/**
 * Table component with literal name discriminator
 */
export interface TableComponent {
  name: 'table';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof TablePropsSchema>;
}

/**
 * Highcharts component with literal name discriminator
 */
export interface HighchartsComponent {
  name: 'highcharts';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof HighchartsPropsSchema>;
}

/**
 * Text Box component with literal name discriminator
 * Container for child components with floating positioning
 */
export interface TextBoxComponent {
  name: 'text-box';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof TextBoxPropsSchema>;
  children?: ComponentDefinition[];
}

/**
 * List component with literal name discriminator
 */
export interface ListComponent {
  name: 'list';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ListPropsSchema>;
}

/**
 * Table of Contents component with literal name discriminator
 */
export interface TocComponent {
  name: 'toc';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof TocPropsSchema>;
}

// ============================================================================
// Specific Custom Component Types
// ============================================================================

/**
 * Text Space After component with literal name discriminator
 */
export interface TextSpaceAfterComponent {
  name: 'text-space-after';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof TextSpaceAfterPropsSchema>;
}

// ============================================================================
// Discriminated Union Types
// ============================================================================

/**
 * Union of all standard component types
 */
export type StandardComponentDefinition =
  | ReportComponent
  | SectionComponent
  | ColumnsComponent
  | HeadingComponent
  | ParagraphComponent
  | TextBoxComponent
  | ImageComponent
  | HighchartsComponent
  | StatisticComponent
  | TableComponent
  | ListComponent
  | TocComponent;

/**
 * Array of all standard component names.
 * Useful for iterating, validation, or displaying available components to users.
 */
export const STANDARD_COMPONENTS = [
  'columns',
  'heading',
  'highcharts',
  'image',
  'list',
  'paragraph',
  'docx',
  'section',
  'statistic',
  'table',
  'text-box',
  'toc',
] as const satisfies readonly StandardComponentDefinition['name'][];

/**
 * Set of all standard component names for O(1) lookup.
 */
export const STANDARD_COMPONENTS_SET: ReadonlySet<
  (typeof STANDARD_COMPONENTS)[number]
> = new Set(STANDARD_COMPONENTS);

// Compile-time completeness check: produces TS2344 listing the missing name(s)
// if a standard component is added to the union but not to the array above.
type AssertNever<T extends never> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertAllIncluded = AssertNever<
  Exclude<
    StandardComponentDefinition['name'],
    (typeof STANDARD_COMPONENTS)[number]
  >
>;

/**
 * Complete discriminated union of all component types.
 * TypeScript will automatically narrow the type based on the 'name' field.
 *
 * @example
 * ```typescript
 * const components: ComponentDefinition[] = [
 *   {
 *     name: 'heading', // TypeScript knows this is HeadingComponent
 *     props: {
 *       level: 2,      // Autocomplete works!
 *       text: 'Title'
 *     }
 *   },
 *   {
 *     name: 'paragraph',    // TypeScript knows this is ParagraphComponent
 *     props: {
 *       content: 'Hello World',
 *       bold: true     // Autocomplete works!
 *     }
 *   }
 * ];
 * ```
 */
export type ComponentDefinition =
  | StandardComponentDefinition
  | TextSpaceAfterComponent;

// ============================================================================
// Type Guards
// ============================================================================

export function isReportComponent(
  component: ComponentDefinition
): component is ReportComponent {
  return component.name === 'docx';
}

export function isSectionComponent(
  component: ComponentDefinition
): component is SectionComponent {
  return component.name === 'section';
}

export function isColumnsComponent(
  component: ComponentDefinition
): component is ColumnsComponent {
  return component.name === 'columns';
}

export function isHeadingComponent(
  component: ComponentDefinition
): component is HeadingComponent {
  return component.name === 'heading';
}

export function isParagraphComponent(
  component: ComponentDefinition
): component is ParagraphComponent {
  return component.name === 'paragraph';
}

export function isImageComponent(
  component: ComponentDefinition
): component is ImageComponent {
  return component.name === 'image';
}

export function isTextBoxComponent(
  component: ComponentDefinition
): component is TextBoxComponent {
  return component.name === 'text-box';
}

export function isStatisticComponent(
  component: ComponentDefinition
): component is StatisticComponent {
  return component.name === 'statistic';
}

export function isTableComponent(
  component: ComponentDefinition
): component is TableComponent {
  return component.name === 'table';
}

export function isListComponent(
  component: ComponentDefinition
): component is ListComponent {
  return component.name === 'list';
}

export function isTocComponent(
  component: ComponentDefinition
): component is TocComponent {
  return component.name === 'toc';
}

export function isHighchartsComponent(
  component: ComponentDefinition
): component is HighchartsComponent {
  return component.name === 'highcharts';
}

export function isTextSpaceAfterComponent(
  component: ComponentDefinition
): component is TextSpaceAfterComponent {
  return component.name === 'text-space-after';
}

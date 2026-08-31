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
  ChartPropsSchema,
  VisualPropsSchema,
  StatisticPropsSchema,
  TablePropsSchema,
  ListPropsSchema,
  TocPropsSchema,
  DividerPropsSchema,
} from '../schemas/components';

import type { TextSpaceAfterPropsSchema } from '../schemas/custom-components';
import type { TextBoxPropsSchema } from '../schemas/components/text-box';
import type { DocxRendererId } from '../schemas/renderer';

// ============================================================================
// Standard Component Types with Discriminated Union Support
// ============================================================================

/**
 * Report component with literal name discriminator
 */
export interface ReportComponent {
  name: 'docx';
  id?: string;
  /** Renderer backend. Omitted defaults to docxjs. */
  renderer?: DocxRendererId;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ReportPropsSchema>;
  children?: ComponentDefinition[];
}

/** A document explicitly targeted at one renderer profile. */
export type ReportComponentFor<R extends DocxRendererId> = Omit<
  ReportComponent,
  'renderer'
> &
  (R extends 'docxjs' ? { renderer?: R } : { renderer: R });

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
 * Native chart component with literal name discriminator.
 *
 * Only `office-open` draws it; the schema for every other renderer omits the
 * component entirely.
 */
export interface ChartComponent {
  name: 'chart';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof ChartPropsSchema>;
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
 * Visual component with literal name discriminator.
 * A pptx-rendered free-canvas graphic embedded as a rasterized image.
 */
export interface VisualComponent {
  name: 'visual';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props: Static<typeof VisualPropsSchema>;
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

/**
 * Divider component with literal name discriminator
 */
export interface DividerComponent {
  name: 'divider';
  id?: string;
  /** When false, this component is filtered out and not rendered. Defaults to true */
  enabled?: boolean;
  props?: Static<typeof DividerPropsSchema>;
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
  | ChartComponent
  | VisualComponent
  | StatisticComponent
  | TableComponent
  | ListComponent
  | TocComponent
  | DividerComponent;

/**
 * Array of all standard component names.
 * Useful for iterating, validation, or displaying available components to users.
 */
export const STANDARD_COMPONENTS = [
  'chart',
  'columns',
  'divider',
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
  'visual',
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

export function isDividerComponent(
  component: ComponentDefinition
): component is DividerComponent {
  return component.name === 'divider';
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

export function isVisualComponent(
  component: ComponentDefinition
): component is VisualComponent {
  return component.name === 'visual';
}

export function isTextSpaceAfterComponent(
  component: ComponentDefinition
): component is TextSpaceAfterComponent {
  return component.name === 'text-space-after';
}

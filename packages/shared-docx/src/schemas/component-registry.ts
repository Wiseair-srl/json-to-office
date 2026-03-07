/**
 * Component Registry - SINGLE SOURCE OF TRUTH
 *
 * This is the ONLY place where standard components are defined.
 * All schema generators MUST use this registry.
 *
 * Adding a new component: Add it to STANDARD_COMPONENTS_REGISTRY below.
 * It will automatically be included in:
 * - StandardComponentDefinitionSchema (components.ts)
 * - ComponentDefinitionSchema (components.ts)
 * - generateUnifiedDocumentSchema (generator.ts)
 * - Monaco editor autocomplete
 * - Build-time JSON schemas
 */

import { Type, TSchema } from '@sinclair/typebox';
// Import directly from individual component files to avoid circular dependency
// (components.ts imports from this file, so we can't import from components.ts)
import { ReportPropsSchema } from './components/report';
import { SectionPropsSchema } from './components/section';
import { ColumnsPropsSchema } from './components/columns';
import { HeadingPropsSchema } from './components/heading';
import { ParagraphPropsSchema } from './components/paragraph';
import { TextBoxPropsSchema } from './components/text-box';
import { ImagePropsSchema } from './components/image';
import { StatisticPropsSchema } from './components/statistic';
import { TablePropsSchema } from './components/table';
import { HeaderPropsSchema } from './components/header';
import { FooterPropsSchema } from './components/footer';
import { ListPropsSchema } from './components/list';
import { TocPropsSchema } from './components/toc';
import { HighchartsPropsSchema } from './components/highcharts';

/**
 * Component definition with metadata
 */
export interface StandardComponentDefinition {
  /** Component name identifier (e.g., 'heading', 'text', 'toc') */
  name: string;
  /** TypeBox schema for the component's props */
  propsSchema: TSchema;
  /** Whether this component can contain children */
  hasChildren: boolean;
  /** Component category for organization */
  category: 'container' | 'content' | 'layout';
  /** Human-readable description */
  description: string;
  /** Special flags for this component */
  special?: {
    /** Has $schema field (only 'report') */
    hasSchemaField?: boolean;
  };
}

/**
 * SINGLE SOURCE OF TRUTH for all standard components
 *
 * This is the ONLY place where standard components are defined.
 * All schema generators MUST use this registry.
 *
 * IMPORTANT: When adding a new component:
 * 1. Add the component definition to this array
 * 2. Import its props schema at the top of this file
 * 3. That's it! The component will automatically appear everywhere.
 */
export const STANDARD_COMPONENTS_REGISTRY: readonly StandardComponentDefinition[] = [
  // ========================================================================
  // Container Components (can contain children)
  // ========================================================================
  {
    name: 'report',
    propsSchema: ReportPropsSchema,
    hasChildren: true,
    category: 'container',
    description:
      'Main report container - defines the overall document structure. Required as the first component.',
    special: {
      hasSchemaField: true, // Only report has $schema field
    },
  },
  {
    name: 'section',
    propsSchema: SectionPropsSchema,
    hasChildren: true,
    category: 'container',
    description:
      'Section container - groups related content with optional title. Use for organizing document structure.',
  },
  {
    name: 'columns',
    propsSchema: ColumnsPropsSchema,
    hasChildren: true,
    category: 'layout',
    description:
      'Multi-column layout - arranges content in 2-4 columns. Great for side-by-side content.',
  },
  {
    name: 'text-box',
    propsSchema: TextBoxPropsSchema,
    hasChildren: true,
    category: 'layout',
    description:
      'Floating text container - allows positioning text anywhere on the page with absolute or relative positioning.',
  },

  // ========================================================================
  // Content Components (leaf nodes, no children)
  // ========================================================================
  {
    name: 'heading',
    propsSchema: HeadingPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Heading text - supports levels 1-6 for document hierarchy. Level 1 is largest.',
  },
  {
    name: 'paragraph',
    propsSchema: ParagraphPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Paragraph text - supports formatting like bold, italic, and color. Main content element.',
  },
  {
    name: 'image',
    propsSchema: ImagePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Image element - displays images with optional caption. Supports various formats.',
  },
  {
    name: 'statistic',
    propsSchema: StatisticPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Statistic display - shows a number with description. Perfect for KPIs and metrics.',
  },
  {
    name: 'table',
    propsSchema: TablePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Data table - displays tabular data with headers. Supports formatting and alignment.',
  },
  {
    name: 'header',
    propsSchema: HeaderPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Page header - appears at the top of pages. Can include text and page numbers.',
  },
  {
    name: 'footer',
    propsSchema: FooterPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Page footer - appears at the bottom of pages. Can include text and page numbers.',
  },
  {
    name: 'list',
    propsSchema: ListPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'List element - bulleted or numbered list items. Supports nested lists.',
  },
  {
    name: 'toc',
    propsSchema: TocPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Table of contents - automatically generates TOC from document headings. Supports depth ranges and custom styles.',
  },
  {
    name: 'highcharts',
    propsSchema: HighchartsPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Chart component powered by Highcharts - render line, bar, pie, heatmap, and more with rich options.',
  },
] as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a component definition by name
 */
export function getStandardComponent(
  name: string
): StandardComponentDefinition | undefined {
  return STANDARD_COMPONENTS_REGISTRY.find((c) => c.name === name);
}

/**
 * Get all standard component names
 */
export function getAllStandardComponentNames(): readonly string[] {
  return STANDARD_COMPONENTS_REGISTRY.map((c) => c.name);
}

/**
 * Get components by category
 */
export function getComponentsByCategory(
  category: StandardComponentDefinition['category']
): readonly StandardComponentDefinition[] {
  return STANDARD_COMPONENTS_REGISTRY.filter((c) => c.category === category);
}

/**
 * Get container components (components that can have children)
 */
export function getContainerComponents(): readonly StandardComponentDefinition[] {
  return STANDARD_COMPONENTS_REGISTRY.filter((c) => c.hasChildren);
}

/**
 * Get content components (components that cannot have children)
 */
export function getContentComponents(): readonly StandardComponentDefinition[] {
  return STANDARD_COMPONENTS_REGISTRY.filter((c) => !c.hasChildren);
}

/**
 * Check if a component name is a standard component
 */
export function isStandardComponent(name: string): boolean {
  return STANDARD_COMPONENTS_REGISTRY.some((c) => c.name === name);
}

// ============================================================================
// Schema Generation Helpers
// ============================================================================

/**
 * Generate TypeBox schema object for a component
 *
 * @param component - Component definition from the registry
 * @param recursiveRef - Optional recursive reference for children (use Type.Recursive's 'This')
 * @returns TypeBox schema object for the component
 */
export function createComponentSchemaObject(
  component: StandardComponentDefinition,
  recursiveRef?: TSchema
): TSchema {
  const schema: Record<string, TSchema> = {
    name: Type.Literal(component.name),
    id: Type.Optional(Type.String()),
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          'When false, this component is filtered out and not rendered. Defaults to true. Useful for conditional component inclusion.',
      })
    ),
  };

  // Special handling for report component (has $schema field)
  if (component.special?.hasSchemaField) {
    schema.$schema = Type.Optional(Type.String({ format: 'uri' }));
  }

  // Add props schema
  schema.props = component.propsSchema;

  // Add children support if applicable
  if (component.hasChildren && recursiveRef) {
    schema.children = Type.Optional(Type.Array(recursiveRef));
  }

  return Type.Object(schema, { additionalProperties: false });
}

/**
 * Generate an array of TypeBox schemas for all standard components
 *
 * @param recursiveRef - Optional recursive reference for children
 * @returns Array of TypeBox schemas for all components in the registry
 */
export function createAllComponentSchemas(
  recursiveRef?: TSchema
): readonly TSchema[] {
  return STANDARD_COMPONENTS_REGISTRY.map((component) =>
    createComponentSchemaObject(component, recursiveRef)
  );
}

/**
 * PPTX Component Registry - SINGLE SOURCE OF TRUTH
 *
 * This is the ONLY place where standard PPTX components are defined.
 * All schema generators MUST use this registry.
 */

import { Type, TSchema } from '@sinclair/typebox';

/**
 * Component definition with metadata
 */
export interface PptxStandardComponentDefinition {
  name: string;
  propsSchema: TSchema;
  hasChildren: boolean;
  hasPlaceholders?: boolean;
  category: 'container' | 'content' | 'layout';
  description: string;
  special?: {
    hasSchemaField?: boolean;
  };
}
import { PresentationPropsSchema } from './components/presentation';
import { SlidePropsSchema } from './components/slide';
import { TextPropsSchema } from './components/text';
import { PptxImagePropsSchema } from './components/image';
import { ShapePropsSchema } from './components/shape';
import { PptxTablePropsSchema } from './components/table';
import { PptxHighchartsPropsSchema } from './components/highcharts';
import { PptxChartPropsSchema } from './components/chart';

/**
 * SINGLE SOURCE OF TRUTH for all standard PPTX components
 */
export const PPTX_STANDARD_COMPONENTS_REGISTRY: readonly PptxStandardComponentDefinition[] = [
  // ========================================================================
  // Container Components (can contain children)
  // ========================================================================
  {
    name: 'pptx',
    propsSchema: PresentationPropsSchema,
    hasChildren: true,
    category: 'container',
    description:
      'Main presentation container - defines the overall presentation structure. Required as the root component.',
    special: {
      hasSchemaField: true,
    },
  },
  {
    name: 'slide',
    propsSchema: SlidePropsSchema,
    hasChildren: true,
    hasPlaceholders: true,
    category: 'container',
    description:
      'Slide container - groups content elements on a single slide.',
  },

  // ========================================================================
  // Content Components (leaf nodes, no children)
  // ========================================================================
  {
    name: 'text',
    propsSchema: TextPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Text element - displays text with formatting, positioning and styling options.',
  },
  {
    name: 'image',
    propsSchema: PptxImagePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Image element - displays images from file path, URL, or base64 data.',
  },
  {
    name: 'shape',
    propsSchema: ShapePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Shape element - draws geometric shapes with optional text, fill, and line styling.',
  },
  {
    name: 'table',
    propsSchema: PptxTablePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Table element - displays tabular data with rows and columns.',
  },
  {
    name: 'highcharts',
    propsSchema: PptxHighchartsPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Highcharts element - renders charts via Highcharts Export Server.',
  },
  {
    name: 'chart',
    propsSchema: PptxChartPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Native PowerPoint chart - editable, scalable, no external server needed.',
  },
] as const;

// ============================================================================
// Helper Functions
// ============================================================================

export function getPptxStandardComponent(
  name: string
): PptxStandardComponentDefinition | undefined {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.find((c) => c.name === name);
}

export function getAllPptxComponentNames(): readonly string[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.map((c) => c.name);
}

export function getPptxComponentsByCategory(
  category: PptxStandardComponentDefinition['category']
): readonly PptxStandardComponentDefinition[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.filter((c) => c.category === category);
}

export function getPptxContainerComponents(): readonly PptxStandardComponentDefinition[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.filter((c) => c.hasChildren);
}

export function getPptxContentComponents(): readonly PptxStandardComponentDefinition[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.filter((c) => !c.hasChildren);
}

export function isPptxStandardComponent(name: string): boolean {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.some((c) => c.name === name);
}

// ============================================================================
// Schema Generation Helpers
// ============================================================================

export function createPptxComponentSchemaObject(
  component: PptxStandardComponentDefinition,
  recursiveRef?: TSchema
): TSchema {
  const schema: Record<string, TSchema> = {
    name: Type.Literal(component.name),
    id: Type.Optional(Type.String()),
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          'When false, this component is filtered out and not rendered. Defaults to true.',
      })
    ),
  };

  if (component.special?.hasSchemaField) {
    schema.$schema = Type.Optional(Type.String({ format: 'uri' }));
  }

  schema.props = component.propsSchema;

  if (component.hasChildren && recursiveRef) {
    schema.children = Type.Optional(Type.Array(recursiveRef));
  }

  if (component.hasPlaceholders && recursiveRef) {
    const baseProperties = (component.propsSchema as any).properties ?? {};
    schema.props = Type.Object(
      {
        ...baseProperties,
        placeholders: Type.Optional(
          Type.Record(
            Type.String(),
            recursiveRef,
            { description: 'Content for named placeholders: { "title": { "name": "text", ... } }' }
          )
        ),
      },
      { additionalProperties: false, description: (component.propsSchema as any).description }
    );
  }

  return Type.Object(schema, { additionalProperties: false });
}

export function createAllPptxComponentSchemas(
  recursiveRef?: TSchema
): readonly TSchema[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.map((component) =>
    createPptxComponentSchemaObject(component, recursiveRef)
  );
}

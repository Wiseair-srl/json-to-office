/**
 * Unified Schema Export Utility
 *
 * Single source of truth for converting TypeBox schemas to JSON Schema format.
 * Eliminates duplication between generate-schemas.mjs and plugin/schema.ts
 */

import { TSchema } from '@sinclair/typebox';

/**
 * Configuration for a component schema
 */
export interface ComponentSchemaConfig {
  schema: TSchema;
  title: string;
  description: string;
  requiresName?: boolean;
  enhanceForRichContent?: boolean;
}

/**
 * Fix TypeBox recursive references in a schema
 * Handles both "T0" and "ComponentDefinition" reference patterns
 */
export function fixSchemaReferences(
  schema: Record<string, unknown>,
  rootDefinitionName = 'ComponentDefinition'
): void {
  function traverse(obj: Record<string, unknown>, path = ''): void {
    if (typeof obj !== 'object' || obj === null) return;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (value && typeof value === 'object') {
        // Type guard to check if value has expected properties
        const schemaValue = value as Record<string, unknown>;

        // Fix arrays with empty items
        if (
          schemaValue.type === 'array' &&
          schemaValue.items &&
          Object.keys(schemaValue.items).length === 0
        ) {
          schemaValue.items = {
            $ref: `#/definitions/${rootDefinitionName}`,
          };
        }

        // Fix arrays with items that reference broken "T0"
        if (
          schemaValue.type === 'array' &&
          schemaValue.items &&
          typeof schemaValue.items === 'object' &&
          '$ref' in schemaValue.items &&
          (schemaValue.items as Record<string, unknown>).$ref === 'T0'
        ) {
          schemaValue.items = {
            $ref: `#/definitions/${rootDefinitionName}`,
          };
        }

        // Fix direct $ref properties that point to "T0" or bare definition names
        if (
          schemaValue.$ref === 'T0' ||
          schemaValue.$ref === rootDefinitionName
        ) {
          schemaValue.$ref = `#/definitions/${rootDefinitionName}`;
        }

        // Remove problematic $id properties that reference "T0"
        if (
          key === '$id' &&
          typeof value === 'string' &&
          (value === 'T0' || value === rootDefinitionName) &&
          currentPath !== `definitions.${rootDefinitionName}.$id`
        ) {
          delete obj[key];
          continue;
        }

        traverse(value as Record<string, unknown>, currentPath);
      }
    }
  }

  traverse(schema);
}

/**
 * Convert TypeBox schema to JSON Schema format with proper definitions
 */
export function convertToJsonSchema(
  schema: TSchema,
  options: {
    $schema?: string;
    $id?: string;
    title?: string;
    description?: string;
    definitions?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  const {
    $schema = 'https://json-schema.org/draft-07/schema#',
    $id,
    title,
    description,
    definitions = {},
  } = options;

  // Clone the schema to avoid mutations
  const schemaJson = JSON.parse(JSON.stringify(schema));

  // Extract recursive schemas to definitions
  const extractedDefinitions: Record<string, unknown> = { ...definitions };

  function extractRecursiveSchemas(
    obj: Record<string, unknown>,
    path = ''
  ): void {
    if (typeof obj !== 'object' || obj === null) return;

    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object') {
        const schemaValue = value as Record<string, unknown>;

        // If this schema has an $id, extract it to definitions
        if (schemaValue.$id && typeof schemaValue.$id === 'string') {
          const definitionName = schemaValue.$id;

          // Don't extract if it's already in the root definitions section
          if (path !== `definitions.${definitionName}`) {
            // Clone the schema without the $id
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { $id: _, ...schemaWithoutId } = schemaValue;
            extractedDefinitions[definitionName] = schemaWithoutId;

            // Replace the inline schema with a $ref
            obj[key] = { $ref: `#/definitions/${definitionName}` };

            // Continue processing the extracted schema for nested recursions
            extractRecursiveSchemas(
              schemaWithoutId,
              `definitions.${definitionName}`
            );
            continue;
          }
        }

        extractRecursiveSchemas(
          value as Record<string, unknown>,
          path ? `${path}.${key}` : key
        );
      }
    }
  }

  // Extract recursive schemas from the main schema
  extractRecursiveSchemas(schemaJson);

  // Build the final JSON Schema
  const jsonSchema: Record<string, unknown> = {
    $schema,
  };

  if ($id) jsonSchema.$id = $id;

  // Merge schema properties first to preserve original metadata
  Object.assign(jsonSchema, schemaJson);

  // Only override title and description if explicitly provided
  if (title !== undefined) jsonSchema.title = title;
  if (description !== undefined) jsonSchema.description = description;

  // Add definitions section if we have any
  if (Object.keys(extractedDefinitions).length > 0) {
    jsonSchema.definitions = extractedDefinitions;
  }

  // Fix any remaining recursive references
  fixSchemaReferences(jsonSchema);

  return jsonSchema;
}

/**
 * Create a component schema with proper structure
 */
export function createComponentSchema(
  name: string,
  config: ComponentSchemaConfig,
  componentDefinitionSchema?: TSchema
): Record<string, unknown> {
  const componentStructure: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft-07/schema#',
    $id: `${name}.schema.json`,
    title: config.title,
    description: config.description,
    type: 'object',
    required: ['name', 'props'],
    properties: {
      name: {
        type: 'string',
        const: name,
        description: `Component name identifier (must be "${name}")`,
      },
      id: {
        type: 'string',
        description: 'Optional unique identifier for the component',
      },
      props: JSON.parse(JSON.stringify(config.schema)),
    },
  };

  // Add children array for container types
  if (['report', 'section', 'columns', 'text-box'].includes(name)) {
    (componentStructure.properties as Record<string, unknown>).children = {
      type: 'array',
      description: 'Children within this container',
      items: {
        $ref: '#/definitions/ComponentDefinition',
      },
    };

    // Add the ComponentDefinition for recursive references
    if (componentDefinitionSchema) {
      componentStructure.definitions = {
        ComponentDefinition: JSON.parse(
          JSON.stringify(componentDefinitionSchema)
        ),
      };
    }
  }

  // Enhance table component to support rich content in cells
  if (config.enhanceForRichContent && name === 'table') {
    // Add ComponentDefinition to support rich content in table cells
    const componentStructureWithDefs = componentStructure as Record<
      string,
      unknown
    > & {
      definitions?: Record<string, unknown>;
    };
    if (!componentStructureWithDefs.definitions) {
      componentStructureWithDefs.definitions = {};
    }
    if (componentDefinitionSchema) {
      componentStructureWithDefs.definitions.ComponentDefinition = JSON.parse(
        JSON.stringify(componentDefinitionSchema)
      );
    }

    // Enhance the rows.items.items to support components
    const properties = componentStructure.properties as Record<string, unknown>;
    const propsProp = properties.props as Record<string, unknown> | undefined;
    if (
      propsProp?.properties &&
      typeof propsProp.properties === 'object' &&
      propsProp.properties !== null
    ) {
      const propsProps = propsProp.properties as Record<string, unknown>;
      const rowsProp = propsProps.rows as Record<string, unknown> | undefined;
      if (
        rowsProp?.items &&
        typeof rowsProp.items === 'object' &&
        rowsProp.items !== null
      ) {
        const rowsItems = rowsProp.items as Record<string, unknown>;
        const cellSchema = rowsItems.items as
          | Record<string, unknown>
          | undefined;

        // If it has anyOf, add component reference as an option
        if (cellSchema?.anyOf && Array.isArray(cellSchema.anyOf)) {
          // Check if component reference isn't already there
          const hasComponentRef = cellSchema.anyOf.some((item: unknown) => {
            const itemObj = item as Record<string, unknown>;
            return itemObj.$ref === '#/definitions/ComponentDefinition';
          });
          if (!hasComponentRef) {
            cellSchema.anyOf.push({
              description:
                'Rich content cell with component (e.g., image, paragraph)',
              $ref: '#/definitions/ComponentDefinition',
            });
          }
        }
      }
    }
  }

  // Fix empty items in arrays and broken references
  fixSchemaReferences(componentStructure);

  componentStructure.additionalProperties = false;

  return componentStructure;
}

/**
 * Export schema to file with proper formatting
 */
export async function exportSchemaToFile(
  schema: Record<string, unknown>,
  outputPath: string,
  options: {
    prettyPrint?: boolean;
  } = {}
): Promise<void> {
  const { prettyPrint = true } = options;

  // Convert to JSON string
  const jsonSchema = prettyPrint
    ? JSON.stringify(schema, null, 2)
    : JSON.stringify(schema);

  // Write to file
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, jsonSchema, 'utf-8');
}

/**
 * Component metadata registry
 * Single source of truth for component titles and descriptions
 */
export const COMPONENT_METADATA: Record<
  string,
  Omit<ComponentSchemaConfig, 'schema'>
> = {
  report: {
    title: 'Report Component',
    description:
      'Top-level report container component with document-wide settings',
  },
  section: {
    title: 'Section Component',
    description: 'Section container for organizing document content',
  },
  columns: {
    title: 'Columns Component',
    description: 'Multi-column layout container',
  },
  heading: {
    title: 'Heading Component',
    description: 'Heading text with configurable levels and styling',
  },
  paragraph: {
    title: 'Paragraph Component',
    description: 'Rich paragraph text content with formatting options',
  },
  'text-box': {
    title: 'Text Box Component',
    description:
      'Inline or floating container that groups text and image components with shared positioning',
  },
  image: {
    title: 'Image Component',
    description: 'Image content with positioning and sizing options',
  },
  statistic: {
    title: 'Statistic Component',
    description: 'Statistical display with value and label',
  },
  table: {
    title: 'Table Component',
    description: 'Tabular data display with headers and rows',
    enhanceForRichContent: true,
  },
  header: {
    title: 'Header Component',
    description: 'Document header with page numbering and metadata',
  },
  footer: {
    title: 'Footer Component',
    description: 'Document footer with page numbering and metadata',
  },
  list: {
    title: 'List Component',
    description: 'Ordered or unordered list with nested items',
  },
  highcharts: {
    title: 'Highcharts Component',
    description:
      'Charts powered by Highcharts (line, bar, pie, heatmap, etc.) with rich configuration',
  },
};

/**
 * Base schema metadata registry
 */
export const BASE_SCHEMA_METADATA: Record<
  string,
  { title: string; description: string }
> = {
  alignment: {
    title: 'Alignment',
    description: 'Text alignment options',
  },
  'base-component': {
    title: 'Base Component Props',
    description: 'Common props for all components',
  },
  border: {
    title: 'Border',
    description: 'Border styling configuration',
  },
  spacing: {
    title: 'Spacing',
    description: 'Spacing configuration for before and after elements',
  },
  margins: {
    title: 'Margins',
    description: 'Margin configuration for all sides',
  },
  indent: {
    title: 'Indent',
    description: 'Indentation configuration',
  },
  'line-spacing': {
    title: 'Line Spacing',
    description: 'Line height and spacing configuration',
  },
  'heading-level': {
    title: 'Heading Level',
    description: 'Heading level from 1 to 6',
  },
  numbering: {
    title: 'Numbering',
    description: 'Numbering configuration for ordered lists',
  },
  'justified-alignment': {
    title: 'Justified Alignment',
    description: 'Justified text alignment options',
  },
};

/**
 * Theme schema metadata
 */
export const THEME_SCHEMA_METADATA = {
  theme: {
    title: 'Theme Configuration',
    description: 'JSON theme configuration for document styling and appearance',
  },
};

/**
 * Unified Presentation Schema Generator
 *
 * Generates JSON schemas that include both standard and custom plugin components.
 * Used at build-time for static schema files and at runtime for plugin-aware validation.
 */
import { Type, TSchema } from '@sinclair/typebox';
import {
  createPptxComponentSchemaObject,
  createAllPptxComponentSchemasNarrowed,
  type PptxStandardComponentDefinition,
} from './component-registry';

export interface VersionedPropsEntry {
  version: string;
  propsSchema: TSchema;
  hasChildren?: boolean;
  description?: string;
}

export interface CustomComponentInfo {
  name: string;
  versions: VersionedPropsEntry[];
}

export interface GenerateSchemaOptions {
  customComponents?: CustomComponentInfo[];
  includeMetadata?: boolean;
}

/**
 * Generate a unified presentation schema that includes standard + custom components.
 * Uses Type.Recursive so container components (presentation, slide) can have children.
 */
export function generateUnifiedDocumentSchema(
  options: GenerateSchemaOptions = {}
): TSchema {
  const { customComponents = [] } = options;

  return Type.Recursive((Self) => {
    // ── Phase 1: Build plugin schemas (plugins get Self for arbitrary nesting) ──
    const pluginSchemas: TSchema[] = [];

    for (const custom of customComponents) {
      if (custom.versions.length > 0) {
        const latest = custom.versions.reduce((a, b) =>
          a.version > b.version ? a : b
        );
        const customDef: PptxStandardComponentDefinition = {
          name: custom.name,
          propsSchema: latest.propsSchema,
          hasChildren: latest.hasChildren ?? false,
          category: 'content',
          description: custom.name,
        };
        pluginSchemas.push(createPptxComponentSchemaObject(customDef, Self));
      }
    }

    // ── Phase 2: Build standard components with narrowed children ──
    const standardSchemas = createAllPptxComponentSchemasNarrowed(
      Self,
      pluginSchemas
    );

    const componentSchemas = [...standardSchemas, ...pluginSchemas];

    if (componentSchemas.length === 0) {
      return Type.Object({});
    }

    return Type.Union(componentSchemas);
  });
}

import { Type, TSchema, TObject } from '@sinclair/typebox';
import { latestVersion } from '@json-to-docx/shared';
import type { CustomComponent } from './createComponent';
import {
  ReportPropsSchema,
  SectionPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ListPropsSchema,
  ImagePropsSchema,
  TablePropsSchema,
} from '@json-to-docx/shared';
import { generateUnifiedDocumentSchema } from '@json-to-docx/shared/schemas/generator';

// Schema cache to avoid regenerating identical schemas
const schemaCache = new Map<string, TSchema>();

/**
 * Generate a JSON schema for plugin-enhanced documents at RUNTIME.
 *
 * Iterates each component's versions map to produce per-version
 * CustomComponentInfo entries for the unified schema generator.
 */
export function generatePluginDocumentSchema(
  customComponents: CustomComponent<any, any, any>[],
  includeStandardComponents = true
): TSchema {
  // Produce per-version CustomComponentInfo entries for version-discriminated validation
  const customComponentInfos = customComponents.map((component) => {
    const versionKeys = Object.keys(component.versions);

    // Build per-version props entries
    const versionedProps = versionKeys.map((v) => ({
      version: v,
      propsSchema: component.versions[v].propsSchema,
      hasChildren: component.versions[v].hasChildren === true,
      description: component.versions[v].description,
    }));

    // propsSchema is used as fallback label — use latest version's props
    const latestKey = versionKeys.reduce((a, b) => (a > b ? a : b));

    return {
      name: component.name,
      propsSchema: component.versions[latestKey].propsSchema,
      hasChildren: versionKeys.some(
        (v) => component.versions[v].hasChildren === true
      ),
      versionedProps,
    };
  });

  return generateUnifiedDocumentSchema({
    includeStandardComponents: includeStandardComponents,
    includeTheme: true,
    customComponents: customComponentInfos,
    title: 'Plugin Document Definition',
    description: 'Document definition with custom plugin components',
  });
}

/**
 * Create a union type from an array of schemas
 */
export function createUnionSchema(schemas: TSchema[]): TSchema {
  if (schemas.length === 0) {
    return Type.Any();
  }
  if (schemas.length === 1) {
    return schemas[0];
  }
  return Type.Union(schemas as [TSchema, TSchema, ...TSchema[]]);
}

/**
 * Export a plugin-enhanced JSON schema to a file at RUNTIME
 */
export async function exportPluginSchema(
  customComponents: CustomComponent<any, any, any>[],
  outputPath: string,
  options: {
    includeStandardComponents?: boolean;
    prettyPrint?: boolean;
  } = {}
): Promise<void> {
  const { includeStandardComponents = true, prettyPrint = true } = options;

  const { convertToJsonSchema, exportSchemaToFile } = await import(
    '@json-to-docx/shared/schemas/export'
  );

  const schema = generatePluginDocumentSchema(
    customComponents,
    includeStandardComponents
  );

  const jsonSchema = convertToJsonSchema(schema, {
    $schema: 'http://json-schema.org/draft-07/schema#',
  });

  await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint });
}

/**
 * Generate schemas for individual custom components (version-aware).
 * Produces per-version schemas keyed as `name` or `name@version`.
 */
export function generateComponentSchemas(
  customComponents: CustomComponent<any, any, any>[]
): Record<string, TSchema> {
  const schemas: Record<string, TSchema> = {};

  for (const component of customComponents) {
    const versionKeys = Object.keys(component.versions);
    const latest = latestVersion(versionKeys);

    for (const v of versionKeys) {
      const entry = component.versions[v];
      const cacheKey = `component_${component.name}@${v}`;

      if (schemaCache.has(cacheKey)) {
        schemas[`${component.name}@${v}`] = schemaCache.get(cacheKey)!;
      } else {
        const schemaObj = entry.propsSchema as TObject;
        const properties = schemaObj.properties || {};

        const componentSchemaProps: Record<string, TSchema> = {
          name: Type.Literal(component.name),
          version: Type.Optional(Type.Literal(v)),
          id: Type.Optional(Type.String()),
          ...properties,
        };

        if (entry.hasChildren) {
          componentSchemaProps.children = Type.Optional(Type.Array(Type.Any()));
        }

        const componentSchema = Type.Object(componentSchemaProps);
        schemaCache.set(cacheKey, componentSchema);
        schemas[`${component.name}@${v}`] = componentSchema;
      }
    }

    // Also add a "default" entry keyed by name (uses latest)
    const latestEntry = component.versions[latest];
    const defaultCacheKey = `component_${component.name}_default`;

    if (schemaCache.has(defaultCacheKey)) {
      schemas[component.name] = schemaCache.get(defaultCacheKey)!;
    } else {
      const schemaObj = latestEntry.propsSchema as TObject;
      const properties = schemaObj.properties || {};

      const componentSchemaProps: Record<string, TSchema> = {
        name: Type.Literal(component.name),
        id: Type.Optional(Type.String()),
        ...properties,
      };

      if (latestEntry.hasChildren) {
        componentSchemaProps.children = Type.Optional(Type.Array(Type.Any()));
      }

      const componentSchema = Type.Object(componentSchemaProps);
      schemaCache.set(defaultCacheKey, componentSchema);
      schemas[component.name] = componentSchema;
    }
  }

  return schemas;
}

/**
 * Merge custom component schemas with standard schemas
 */
export function mergeSchemas(
  customComponents: CustomComponent<any, any, any>[],
  standardSchemas?: Record<string, TSchema>
): Record<string, TSchema> {
  const customSchemas = generateComponentSchemas(customComponents);

  if (standardSchemas) {
    return {
      ...standardSchemas,
      ...customSchemas,
    };
  }

  const defaultStandardSchemas: Record<string, TSchema> = {
    report: Type.Object({
      name: Type.Literal('report'),
      id: Type.Optional(Type.String()),
      props: ReportPropsSchema,
      children: Type.Optional(Type.Array(Type.Any())),
    }),
    section: Type.Object({
      name: Type.Literal('section'),
      id: Type.Optional(Type.String()),
      props: SectionPropsSchema,
      children: Type.Optional(Type.Array(Type.Any())),
    }),
    heading: Type.Object({
      name: Type.Literal('heading'),
      id: Type.Optional(Type.String()),
      props: HeadingPropsSchema,
    }),
    text: Type.Object({
      name: Type.Literal('text'),
      id: Type.Optional(Type.String()),
      props: ParagraphPropsSchema,
    }),
    list: Type.Object({
      name: Type.Literal('list'),
      id: Type.Optional(Type.String()),
      props: ListPropsSchema,
    }),
    image: Type.Object({
      name: Type.Literal('image'),
      id: Type.Optional(Type.String()),
      props: ImagePropsSchema,
    }),
    table: Type.Object({
      name: Type.Literal('table'),
      id: Type.Optional(Type.String()),
      props: TablePropsSchema,
    }),
  };

  return {
    ...defaultStandardSchemas,
    ...customSchemas,
  };
}

import type { TSchema } from '@sinclair/typebox';
import type { CustomComponent } from '@json-to-office/shared/plugin';
import {
  generateUnifiedDocumentSchema,
  type CustomComponentInfo,
} from '@json-to-office/shared-pptx';

/**
 * Generate a JSON schema for plugin-enhanced presentations at RUNTIME.
 */
export function generatePluginPresentationSchema(
  customComponents: CustomComponent<any, any, any>[]
): TSchema {
  const customComponentInfos: CustomComponentInfo[] = customComponents.map(
    (component) => {
      const versionKeys = Object.keys(component.versions);

      const versions = versionKeys.map((v) => ({
        version: v,
        propsSchema: component.versions[v].propsSchema,
        hasChildren: component.versions[v].hasChildren === true,
        description: component.versions[v].description,
      }));

      return {
        name: component.name,
        versions,
      };
    }
  );

  return generateUnifiedDocumentSchema({
    customComponents: customComponentInfos,
  });
}

/**
 * Export a plugin-enhanced JSON schema to a file at RUNTIME
 */
export async function exportPluginSchema(
  customComponents: CustomComponent<any, any, any>[],
  outputPath: string,
  options: { prettyPrint?: boolean } = {}
): Promise<void> {
  const { prettyPrint = true } = options;

  const { convertToJsonSchema, exportSchemaToFile } = await import(
    '@json-to-office/shared'
  );

  const schema = generatePluginPresentationSchema(customComponents);

  const jsonSchema = convertToJsonSchema(schema, {
    $schema: 'http://json-schema.org/draft-07/schema#',
  });

  await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint });
}

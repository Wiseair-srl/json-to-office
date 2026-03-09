/**
 * Builds and caches the full JSON schema per format for AI structured output.
 */
import { Container } from '../container/index.js';

const schemaCache = new Map<string, any>();

function cleanupTypeBoxIds(schema: any): void {
  if (typeof schema !== 'object' || schema === null) return;
  if (schema.$id && /^T\d+$/.test(schema.$id)) delete schema.$id;
  if (schema.$ref && /^T\d+$/.test(schema.$ref))
    schema.$ref = '#/definitions/ComponentDefinition';
  if (Array.isArray(schema)) {
    schema.forEach(cleanupTypeBoxIds);
    return;
  }
  Object.keys(schema).forEach((key) => {
    if (typeof schema[key] === 'object' && schema[key] !== null)
      cleanupTypeBoxIds(schema[key]);
  });
}

export async function getDocumentSchema(format: string): Promise<any> {
  const cacheKey = `${format}:document`;
  if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey);

  let schema: any;
  if (format === 'docx') {
    const shared = await import('@json-to-office/shared-docx');
    const unified = shared.generateUnifiedDocumentSchema({
      customComponents: [],
    });
    schema = shared.convertToJsonSchema(unified, {
      title: 'JSON to DOCX Document',
      description: 'Schema for JSON to DOCX document definitions',
    });
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    const unified = shared.generateUnifiedDocumentSchema({
      customComponents: [],
    });
    schema = shared.convertToJsonSchema(unified, {
      title: 'JSON to PPTX Presentation',
      description: 'Schema for JSON to PPTX presentation definitions',
    });
  }

  // Remove $schema URI — not needed for AI context
  delete schema.$schema;
  delete schema.$id;
  cleanupTypeBoxIds(schema);

  schemaCache.set(cacheKey, schema);
  return schema;
}

export async function getThemeSchema(format: string): Promise<any> {
  const cacheKey = `${format}:theme`;
  if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey);

  let schema: any;
  if (format === 'docx') {
    const shared = await import('@json-to-office/shared-docx');
    schema = shared.convertToJsonSchema(shared.ThemeConfigSchema, {
      title: 'JSON to DOCX Theme',
      description: 'Schema for DOCX theme configuration',
    });
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    schema = shared.convertToJsonSchema(shared.ThemeConfigSchema, {
      title: 'JSON to PPTX Theme',
      description: 'Schema for PPTX theme configuration',
    });
  }

  delete schema.$schema;
  delete schema.$id;
  cleanupTypeBoxIds(schema);

  schemaCache.set(cacheKey, schema);
  return schema;
}

export async function getSchemaString(format: string, docType: 'document' | 'theme'): Promise<string> {
  const schema = docType === 'theme'
    ? await getThemeSchema(format)
    : await getDocumentSchema(format);
  return JSON.stringify(schema, null, 2);
}

export function getDocumentSchemaString(format: string): Promise<string> {
  return getSchemaString(format, 'document');
}

export function getFormatFromContainer(): string {
  return Container.getAdapter().name;
}

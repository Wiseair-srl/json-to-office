/**
 * Schema Utilities
 * Type-safe utilities for working with TypeBox schemas
 */

import type { TSchema, TUnion, TObject, TLiteral } from '@sinclair/typebox';

/**
 * Cache for extracted component names to improve performance
 * Key is a string representation of the schema for comparison
 */
const componentNamesCache = new Map<unknown, string[]>();

/**
 * Type guard to check if a schema is a Union type
 */
export function isUnionSchema(schema: TSchema): schema is TUnion {
  // TypeBox Union schemas have an anyOf property
  return 'anyOf' in schema && Array.isArray(schema.anyOf);
}

/**
 * Type guard to check if a schema is an Object type
 */
export function isObjectSchema(schema: TSchema): schema is TObject {
  return schema.type === 'object' && 'properties' in schema;
}

/**
 * Type guard to check if a schema is a Literal type
 */
export function isLiteralSchema(schema: TSchema): schema is TLiteral {
  return 'const' in schema;
}

/**
 * Extract property names from an Object schema
 */
export function getObjectSchemaPropertyNames(schema: TSchema): string[] {
  if (isObjectSchema(schema)) {
    return Object.keys(schema.properties);
  }
  return [];
}

/**
 * Extract literal value from a Literal schema
 */
export function getLiteralValue(schema: TSchema): unknown {
  if (isLiteralSchema(schema)) {
    return schema.const;
  }
  return undefined;
}

/**
 * Extract standard component names from a Union schema
 * Uses caching for performance optimization
 */
export function extractStandardComponentNames(schema: TSchema): string[] {
  // Check cache first
  if (componentNamesCache.has(schema)) {
    return componentNamesCache.get(schema)!;
  }

  const names: string[] = [];

  // Handle Union schemas - TypeBox unions have anyOf property
  if ('anyOf' in schema && Array.isArray(schema.anyOf)) {
    for (const componentSchema of schema.anyOf) {
      if (isObjectSchema(componentSchema)) {
        const nameProperty = componentSchema.properties?.name;
        if (nameProperty && isLiteralSchema(nameProperty)) {
          const nameValue = getLiteralValue(nameProperty);
          if (typeof nameValue === 'string') {
            names.push(nameValue);
          }
        }
      }
    }
  }
  // Handle single object schema (TypeBox optimizes single-element unions)
  else if (isObjectSchema(schema)) {
    const nameProperty = schema.properties?.name ?? schema.properties?.type;
    if (nameProperty && isLiteralSchema(nameProperty)) {
      const nameValue = getLiteralValue(nameProperty);
      if (typeof nameValue === 'string') {
        names.push(nameValue);
      }
    }
  }

  // Cache the result using the schema object as key
  componentNamesCache.set(schema, names);
  return names;
}

/**
 * Clear the component names cache (useful for testing)
 */
export function clearComponentNamesCache(): void {
  componentNamesCache.clear();
}

/**
 * Get schema metadata for error reporting
 */
export function getSchemaMetadata(schema: TSchema): {
  type?: string;
  properties?: string[];
  literal?: unknown;
} {
  const metadata: {
    type?: string;
    properties?: string[];
    literal?: unknown;
  } = {};

  if ('type' in schema) {
    metadata.type = String(schema.type);
  }

  if (isObjectSchema(schema)) {
    metadata.properties = getObjectSchemaPropertyNames(schema);
  }

  if (isLiteralSchema(schema)) {
    metadata.literal = getLiteralValue(schema);
  }

  return metadata;
}

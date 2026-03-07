import type { TSchema, TUnion, TObject, TLiteral } from '@sinclair/typebox';

const componentNamesCache = new Map<unknown, string[]>();

export function isUnionSchema(schema: TSchema): schema is TUnion {
  return 'anyOf' in schema && Array.isArray(schema.anyOf);
}

export function isObjectSchema(schema: TSchema): schema is TObject {
  return schema.type === 'object' && 'properties' in schema;
}

export function isLiteralSchema(schema: TSchema): schema is TLiteral {
  return 'const' in schema;
}

export function getObjectSchemaPropertyNames(schema: TSchema): string[] {
  if (isObjectSchema(schema)) {
    return Object.keys(schema.properties);
  }
  return [];
}

export function getLiteralValue(schema: TSchema): unknown {
  if (isLiteralSchema(schema)) {
    return schema.const;
  }
  return undefined;
}

export function extractStandardComponentNames(schema: TSchema): string[] {
  if (componentNamesCache.has(schema)) {
    return componentNamesCache.get(schema)!;
  }

  const names: string[] = [];

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
  } else if (isObjectSchema(schema)) {
    const nameProperty = schema.properties?.name ?? schema.properties?.type;
    if (nameProperty && isLiteralSchema(nameProperty)) {
      const nameValue = getLiteralValue(nameProperty);
      if (typeof nameValue === 'string') {
        names.push(nameValue);
      }
    }
  }

  componentNamesCache.set(schema, names);
  return names;
}

export function clearComponentNamesCache(): void {
  componentNamesCache.clear();
}

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

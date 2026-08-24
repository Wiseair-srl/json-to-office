import { Type, TSchema } from '@sinclair/typebox';
import { restructureNameDiscriminatedUnions } from './discriminated-unions';
import type { ComponentDefinition } from '../types/components';

export interface ComponentSchemaConfig {
  schema: TSchema;
  title: string;
  description: string;
  requiresName?: boolean;
  enhanceForRichContent?: boolean;
}

function replaceRefs(
  obj: Record<string, unknown>,
  target: string,
  replacement: string
): void {
  if (typeof obj !== 'object' || obj === null) return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        replaceRefs(item as Record<string, unknown>, target, replacement);
      }
    });
    return;
  }
  if (obj.$ref === target) {
    obj.$ref = replacement;
  }
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      replaceRefs(value as Record<string, unknown>, target, replacement);
    }
  }
}

/**
 * Resolve the bare `$ref` values TypeBox leaves behind into JSON Pointers.
 *
 * `rootDefinitionName` is only the fallback for a reference that names nothing
 * hoisted. A schema may carry several recursive definitions — the DOCX
 * document schema carries one per renderer — so a bare reference that matches
 * an actual definition resolves to *that* one, which is what keeps the two
 * renderer views from collapsing into whichever was walked last.
 */
export function fixSchemaReferences(
  schema: Record<string, unknown>,
  rootDefinitionName = 'ComponentDefinition'
): void {
  const definitionNames = new Set(
    Object.keys(
      (schema.definitions as Record<string, unknown> | undefined) ?? {}
    )
  );
  // Undefined when nothing by either name was hoisted. Substituting the root
  // name regardless is how a reference to a definition that does not exist got
  // written, and Ajv refuses to compile a schema containing one — so an
  // unresolved reference is dropped rather than invented.
  const definitionRef = (name: string): string | undefined => {
    const target = definitionNames.has(name) ? name : rootDefinitionName;
    return definitionNames.has(target) ? `#/definitions/${target}` : undefined;
  };
  const isBareDefinitionRef = (value: unknown): value is string =>
    typeof value === 'string' &&
    (/^T\d+$/.test(value) ||
      value === rootDefinitionName ||
      definitionNames.has(value));

  function traverse(obj: Record<string, unknown>, path = ''): void {
    if (typeof obj !== 'object' || obj === null) return;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (value && typeof value === 'object') {
        const schemaValue = value as Record<string, unknown>;

        // Only when there is something to point at. A schema that holds
        // components without embedding their definition (the theme schema
        // holds `componentDefaults` but cannot carry a renderer's component
        // union) keeps its untyped item: a `$ref` to a definition that was
        // never hoisted is unresolvable, and Ajv refuses to compile the whole
        // schema over it.
        if (
          schemaValue.type === 'array' &&
          schemaValue.items &&
          Object.keys(schemaValue.items).length === 0 &&
          definitionNames.has(rootDefinitionName)
        ) {
          schemaValue.items = {
            $ref: `#/definitions/${rootDefinitionName}`,
          };
        }

        if (
          schemaValue.type === 'array' &&
          schemaValue.items &&
          typeof schemaValue.items === 'object' &&
          '$ref' in schemaValue.items &&
          isBareDefinitionRef(
            (schemaValue.items as Record<string, unknown>).$ref
          )
        ) {
          const name = (schemaValue.items as Record<string, unknown>)
            .$ref as string;
          const ref = definitionRef(name);
          // Untyped rather than dangling when the target was never hoisted.
          schemaValue.items = ref ? { $ref: ref } : {};
        }

        if (isBareDefinitionRef(schemaValue.$ref)) {
          const ref = definitionRef(schemaValue.$ref as string);
          if (ref) schemaValue.$ref = ref;
          else delete schemaValue.$ref;
        }

        if (
          key === '$id' &&
          isBareDefinitionRef(value) &&
          currentPath !== `definitions.${value}.$id`
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
    $schema = 'http://json-schema.org/draft-07/schema#',
    $id,
    title,
    description,
    definitions = {},
  } = options;

  const schemaJson = JSON.parse(JSON.stringify(schema));

  if (
    schemaJson.$id &&
    typeof schemaJson.$id === 'string' &&
    /^T\d+$/.test(schemaJson.$id)
  ) {
    const recursiveId = schemaJson.$id;
    delete schemaJson.$id;
    replaceRefs(schemaJson, recursiveId, '#');
  }

  const extractedDefinitions: Record<string, unknown> = { ...definitions };

  function extractRecursiveSchemas(
    obj: Record<string, unknown>,
    path = ''
  ): void {
    if (typeof obj !== 'object' || obj === null) return;

    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object') {
        const schemaValue = value as Record<string, unknown>;

        if (schemaValue.$id && typeof schemaValue.$id === 'string') {
          const definitionName = schemaValue.$id;

          if (path !== `definitions.${definitionName}`) {
            const { $id: _id, ...schemaWithoutId } = schemaValue; // eslint-disable-line @typescript-eslint/no-unused-vars
            extractedDefinitions[definitionName] = schemaWithoutId;
            obj[key] = { $ref: `#/definitions/${definitionName}` };
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

  extractRecursiveSchemas(schemaJson);

  const jsonSchema: Record<string, unknown> = { $schema };

  if ($id) jsonSchema.$id = $id;

  Object.assign(jsonSchema, schemaJson);

  jsonSchema.$schema = $schema;
  if ($id) jsonSchema.$id = $id;
  if (title !== undefined) jsonSchema.title = title;
  if (description !== undefined) jsonSchema.description = description;

  if (Object.keys(extractedDefinitions).length > 0) {
    jsonSchema.definitions = extractedDefinitions;
  }

  fixSchemaReferences(jsonSchema);
  restructureNameDiscriminatedUnions(jsonSchema);

  return jsonSchema;
}

export function createComponentSchema(
  name: string,
  config: ComponentSchemaConfig,
  containerNames: string[],
  componentDefinitionSchema?: TSchema,
  // The definition the recursive children reference. Callers whose component
  // union is renderer-specific pass that renderer's name so the embedded
  // definition and the `$ref` pointing at it agree.
  rootDefinitionName = 'ComponentDefinition'
): Record<string, unknown> {
  const componentStructure: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
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

  if (containerNames.includes(name)) {
    (componentStructure.properties as Record<string, unknown>).children = {
      type: 'array',
      description: 'Children within this container',
      items: {
        $ref: `#/definitions/${rootDefinitionName}`,
      },
    };

    if (componentDefinitionSchema) {
      componentStructure.definitions = {
        [rootDefinitionName]: JSON.parse(
          JSON.stringify(componentDefinitionSchema)
        ),
      };
    }
  }

  fixSchemaReferences(componentStructure, rootDefinitionName);
  componentStructure.additionalProperties = false;

  return componentStructure;
}

export async function exportSchemaToFile(
  schema: Record<string, unknown>,
  outputPath: string,
  options: { prettyPrint?: boolean } = {}
): Promise<void> {
  const { prettyPrint = true } = options;
  const jsonSchema = prettyPrint
    ? JSON.stringify(schema, null, 2)
    : JSON.stringify(schema);
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, jsonSchema, 'utf-8');
}

/**
 * Create a TypeBox schema object for any component definition.
 * Works for both docx and pptx components.
 */
export function createComponentSchemaObject(
  component: ComponentDefinition,
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

  return Type.Object(schema, { additionalProperties: false });
}

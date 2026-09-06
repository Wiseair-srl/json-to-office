type Schema = Record<string, any>;

const object = (properties: Schema, required: string[]): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const pointer = {
  type: 'string',
  pattern: '^(|/.*)$',
  description: 'JSON Pointer, e.g. /title.',
};

/**
 * Derive an authoring view from the format/renderer/plugin component schemas.
 * Runtime validation still checks evaluated primitives. The authoring view
 * accepts bindings at value positions and describes component-producing
 * directives without making ordinary document props accept those directives.
 */
export function createBlockAuthoringSchema(
  definitions: Record<string, Schema>,
  componentDefinition: string,
  excludedComponents: readonly string[] = []
): Schema {
  const prefix = `BlockTemplate_${componentDefinition}`;
  const ref = (name: string): Schema => ({ $ref: `#/definitions/${name}` });
  const bodyName = `${prefix}_Body`;
  const valueBindingName = `${prefix}_Binding`;
  if (definitions[bodyName]) return ref(bodyName);

  const basicBindings: Schema[] = ['$slot', '$item', '$theme', '$context'].map(
    (key) => object({ [key]: pointer, default: {} }, [key])
  );
  const scalarBindings = [
    object({ $count: pointer }, ['$count']),
    object(
      {
        $join: { type: 'array', items: {} },
        separator: { type: 'string' },
        keepEmpty: { type: 'boolean' },
      },
      ['$join']
    ),
    object(
      {
        $measure: { enum: ['width', 'height'] },
        fraction: { type: 'number', minimum: 0, maximum: 1 },
        unit: { enum: ['pt', 'twip', 'in'] },
      },
      ['$measure']
    ),
  ];
  definitions[valueBindingName] = {
    anyOf: [
      ...basicBindings,
      ...scalarBindings,
      object({ $if: pointer, then: {}, else: {} }, ['$if', 'then']),
      object({ $each: pointer, template: {} }, ['$each', 'template']),
    ],
  };
  // Install placeholders before following recursive component references.
  definitions[bodyName] = {};
  const mapped = new Map<string, string>([[componentDefinition, bodyName]]);
  const withBindings = (literal: Schema): Schema =>
    Object.keys(literal).length
      ? { anyOf: [literal, ref(valueBindingName)] }
      : literal;

  const transform = (schema: Schema, bind = true): Schema => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
      return schema;
    if (typeof schema.$ref === 'string') {
      const original = schema.$ref.replace(/^#\/definitions\//, '');
      if (!definitions[original]) return schema;
      let name = mapped.get(original);
      if (!name) {
        name = `${prefix}_${original}`;
        mapped.set(original, name);
        definitions[name] = {};
        definitions[name] = transform(definitions[original], false);
      }
      const result = ref(name);
      return bind ? withBindings(result) : result;
    }
    const result: Schema = { ...schema };
    if (schema.properties)
      result.properties = Object.fromEntries(
        Object.entries(schema.properties as Record<string, Schema>).map(
          ([key, value]) => [
            key,
            // Literal component discriminators retain the canonical editor dispatch.
            ['name', 'version'].includes(key) && typeof value.const === 'string'
              ? value
              : transform(value),
          ]
        )
      );
    if (schema.patternProperties)
      result.patternProperties = Object.fromEntries(
        Object.entries(schema.patternProperties as Record<string, Schema>).map(
          ([key, value]) => [key, transform(value)]
        )
      );
    if (schema.items)
      result.items = Array.isArray(schema.items)
        ? schema.items.map((item: Schema) => transform(item))
        : transform(schema.items);
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === 'object'
    )
      result.additionalProperties = transform(schema.additionalProperties);
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (Array.isArray(schema[key]))
        result[key] = schema[key].map((branch: Schema) =>
          transform(branch, false)
        );
    }
    for (const key of ['if', 'then', 'else', 'not'] as const)
      if (schema[key]) result[key] = transform(schema[key], false);
    return bind ? withBindings(result) : result;
  };

  const source = definitions[componentDefinition];
  const components = (source.anyOf ?? [source]).filter(
    (branch: Schema) =>
      !excludedComponents.includes(branch.properties?.name?.const)
  );
  const componentName = `${prefix}_Components`;
  definitions[componentName] = {
    anyOf: components.map((branch: Schema) => transform(branch, false)),
  };
  const oneOrMany = {
    anyOf: [ref(bodyName), { type: 'array', items: ref(bodyName) }],
  };
  definitions[bodyName] = {
    anyOf: [
      ref(componentName),
      ...basicBindings,
      object({ $if: pointer, then: oneOrMany, else: oneOrMany }, [
        '$if',
        'then',
      ]),
      object({ $each: pointer, template: ref(bodyName) }, [
        '$each',
        'template',
      ]),
    ],
  };
  return ref(bodyName);
}

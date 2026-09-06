type Schema = Record<string, any>;

const object = (properties: Schema, required: string[]): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const pointer = (description: string): Schema => ({
  type: 'string',
  pattern: '^(|/.*)$',
  description,
});
const condition = pointer(
  'Test a slot by JSON Pointer, e.g. /subtitle. Missing, null, false, empty text and empty arrays select else; zero selects then.'
);
const each = pointer(
  'Repeat template for each entry in an array slot, e.g. /items. Read the current entry with $item.'
);
const thenDescription =
  'Value or components to emit when the slot tested by $if is present.';
const elseDescription =
  'Value or components to emit otherwise. Omit to produce no output.';
const templateDescription =
  'One template evaluated per array entry. Use $item for the current entry and a group for multiple components.';

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

  const basicBindings: Schema[] = Object.entries({
    $slot:
      'Read a named input slot by JSON Pointer, e.g. /title or /client/name.',
    $item:
      'Read the current $each entry by JSON Pointer. Use an empty string for the whole entry or /title for a property.',
    $theme:
      'Read the active theme by JSON Pointer, e.g. /colors/primary. A missing value requires a default.',
    $context:
      'Read document or section context by JSON Pointer, e.g. /document/title or /section/tracker.',
  }).map(([key, description]) =>
    object(
      {
        [key]: pointer(description),
        default: {
          description:
            'Fallback value or binding used only when the referenced value is missing. Null, false and empty values do not trigger it.',
        },
      },
      [key]
    )
  );
  const scalarBindings = [
    object(
      {
        $count: pointer(
          'Return the number of entries in an array slot, e.g. /items.'
        ),
      },
      ['$count']
    ),
    object(
      {
        $join: {
          type: 'array',
          items: {},
          description:
            'Evaluate these values or bindings and join them as text. Empty values are skipped unless keepEmpty is true.',
        },
        separator: {
          type: 'string',
          description:
            'Text inserted between joined values. Defaults to an empty string.',
        },
        keepEmpty: {
          type: 'boolean',
          description:
            'Keep missing, null, false, empty text and empty arrays in the join. Defaults to false.',
        },
      },
      ['$join']
    ),
    object(
      {
        $measure: {
          enum: ['width', 'height'],
          description:
            'Measure the usable page width or height after margins, using the containing section’s page settings.',
        },
        fraction: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Fraction of the measured dimension, from 0 to 1. Defaults to 1.',
        },
        unit: {
          enum: ['pt', 'twip', 'in'],
          description:
            'Measurement unit: points, twentieths of a point, or inches. Defaults to pt.',
        },
      },
      ['$measure']
    ),
  ];
  definitions[valueBindingName] = {
    anyOf: [
      ...basicBindings,
      ...scalarBindings,
      object(
        {
          $if: condition,
          then: { description: thenDescription },
          else: { description: elseDescription },
        },
        ['$if', 'then']
      ),
      object({ $each: each, template: { description: templateDescription } }, [
        '$each',
        'template',
      ]),
    ],
  };
  // Install placeholders before following recursive component references.
  definitions[bodyName] = {};
  const mapped = new Map<string, string>([[componentDefinition, bodyName]]);
  const withBindings = (literal: Schema): Schema =>
    Object.keys(literal).length
      ? {
          ...(literal.description && { description: literal.description }),
          ...(literal.markdownDescription && {
            markdownDescription: literal.markdownDescription,
          }),
          anyOf: [literal, ref(valueBindingName)],
        }
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
      const result = { ...schema, ...ref(name) };
      return bind ? withBindings(result) : result;
    }
    const result: Schema = { ...schema };
    if (schema.properties)
      result.properties = Object.fromEntries(
        Object.entries(schema.properties as Record<string, Schema>).map(
          ([key, value]) => [
            key,
            // Preserve literal discriminators and authored metadata. Generic
            // help on a const would override the component-specific choice
            // description, so generic key help belongs on the union property.
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
      object(
        {
          $if: condition,
          then: { ...oneOrMany, description: thenDescription },
          else: { ...oneOrMany, description: elseDescription },
        },
        ['$if', 'then']
      ),
      object(
        {
          $each: each,
          template: { ...ref(bodyName), description: templateDescription },
        },
        ['$each', 'template']
      ),
    ],
  };
  return ref(bodyName);
}

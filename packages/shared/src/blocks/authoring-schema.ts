import type { OfficeFormat } from '../rendering/types';
import {
  BLOCK_DIRECTIVES,
  BLOCK_OPERAND_ROOTS,
  type BlockDirective,
} from './directives';
import {
  arrayItemSchema,
  possibleValueTypes,
  type AuthoringSchema,
} from './schema-types';

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
const referenceDescriptions = (format: OfficeFormat) => ({
  $slot:
    'Read a named input slot by JSON Pointer, e.g. /title or /client/name.',
  $item:
    'Read the current $each entry by JSON Pointer. Use an empty string for the whole entry or /title for a property.',
  $theme:
    'Read the active theme by JSON Pointer, e.g. /colors/primary. A missing value requires a default.',
  $context:
    format === 'pptx'
      ? 'Read deck or slide context by JSON Pointer, e.g. /document/title, /slide/width or /slide/index.'
      : 'Read document or section context by JSON Pointer, e.g. /document/title or /section/tracker.',
});
const measureDescriptions = (format: OfficeFormat) =>
  format === 'pptx'
    ? {
        axis: 'Measure the slide canvas width or height, in the unit given.',
        unit: 'Measurement unit: points, twentieths of a point, or inches. Defaults to pt; use in for frame coordinates.',
      }
    : {
        axis: 'Measure the usable page width or height after margins, using the containing section’s page settings.',
        unit: 'Measurement unit: points, twentieths of a point, or inches. Defaults to pt.',
      };
const describe = (schema: AuthoringSchema, description: string): Schema => ({
  ...(typeof schema === 'boolean' ? { allOf: [schema] } : schema),
  description,
});
const metadata = (schema: AuthoringSchema): Schema =>
  typeof schema === 'boolean'
    ? {}
    : {
        ...(schema.description && { description: schema.description }),
        ...(schema.markdownDescription && {
          markdownDescription: schema.markdownDescription,
        }),
      };
const hasKey = (key: string): Schema => ({ type: 'object', required: [key] });
const directiveNames = Object.keys(BLOCK_DIRECTIVES) as BlockDirective[];

/**
 * Derive authoring from the renderer/plugin schemas without weakening ordinary
 * documents. Each value retains its literal schema and receives only directives
 * whose result family can fit. Defaults and conditional branches recurse into
 * that same value schema; repetition templates use the actual array item schema.
 *
 * Dispatch uses standard draft-07 conditionals, not overlapping anyOf branches:
 * existing literal keys keep literal completion, and a directive selects only
 * its own options. Empty/incomplete objects offer literal keys and directive
 * starters. Memoized references keep recursive schemas finite and avoid copying
 * the component graph into every default/then/else branch.
 */
export function createBlockAuthoringSchema(
  definitions: Record<string, Schema>,
  componentDefinition: string,
  excludedComponents: readonly string[] = [],
  format: OfficeFormat = 'docx'
): Schema {
  const prefix = `BlockTemplate_${componentDefinition}`;
  const references = referenceDescriptions(format);
  const measure = measureDescriptions(format);
  // `$if`, `$each` and `$count` take an operand: a slot pointer, or one
  // reference that reads the current `$each` entry, a slot or the context.
  const operand = (description: string): Schema => ({
    description,
    anyOf: [
      pointer(description),
      ...BLOCK_OPERAND_ROOTS.map((root) =>
        object({ [root]: pointer(references[root]) }, [root])
      ),
    ],
  });
  const bodyName = `${prefix}_Body`;
  const ref = (name: string): Schema => ({ $ref: `#/definitions/${name}` });
  if (definitions[bodyName]) return ref(bodyName);

  // Only resolve canonical input definitions. Generated schemas must never be
  // transformed again. Narrow the component root without changing the original.
  const originals: Record<string, Schema> = { ...definitions };
  const source = originals[componentDefinition];
  originals[componentDefinition] = {
    ...source,
    anyOf: (source.anyOf ?? [source]).filter(
      (branch: Schema) =>
        !excludedComponents.includes(branch.properties?.name?.const)
    ),
  };
  const resolve = (pointer: string): AuthoringSchema | undefined => {
    if (!pointer.startsWith('#/definitions/')) return undefined;
    let node: any = originals;
    for (const key of pointer.slice('#/definitions/'.length).split('/')) {
      const decoded = key.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!node || typeof node !== 'object' || !Object.hasOwn(node, decoded))
        return undefined;
      node = node[decoded];
    }
    return typeof node === 'boolean' || (node && typeof node === 'object')
      ? node
      : undefined;
  };

  const values = new Map<string, string>();
  const literals = new Map<string, string>();
  let nextId = 0;
  const componentRef = ref(componentDefinition);
  const shared = new Map<string, string>();
  const share = (schema: Schema): Schema => {
    const key = JSON.stringify(schema);
    let name = shared.get(key);
    if (!name) {
      name = `${prefix}_Shared${nextId++}`;
      shared.set(key, name);
      definitions[name] = schema;
    }
    return ref(name);
  };
  const presence = Object.fromEntries(
    directiveNames.map((key) => [key, share(hasKey(key))])
  );
  const anyDirective = share({ anyOf: Object.values(presence) });
  const starterPrefixes = [
    ...new Set([
      '',
      ...directiveNames.flatMap((key) =>
        Array.from({ length: key.length - 1 }, (_, index) =>
          key.slice(0, index + 1)
        )
      ),
    ]),
  ];
  const starterObject = share({
    type: 'object',
    // An enum here would itself become a list of bogus property suggestions.
    propertyNames: {
      pattern: `^(?:${starterPrefixes.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
    },
  });

  function literal(schema: AuthoringSchema): AuthoringSchema {
    if (typeof schema === 'boolean') return schema;
    const key = JSON.stringify(schema);
    const cached = literals.get(key);
    if (cached) return { ...ref(cached), ...metadata(schema) };
    const name = `${prefix}_Literal${nextId++}`;
    literals.set(key, name);
    definitions[name] = {};
    const result: Schema = { ...schema };
    if (typeof schema.$ref === 'string') {
      const target = resolve(schema.$ref);
      if (target !== undefined) {
        const transformed = literal(target);
        if (typeof transformed === 'object') result.$ref = transformed.$ref;
        else {
          delete result.$ref;
          if (!transformed) result.not = {};
        }
      }
    }
    if (schema.properties)
      result.properties = Object.fromEntries(
        Object.entries(
          schema.properties as Record<string, AuthoringSchema>
        ).map(([key, value]) => [
          key,
          // Literal discriminators retain canonical component/version dispatch
          // and their individual choice descriptions.
          ['name', 'version'].includes(key) &&
          typeof value === 'object' &&
          typeof value.const === 'string'
            ? value
            : author(value),
        ])
      );
    if (schema.patternProperties)
      result.patternProperties = Object.fromEntries(
        Object.entries(
          schema.patternProperties as Record<string, AuthoringSchema>
        ).map(([key, value]) => [key, author(value)])
      );
    if (schema.items !== undefined)
      result.items = Array.isArray(schema.items)
        ? schema.items.map((item: AuthoringSchema) => author(item, true))
        : author(schema.items, true);
    for (const key of ['additionalProperties', 'additionalItems'])
      if (typeof schema[key] === 'object')
        result[key] = author(schema[key], key === 'additionalItems');
    for (const key of ['anyOf', 'oneOf', 'allOf'])
      if (Array.isArray(schema[key]))
        // Keep branches inline so canonical name-union restructuring still sees
        // their discriminators. Their nested value schemas are shared references.
        result[key] = schema[key].map((branch: AuthoringSchema) => {
          const transformed = literal(branch);
          return typeof branch === 'object' &&
            typeof branch.properties?.name?.const === 'string' &&
            typeof transformed === 'object' &&
            transformed.$ref
            ? definitions[transformed.$ref.slice('#/definitions/'.length)]
            : transformed;
        });
    // Conditions/negations inspect literal values, not binding syntax.
    for (const key of ['then', 'else'])
      if (schema[key] !== undefined) result[key] = literal(schema[key]);
    definitions[name] = result;
    return { ...ref(name), ...metadata(schema) };
  }

  function author(input: AuthoringSchema, sequence = false): AuthoringSchema {
    if (input === false) return false;
    // Property help stays on the reference at the use site. It must not cause
    // duplicate binding graphs for otherwise identical value constraints.
    const annotations = metadata(input);
    const schema = typeof input === 'object' ? { ...input } : input;
    if (typeof schema === 'object') {
      delete schema.description;
      delete schema.markdownDescription;
    }
    const key = `${sequence ? 'sequence' : 'value'}:${JSON.stringify(schema)}`;
    const cached = values.get(key);
    if (cached) return { ...ref(cached), ...annotations };
    const name = `${prefix}_Value${nextId++}`;
    values.set(key, name);
    definitions[name] = {};
    const self = ref(name);
    const types = possibleValueTypes(schema, resolve);
    if (types.size === 0) {
      definitions[name] = { allOf: [literal(schema)] };
      return self;
    }
    const value = () => (sequence ? author(schema) : self);
    const branch = () =>
      sequence ? { anyOf: [self, { type: 'array', items: self }] } : self;
    const item = () =>
      sequence ? value() : author(arrayItemSchema(schema, resolve));
    const specs: Partial<Record<BlockDirective, Schema>> = {};
    for (const directive of directiveNames) {
      const result = BLOCK_DIRECTIVES[directive].result;
      if (
        result !== 'dynamic' &&
        !types.has(result) &&
        !(sequence && result === 'array')
      )
        continue;
      switch (directive) {
        case '$slot':
        case '$item':
        case '$theme':
        case '$context':
          specs[directive] = object(
            {
              [directive]: pointer(references[directive]),
              default: describe(
                value(),
                'Fallback value or binding used only when the referenced value is missing. Null, false and empty values do not trigger it.'
              ),
              ...(directive === '$slot' || directive === '$item'
                ? {
                    props: {
                      type: 'object',
                      description:
                        'Component props merged beneath a component-slot value. Put placement (x, y, w, h, grid) and styling defaults here; the slot content may override styling but never placement.',
                    },
                  }
                : {}),
            },
            [directive]
          );
          break;
        case '$if':
          specs[directive] = object(
            {
              $if: operand(
                'Test a slot by JSON Pointer, e.g. /subtitle, or a reference such as { "$item": "/numeric" }. Missing, null, false, empty text and empty arrays select else; zero selects then.'
              ),
              then: describe(
                branch(),
                'Value or components to emit when the slot tested by $if is present.'
              ),
              else: describe(
                branch(),
                'Value or components to emit otherwise. Omit to produce no output.'
              ),
            },
            ['$if', 'then']
          );
          break;
        case '$each':
          specs[directive] = object(
            {
              $each: operand(
                'Repeat template for each entry in an array slot, e.g. /items, or in an array of the current entry, { "$item": "/cells" }. Read the current entry with $item.'
              ),
              template: describe(
                item(),
                'One template evaluated per array entry. Use $item for the current entry and a group for multiple components.'
              ),
            },
            ['$each', 'template']
          );
          break;
        case '$count':
          specs[directive] = object(
            {
              $count: operand(
                'Return the number of entries in an array slot, e.g. /items, or in an array of the current entry, { "$item": "/cells" }.'
              ),
            },
            ['$count']
          );
          break;
        case '$join':
          specs[directive] = object(
            {
              $join: {
                type: 'array',
                items: author({}),
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
          );
          break;
        case '$measure':
          specs[directive] = object(
            {
              $measure: {
                enum: ['width', 'height'],
                description: measure.axis,
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
                description: measure.unit,
              },
            },
            ['$measure']
          );
          break;
        default: {
          const exhaustive: never = directive;
          throw new Error(
            `Missing authoring schema for directive ${exhaustive}`
          );
        }
      }
    }
    definitions[name] = {
      allOf: [
        {
          if: anyDirective,
          then: {
            allOf: directiveNames.map((directive) => ({
              if: presence[directive],
              then: specs[directive]
                ? share({
                    ...specs[directive],
                    properties: Object.fromEntries(
                      Object.entries(specs[directive]!.properties).map(
                        ([key, property]) => [key, share(property as Schema)]
                      )
                    ),
                  })
                : false,
            })),
          },
          else: literal(schema),
        },
        {
          // Keep starters while the first key is empty or a partial directive
          // ("$", "$sl", ...). Any ordinary or completed key ends this phase.
          // Prefixes come from the evaluator's directive registry.
          if: starterObject,
          then: {
            properties: Object.fromEntries(
              Object.entries(specs).map(([key, spec]) => [
                key,
                share(spec.properties[key]),
              ])
            ),
          },
        },
      ],
    };
    return { ...self, ...annotations };
  }

  definitions[bodyName] = author(componentRef, true) as Schema;
  return ref(bodyName);
}

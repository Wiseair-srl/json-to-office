/** JSON Schema type reasoning for authoring; never used as runtime validation. */
export type AuthoringSchema = boolean | Record<string, any>;
export type ValueType =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'object';
const allTypes: ValueType[] = [
  'null',
  'boolean',
  'number',
  'string',
  'array',
  'object',
];
type Resolve = (ref: string) => AuthoringSchema | undefined;
const intersection = (a: Set<ValueType>, b: Set<ValueType>) =>
  new Set([...a].filter((value) => b.has(value)));
const union = (sets: Set<ValueType>[]) =>
  new Set(sets.flatMap((set) => [...set]));
const typeOf = (value: unknown): ValueType =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : (typeof value as ValueType);

/** Conservative possible types: intersect constraints, combine union branches,
 * and resolve references with a cycle guard. Unknown schemas allow every type.
 * Integer is part of the numeric family; bounds and integrality still validate
 * on evaluated output, just as they do for a reference's unknown value.
 */
export function possibleValueTypes(
  schema: AuthoringSchema,
  resolve: Resolve,
  seen = new Set<AuthoringSchema>()
): Set<ValueType> {
  if (schema === false) return new Set();
  if (schema === true || seen.has(schema)) return new Set(allTypes);
  // Type.Never and plain negated type schemas exclude complete result families.
  // More specific negations (bounds/patterns/enum values) cannot safely exclude
  // an entire family and are left to ordinary literal/output validation.
  const negated = schema.not;
  if (
    negated === true ||
    (negated &&
      typeof negated === 'object' &&
      Object.keys(negated).length === 0)
  )
    return new Set();
  const next = new Set(seen).add(schema);
  let types = new Set(allTypes);
  if (schema.type) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
    types = intersection(
      types,
      new Set(
        allTypes.filter(
          (type) =>
            declared.includes(type) ||
            (type === 'number' && declared.includes('integer'))
        )
      )
    );
  }
  if (Object.hasOwn(schema, 'const'))
    types = intersection(types, new Set([typeOf(schema.const)]));
  if (Array.isArray(schema.enum))
    types = intersection(types, new Set(schema.enum.map(typeOf)));
  if (typeof schema.$ref === 'string') {
    const target = resolve(schema.$ref);
    if (target !== undefined)
      types = intersection(types, possibleValueTypes(target, resolve, next));
  }
  for (const key of ['anyOf', 'oneOf']) {
    if (Array.isArray(schema[key]))
      types = intersection(
        types,
        union(
          schema[key].map((branch: AuthoringSchema) =>
            possibleValueTypes(branch, resolve, next)
          )
        )
      );
  }
  if (Array.isArray(schema.allOf))
    for (const branch of schema.allOf)
      types = intersection(types, possibleValueTypes(branch, resolve, next));
  if (
    negated &&
    typeof negated === 'object' &&
    negated.type &&
    Object.keys(negated).every((key) =>
      ['type', 'description', 'title', '$comment'].includes(key)
    )
  ) {
    // Excluding integers alone does not exclude all numbers.
    const excluded = (
      Array.isArray(negated.type) ? negated.type : [negated.type]
    ).filter((type: string) => type !== 'integer');
    types = new Set([...types].filter((type) => !excluded.includes(type)));
  }
  return types;
}

/** Item constraints for an array-valued expression. For tuples, each iteration
 * may produce any tuple item type; final length/position validation stays with
 * the evaluated array. Unions keep alternatives and intersections keep all
 * applicable item constraints. References may be recursive.
 */
export function arrayItemSchema(
  schema: AuthoringSchema,
  resolve: Resolve,
  seen = new Set<AuthoringSchema>()
): AuthoringSchema {
  if (schema === false) return false;
  if (schema === true || seen.has(schema)) return {};
  const next = new Set(seen).add(schema);
  const constraints: AuthoringSchema[] = [];
  if (typeof schema.$ref === 'string') {
    const target = resolve(schema.$ref);
    if (target !== undefined)
      constraints.push(arrayItemSchema(target, resolve, next));
  }
  if (schema.items !== undefined)
    constraints.push(
      Array.isArray(schema.items)
        ? {
            anyOf: [
              ...schema.items,
              ...(schema.additionalItems === false
                ? []
                : [schema.additionalItems ?? {}]),
            ],
          }
        : schema.items
    );
  for (const key of ['anyOf', 'oneOf'])
    if (Array.isArray(schema[key])) {
      constraints.push({
        anyOf: schema[key]
          .filter((branch: AuthoringSchema) =>
            possibleValueTypes(branch, resolve).has('array')
          )
          .map((branch: AuthoringSchema) =>
            arrayItemSchema(branch, resolve, next)
          ),
      });
    }
  if (Array.isArray(schema.allOf))
    constraints.push(
      ...schema.allOf.map((branch: AuthoringSchema) =>
        arrayItemSchema(branch, resolve, next)
      )
    );
  return constraints.length === 0
    ? {}
    : constraints.length === 1
      ? constraints[0]
      : { allOf: constraints };
}

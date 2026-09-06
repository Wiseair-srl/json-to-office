import { describe, expect, it } from 'vitest';
import {
  arrayItemSchema,
  possibleValueTypes,
  type AuthoringSchema,
} from './schema-types';

const definitions: Record<string, AuthoringSchema> = {
  number: { type: 'number' },
  list: { type: 'array', items: { $ref: 'record' } },
  record: { type: 'object', properties: { next: { $ref: 'record' } } },
  cycle: { allOf: [{ $ref: 'cycle' }, { type: 'object' }] },
  impossible: false,
};
const resolve = (ref: string) => definitions[ref];

describe('block schema value types', () => {
  it.each([
    [{ type: 'integer' }, ['number']],
    [{ type: ['string', 'null'] }, ['null', 'string']],
    [{ enum: [1, 'auto', false] }, ['boolean', 'number', 'string']],
    [{ const: null }, ['null']],
    [{ anyOf: [{ type: 'number' }, { type: 'string' }] }, ['number', 'string']],
    [{ oneOf: [{ type: 'object' }, { type: 'array' }] }, ['array', 'object']],
    [
      { allOf: [{ type: ['number', 'string'] }, { $ref: 'number' }] },
      ['number'],
    ],
    [{ $ref: 'record' }, ['object']],
    [{ $ref: 'cycle' }, ['object']],
    [{ $ref: 'impossible' }, []],
    [false, []],
    [{ anyOf: [] }, []],
    [{ not: {} }, []],
    [{ type: ['number', 'string'], not: { type: 'string' } }, ['number']],
    [{ type: 'number', not: { type: 'integer' } }, ['number']],
  ] as [AuthoringSchema, string[]][])('infers %j', (schema, expected) => {
    expect([...possibleValueTypes(schema, resolve)].sort()).toEqual(expected);
  });
  it.each([true, {}, { $ref: 'external' }])(
    'keeps unconstrained/unresolved %j conservative',
    (schema) => {
      expect([...possibleValueTypes(schema, resolve)].sort()).toEqual([
        'array',
        'boolean',
        'null',
        'number',
        'object',
        'string',
      ]);
    }
  );
  it('resolves array items without unfolding recursive objects', () => {
    expect(arrayItemSchema({ $ref: 'list' }, resolve)).toEqual({
      $ref: 'record',
    });
  });
  it('keeps array alternatives and combines intersecting item constraints', () => {
    const schema = {
      allOf: [
        {
          anyOf: [
            { type: 'number' },
            { type: 'array', items: { type: 'object' } },
          ],
        },
        { type: 'array', items: { required: ['label'] } },
      ],
    };
    expect(arrayItemSchema(schema, resolve)).toEqual({
      allOf: [{ anyOf: [{ type: 'object' }] }, { required: ['label'] }],
    });
  });
  it('keeps open tuple tails unconstrained but honors closed tuples', () => {
    const items = [{ type: 'string' }, { type: 'number' }];
    expect(arrayItemSchema({ type: 'array', items }, resolve)).toEqual({
      anyOf: [...items, {}],
    });
    expect(
      arrayItemSchema({ type: 'array', items, additionalItems: false }, resolve)
    ).toEqual({ anyOf: items });
  });
});

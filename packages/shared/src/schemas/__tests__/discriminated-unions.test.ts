import { describe, it, expect } from 'vitest';
import {
  restructureNameDiscriminatedUnions,
  unionBranches,
} from '../discriminated-unions';

function branch(name: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { name: { const: name, type: 'string' } },
    required: ['name', 'props'],
    ...extra,
  };
}

describe('restructureNameDiscriminatedUnions', () => {
  it('rewrites a name union into the if/then dispatch shape', () => {
    const heading = branch('heading', { description: 'Heading element' });
    const image = branch('image');
    const schema: any = { items: { anyOf: [heading, image] } };
    restructureNameDiscriminatedUnions(schema);

    const items = schema.items;
    expect(items.anyOf).toBeUndefined();
    expect(items.type).toBe('object');
    expect(items.required).toEqual(['name']);
    expect(items.properties.name.anyOf).toEqual([
      { const: 'heading', type: 'string', description: 'Heading element' },
      { const: 'image', type: 'string' },
    ]);
    expect(items.allOf).toEqual([
      {
        if: { properties: { name: { const: 'heading' } }, required: ['name'] },
        then: heading,
      },
      {
        if: { properties: { name: { const: 'image' } }, required: ['name'] },
        then: image,
      },
    ]);
  });

  it('groups versioned plugin branches under one then, preferring the un-versioned description', () => {
    const v1 = branch('weather', { description: 'weather v1.0.0 — legacy' });
    (v1.properties as any).version = { const: '1.0.0', type: 'string' };
    const fallback = branch('weather', {
      description: 'weather (latest: v2.0.0) — mock',
    });
    const schema: any = { anyOf: [v1, fallback, branch('heading')] };
    restructureNameDiscriminatedUnions(schema);

    expect(schema.properties.name.anyOf).toEqual([
      {
        const: 'weather',
        type: 'string',
        description: 'weather (latest: v2.0.0) — mock',
      },
      { const: 'heading', type: 'string' },
    ]);
    expect(schema.allOf).toHaveLength(2);
    expect(schema.allOf[0].then).toEqual({ anyOf: [v1, fallback] });
    expect(schema.allOf[1].then.properties.name.const).toBe('heading');
  });

  it('skips unions with $ref, free-form branches, or name not required', () => {
    const withRef: any = {
      anyOf: [branch('heading'), { $ref: '#/definitions/ComponentDefinition' }],
    };
    const withPlain: any = { anyOf: [branch('heading'), { type: 'string' }] };
    const optionalName: any = {
      anyOf: [branch('heading'), { ...branch('image'), required: [] }],
    };
    for (const s of [withRef, withPlain, optionalName]) {
      restructureNameDiscriminatedUnions(s);
      expect(s.anyOf).toBeDefined();
      expect(s.allOf).toBeUndefined();
    }
  });

  it('skips single-branch unions and nodes with conflicting keywords', () => {
    const single: any = { anyOf: [branch('heading')] };
    const conflicting: any = {
      anyOf: [branch('heading'), branch('image')],
      properties: { name: { type: 'string' } },
    };
    restructureNameDiscriminatedUnions(single);
    restructureNameDiscriminatedUnions(conflicting);
    expect(single.allOf).toBeUndefined();
    expect(conflicting.anyOf).toBeDefined();
    expect(conflicting.properties.name).toEqual({ type: 'string' });
  });

  it('skips unions with a sibling additionalProperties', () => {
    // With no sibling `properties`, `additionalProperties: false` rejects
    // every key — declaring `name` in the rewrite would start allowing it.
    const schema: any = {
      anyOf: [branch('heading'), branch('image')],
      additionalProperties: false,
    };
    restructureNameDiscriminatedUnions(schema);
    expect(schema.anyOf).toBeDefined();
    expect(schema.allOf).toBeUndefined();
    expect(schema.properties).toBeUndefined();
  });

  it('recurses into nested children unions and is idempotent', () => {
    const inner = { anyOf: [branch('heading'), branch('image')] };
    const section = branch('section', {
      properties: {
        name: { const: 'section', type: 'string' },
        children: { type: 'array', items: inner },
      },
      required: ['name'],
    });
    const schema: any = { anyOf: [section, branch('paragraph')] };
    restructureNameDiscriminatedUnions(schema);
    restructureNameDiscriminatedUnions(schema);

    expect(schema.allOf).toHaveLength(2);
    const sectionThen = schema.allOf[0].then;
    const nested = sectionThen.properties.children.items;
    expect(nested.anyOf).toBeUndefined();
    expect(nested.allOf).toHaveLength(2);
    expect(nested.properties.name.anyOf.map((e: any) => e.const)).toEqual([
      'heading',
      'image',
    ]);
  });

  it('preserves node-level description and discriminator', () => {
    const schema: any = {
      description: 'Component definition',
      discriminator: { propertyName: 'name' },
      anyOf: [branch('heading'), branch('image')],
    };
    restructureNameDiscriminatedUnions(schema);
    expect(schema.description).toBe('Component definition');
    expect(schema.discriminator).toEqual({ propertyName: 'name' });
  });
});

describe('unionBranches', () => {
  it('iterates branches in both the flat and restructured shapes', () => {
    const flat: any = { anyOf: [branch('heading'), branch('image')] };
    const restructured: any = {
      anyOf: [branch('heading'), branch('weather'), branch('weather')],
    };
    restructureNameDiscriminatedUnions(restructured);

    expect(unionBranches(flat)).toHaveLength(2);
    const names = unionBranches(restructured).map(
      (b: any) => b.properties.name.const
    );
    expect(names).toEqual(['heading', 'weather', 'weather']);
    expect(unionBranches({ type: 'string' })).toEqual([]);
  });
});

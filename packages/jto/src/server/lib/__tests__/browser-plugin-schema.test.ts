import { describe, expect, it } from 'vitest';
import {
  BrowserPluginSchemaError,
  jsonDepth,
  MAX_BROWSER_SCHEMA_BYTES,
  MAX_BROWSER_SCHEMA_DEPTH,
  namespaceSchemaIds,
  prepareBrowserPlugins,
} from '../browser-plugin-schema';

describe('jsonDepth', () => {
  it('counts nested containers, not scalars', () => {
    expect(jsonDepth('x')).toBe(0);
    expect(jsonDepth({})).toBe(1);
    expect(jsonDepth({ a: [1, { b: {} }] })).toBe(4);
  });

  it('survives very deep input without recursion', () => {
    let value: unknown = {};
    for (let i = 0; i < 50_000; i++) value = { v: value };
    expect(jsonDepth(value)).toBe(50_001);
  });
});

describe('namespaceSchemaIds', () => {
  it('renames $id and the $refs that point at them, keeps local pointers', () => {
    const schema = {
      $id: 'T0',
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        child: { $ref: 'T0' },
        self: { $ref: '#/properties/child' },
        items: { type: 'array', items: { $id: 'T1', type: 'string' } },
      },
    };
    const out = namespaceSchemaIds(schema, 'kpi') as any;
    expect(out.$id).toBe('kpi:T0');
    expect(out.$schema).toBeUndefined();
    expect(out.properties.child.$ref).toBe('kpi:T0');
    expect(out.properties.self.$ref).toBe('#/properties/child');
    expect(out.properties.items.items.$id).toBe('kpi:T1');
    // The input is untouched.
    expect(schema.$id).toBe('T0');
  });

  it('refuses a $ref to anything outside the schema', () => {
    expect(() =>
      namespaceSchemaIds(
        { type: 'object', properties: { a: { $ref: 'https://x/y.json' } } },
        'kpi'
      )
    ).toThrow(BrowserPluginSchemaError);
    expect(() =>
      namespaceSchemaIds({ properties: { a: { $ref: 'T9' } } }, 'kpi')
    ).toThrow(/only ids defined in the schema itself/);
  });
});

describe('prepareBrowserPlugins', () => {
  const component = (name: string, propsSchema: Record<string, unknown>) => ({
    name,
    versions: [{ version: '1.0.0', propsSchema }],
  });

  it('namespaces each version by component name and version', () => {
    const [a, b] = prepareBrowserPlugins([
      component('a', { $id: 'T0', type: 'object' }),
      component('b', { $id: 'T0', type: 'object' }),
    ]);
    expect(a.versions[0].propsSchema.$id).toBe('a@1.0.0:T0');
    expect(b.versions[0].propsSchema.$id).toBe('b@1.0.0:T0');
  });

  it('rejects a duplicate name', () => {
    expect(() =>
      prepareBrowserPlugins([
        component('a', { type: 'object' }),
        component('a', { type: 'object' }),
      ])
    ).toThrow(/more than once/);
  });

  it('caps the aggregate size', () => {
    const big = 'x'.repeat(MAX_BROWSER_SCHEMA_BYTES / 4 + 1);
    const components = Array.from({ length: 4 }, (_, i) =>
      component(`c${i}`, { type: 'object', description: big })
    );
    expect(() => prepareBrowserPlugins(components)).toThrow(/limit is 256 KB/);
  });

  it('caps the nesting depth of a props schema', () => {
    let propsSchema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < MAX_BROWSER_SCHEMA_DEPTH + 2; i++) {
      propsSchema = { type: 'object', properties: { p: propsSchema } };
    }
    expect(() =>
      prepareBrowserPlugins([component('deep', propsSchema)])
    ).toThrow(/nests \d+ levels deep/);
  });
});

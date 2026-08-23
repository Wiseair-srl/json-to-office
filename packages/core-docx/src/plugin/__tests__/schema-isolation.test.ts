import { describe, expect, it } from 'vitest';
import { Type, type TObject } from '@sinclair/typebox';
import type { CustomComponent } from '../createComponent';
import { generateComponentSchemas } from '../schema';

function component(
  field: string,
  hasChildren = false
): CustomComponent<any, any, any> {
  return {
    name: 'reloadable',
    versions: {
      '1.0.0': {
        propsSchema: Type.Object({ [field]: Type.String() }),
        hasChildren,
        render: async () => [],
      },
    },
  } as CustomComponent<any, any, any>;
}

function properties(schema: unknown): Record<string, unknown> {
  return (schema as TObject).properties;
}

describe('individual custom-component schemas', () => {
  it('does not reuse a stale schema after a plugin reload', () => {
    const first = generateComponentSchemas([component('before')]);
    const second = generateComponentSchemas([component('after')]);

    expect(properties(first['reloadable@1.0.0'])).toHaveProperty('before');
    expect(properties(second['reloadable@1.0.0'])).toHaveProperty('after');
    expect(properties(second['reloadable@1.0.0'])).not.toHaveProperty('before');
    expect(properties(second.reloadable)).toHaveProperty('after');
  });

  it('does not reuse stale child metadata for the same name and version', () => {
    const leaf = generateComponentSchemas([component('value')]);
    const container = generateComponentSchemas([component('value', true)]);

    expect(properties(leaf['reloadable@1.0.0'])).not.toHaveProperty('children');
    expect(properties(container['reloadable@1.0.0'])).toHaveProperty(
      'children'
    );
  });
});

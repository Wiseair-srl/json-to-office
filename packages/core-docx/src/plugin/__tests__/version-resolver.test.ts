import { describe, it, expect } from 'vitest';
import { resolveComponentVersion } from '../version-resolver';
import { Type } from '@sinclair/typebox';
import type { ComponentVersionMap } from '../createComponent';

const mockVersions: ComponentVersionMap = {
  '1.0.0': {
    propsSchema: Type.Object({ city: Type.String() }),
    render: async () => [],
    description: 'v1',
  },
  '2.0.0': {
    propsSchema: Type.Object({ city: Type.String(), unit: Type.String() }),
    render: async () => [],
    description: 'v2',
  },
};

describe('plugin/version-resolver', () => {
  it('returns the latest version when no version is requested', () => {
    const entry = resolveComponentVersion('weather', mockVersions);
    expect(entry.description).toBe('v2');
  });

  it('returns the correct entry for an explicit version', () => {
    const entry = resolveComponentVersion('weather', mockVersions, '1.0.0');
    expect(entry.description).toBe('v1');
  });

  it('throws when the requested version does not exist', () => {
    expect(() =>
      resolveComponentVersion('weather', mockVersions, '3.0.0')
    ).toThrow('does not have version "3.0.0"');
  });

  it('lists available versions in the error message', () => {
    expect(() =>
      resolveComponentVersion('weather', mockVersions, '9.9.9')
    ).toThrow('1.0.0');
  });

  it('resolves latest correctly with unordered keys', () => {
    const unordered: ComponentVersionMap = {
      '3.0.0': {
        propsSchema: Type.Object({}),
        render: async () => [],
        description: 'v3',
      },
      '1.0.0': {
        propsSchema: Type.Object({}),
        render: async () => [],
        description: 'v1',
      },
    };
    const entry = resolveComponentVersion('test', unordered);
    expect(entry.description).toBe('v3');
  });
});

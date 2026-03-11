import { describe, it, expect, expectTypeOf } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createComponent } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { ensureThemeDefaults } from '../../themes/defaults';
import type {
  ExtractCustomComponentType,
  InferComponentDefinition,
} from '../types';

/**
 * Type-level tests for custom component type inference
 *
 * These tests verify that:
 * 1. Valid custom component names are accepted
 * 2. Invalid component names cause type errors
 * 3. Standard components continue to work alongside custom components
 * 4. Multi-version components discriminate props by version
 */

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

const greetingComponent = createComponent({
  name: 'greeting' as const,
  versions: {
    '1.0.0': {
      propsSchema: Type.Object({ name: Type.String() }),
      render: async () => [],
    },
  },
});

const summaryComponent = createComponent({
  name: 'summary' as const,
  versions: {
    '1.0.0': {
      propsSchema: Type.Object({ title: Type.String() }),
      render: async () => [],
    },
  },
});

// Multi-version component with REQUIRED version-specific props
// so structural subtyping catches cross-version prop mismatches
const multiVersionComponent = createComponent({
  name: 'weather' as const,
  versions: {
    '1.0.0': {
      propsSchema: Type.Object({
        city: Type.String(),
        showDetails: Type.Boolean(),
      }),
      render: async () => [],
    },
    '2.0.0': {
      propsSchema: Type.Object({
        city: Type.String(),
        days: Type.Number(),
      }),
      render: async () => [],
    },
  },
});

describe('Type inference for custom components', () => {
  it('should infer literal type for component name', () => {
    // The component name should be inferred as a literal type, not string
    expectTypeOf(greetingComponent.name).toEqualTypeOf<'greeting'>();
    expectTypeOf(summaryComponent.name).toEqualTypeOf<'summary'>();
  });

  it('should accept valid custom component names in children array', () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    // This should compile without errors
    generator.generate({
      name: 'docx',
      props: {},
      children: [
        {
          name: 'greeting',
          props: { name: 'John' },
        },
        {
          name: 'summary',
          props: { title: 'Overview' },
        },
      ],
    });
  });

  it('should accept standard components alongside custom components', () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    // Standard components should still work
    generator.generate({
      name: 'docx',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: { text: 'Hello' },
        },
        {
          name: 'heading',
          props: { level: 1, text: 'Title' },
        },
      ],
    });
  });

  it('should produce correct union type for ExtendedComponentDefinition', () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Verify custom component names are in the union via assignment
    const greetingDef: ComponentDef = {
      name: 'greeting',
      props: { name: 'John' },
    };
    const summaryDef: ComponentDef = {
      name: 'summary',
      props: { title: 'Overview' },
    };

    expect(greetingDef.name).toBe('greeting');
    expect(summaryDef.name).toBe('summary');

    // Verify custom names are part of the name union
    type ComponentNames = ComponentDef['name'];
    expectTypeOf<'greeting'>().toMatchTypeOf<ComponentNames>();
    expectTypeOf<'summary'>().toMatchTypeOf<ComponentNames>();
  });
});

describe('Multi-version type inference', () => {
  type WeatherType = ExtractCustomComponentType<typeof multiVersionComponent>;

  it('should accept v1 props with version 1.0.0', () => {
    const v1: WeatherType = {
      name: 'weather',
      version: '1.0.0',
      props: { city: 'London', showDetails: true },
    };
    expect(v1.version).toBe('1.0.0');
  });

  it('should accept v2 props with version 2.0.0', () => {
    const v2: WeatherType = {
      name: 'weather',
      version: '2.0.0',
      props: { city: 'London', days: 7 },
    };
    expect(v2.version).toBe('2.0.0');
  });

  it('should accept any version props without version field', () => {
    // Fallback variant: no version, accepts any version's props
    const v1NoVersion: WeatherType = {
      name: 'weather',
      props: { city: 'London', showDetails: true },
    };
    const v2NoVersion: WeatherType = {
      name: 'weather',
      props: { city: 'London', days: 7 },
    };
    expect(v1NoVersion.name).toBe('weather');
    expect(v2NoVersion.name).toBe('weather');
  });

  it('should reject v1 props paired with version 2.0.0', () => {
    // showDetails is v1-only AND days (required in v2) is missing
    // @ts-expect-error - showDetails is v1-only, days is required for v2
    const _invalid: WeatherType = {
      name: 'weather',
      version: '2.0.0',
      props: { city: 'London', showDetails: true },
    };
    void _invalid;
  });

  it('should reject v2 props paired with version 1.0.0', () => {
    // days is v2-only AND showDetails (required in v1) is missing
    // @ts-expect-error - days is v2-only, showDetails is required for v1
    const _invalid: WeatherType = {
      name: 'weather',
      version: '1.0.0',
      props: { city: 'London', days: 7 },
    };
    void _invalid;
  });

  it('should work with multi-version components in generator', () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(multiVersionComponent);

    // v1 with explicit version
    generator.generate({
      name: 'docx',
      props: {},
      children: [
        {
          name: 'weather',
          version: '1.0.0',
          props: { city: 'London', showDetails: true },
        },
      ],
    });

    // v2 with explicit version
    generator.generate({
      name: 'docx',
      props: {},
      children: [
        {
          name: 'weather',
          version: '2.0.0',
          props: { city: 'London', days: 7 },
        },
      ],
    });

    // No version — fallback resolves to latest (v2) at runtime
    generator.generate({
      name: 'docx',
      props: {},
      children: [
        {
          name: 'weather',
          props: { city: 'London', days: 5 },
        },
      ],
    });
  });

  it('should reject unknown version literals', () => {
    // version '3.0.0' doesn't exist — no versioned variant matches,
    // and the fallback requires version?: never
    // @ts-expect-error - version '3.0.0' is not a known version
    const _invalid: WeatherType = {
      name: 'weather',
      version: '3.0.0',
      props: { city: 'London', showDetails: true },
    };
    void _invalid;
  });

  it('should include version literals in the type', () => {
    // The version field in versioned variants should be a literal union
    type VersionedWeather = Extract<WeatherType, { version: string }>;
    type Versions = VersionedWeather['version'];
    expectTypeOf<'1.0.0'>().toMatchTypeOf<Versions>();
    expectTypeOf<'2.0.0'>().toMatchTypeOf<Versions>();
  });
});

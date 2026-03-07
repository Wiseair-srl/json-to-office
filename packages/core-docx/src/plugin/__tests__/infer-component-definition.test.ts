import { describe, it, expect, expectTypeOf } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { InferComponentDefinition, InferDocumentType } from '../types';

/**
 * Tests for InferComponentDefinition type helper
 *
 * This type helper allows users to create component definitions in separate files
 * while maintaining full type safety with custom components registered on a generator.
 */

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

// Define custom components for testing
const weatherComponent = createComponent({
  name: 'weather' as const,
  versions: {
    '1.0.0': {
      propsSchema: Type.Object({
        city: Type.String(),
        units: Type.Optional(
          Type.Union([Type.Literal('metric'), Type.Literal('imperial')])
        ),
      }),
      render: async ({ props }) => [
        {
          name: 'paragraph',
          props: { text: `Weather in ${props.city}` },
        },
      ],
    },
  },
});

const alertComponent = createComponent({
  name: 'alert' as const,
  versions: {
    '1.0.0': {
      propsSchema: Type.Object({
        level: Type.Union([
          Type.Literal('info'),
          Type.Literal('warning'),
          Type.Literal('error'),
        ]),
        message: Type.String(),
      }),
      render: async ({ props }) => [
        {
          name: 'paragraph',
          props: { text: `[${props.level.toUpperCase()}] ${props.message}` },
        },
      ],
    },
  },
});

describe('InferComponentDefinition type helper', () => {
  it('should infer component definition type from generator', () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(weatherComponent)
      .addComponent(alertComponent);

    // Infer the component definition type
    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Test that custom component names are included
    const weatherDef: ComponentDef = {
      name: 'weather',
      props: { city: 'London', units: 'metric' },
    };

    const alertDef: ComponentDef = {
      name: 'alert',
      props: { level: 'warning', message: 'Test alert' },
    };

    // Test that standard component names are also included
    const paragraphDef: ComponentDef = {
      name: 'paragraph',
      props: { text: 'Hello world' },
    };

    const headingDef: ComponentDef = {
      name: 'heading',
      props: { level: 1, text: 'Title' },
    };

    // Verify the objects are valid (runtime check)
    expect(weatherDef.name).toBe('weather');
    expect(alertDef.name).toBe('alert');
    expect(paragraphDef.name).toBe('paragraph');
    expect(headingDef.name).toBe('heading');
  });

  it('should allow creating component arrays in separate scope', () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(weatherComponent)
      .addComponent(alertComponent);

    // Simulate creating components in a different file
    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Create an array of components with full type safety
    const myComponents: ComponentDef[] = [
      { name: 'heading', props: { level: 1, text: 'Weather Report' } },
      { name: 'weather', props: { city: 'Paris', units: 'metric' } },
      { name: 'alert', props: { level: 'info', message: 'Data updated' } },
      { name: 'paragraph', props: { text: 'End of report' } },
    ];

    expect(myComponents).toHaveLength(4);
    expect(myComponents[0].name).toBe('heading');
    expect(myComponents[1].name).toBe('weather');
    expect(myComponents[2].name).toBe('alert');
    expect(myComponents[3].name).toBe('paragraph');
  });

  it('should work with generator passed to a function', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(weatherComponent);

    // Function that accepts generator and returns typed components
    function createWeatherComponents<T extends typeof generator>(
      _gen: T
    ): InferComponentDefinition<T>[] {
      return [
        { name: 'heading', props: { level: 1, text: 'Weather' } },
        { name: 'weather', props: { city: 'Tokyo' } },
      ] as InferComponentDefinition<T>[];
    }

    const components = createWeatherComponents(generator);
    expect(components).toHaveLength(2);

    // Use the components with the generator
    const result = await generator.generate({
      name: 'report',
      props: {},
      children: components,
    });

    expect(result.document).toBeDefined();
  });

  it('should type-check custom component props correctly', () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(weatherComponent)
      .addComponent(alertComponent);

    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Valid weather props
    const validWeather: ComponentDef = {
      name: 'weather',
      props: { city: 'Berlin' },
    };

    // Valid weather props with optional field
    const validWeatherWithUnits: ComponentDef = {
      name: 'weather',
      props: { city: 'Berlin', units: 'imperial' },
    };

    // Valid alert props
    const validAlert: ComponentDef = {
      name: 'alert',
      props: { level: 'error', message: 'Critical!' },
    };

    expect(validWeather.props).toEqual({ city: 'Berlin' });
    expect(validWeatherWithUnits.props).toEqual({
      city: 'Berlin',
      units: 'imperial',
    });
    expect(validAlert.props).toEqual({ level: 'error', message: 'Critical!' });
  });

  it('should include custom component name in the type union', () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(weatherComponent)
      .addComponent(alertComponent);

    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Extract the 'name' field from the component definition union
    type ComponentNames = ComponentDef['name'];

    // Verify custom names are included
    expectTypeOf<'weather'>().toMatchTypeOf<ComponentNames>();
    expectTypeOf<'alert'>().toMatchTypeOf<ComponentNames>();

    // Verify standard names are included
    expectTypeOf<'paragraph'>().toMatchTypeOf<ComponentNames>();
    expectTypeOf<'heading'>().toMatchTypeOf<ComponentNames>();
    expectTypeOf<'section'>().toMatchTypeOf<ComponentNames>();
    expectTypeOf<'table'>().toMatchTypeOf<ComponentNames>();
  });

  it('should work with InferDocumentType for full document typing', () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(weatherComponent);

    type DocType = InferDocumentType<typeof generator>;
    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Create a full document using the inferred types
    const document: DocType = {
      name: 'report',
      props: {
        metadata: { title: 'Weather Report' },
      },
      children: [
        { name: 'weather', props: { city: 'Sydney' } },
        { name: 'paragraph', props: { text: 'Current conditions' } },
      ],
    };

    // Create components separately and assign them
    const separateComponents: ComponentDef[] = [
      { name: 'weather', props: { city: 'Melbourne' } },
    ];

    const documentWithSeparateComponents: DocType = {
      name: 'report',
      props: {},
      children: separateComponents,
    };

    expect(document.children).toHaveLength(2);
    expect(documentWithSeparateComponents.children).toHaveLength(1);
  });

  it('should work with generator without custom components', () => {
    const generator = createDocumentGenerator({ theme: testTheme });

    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Should still work with standard components
    const components: ComponentDef[] = [
      { name: 'heading', props: { level: 1, text: 'Title' } },
      { name: 'paragraph', props: { text: 'Content' } },
    ];

    expect(components).toHaveLength(2);
  });

  it('should maintain type safety when components are created dynamically', () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(weatherComponent);

    type ComponentDef = InferComponentDefinition<typeof generator>;

    // Dynamic component creation based on data
    function createComponentsFromCities(cities: string[]): ComponentDef[] {
      return cities.map((city) => ({
        name: 'weather' as const,
        props: { city },
      }));
    }

    const cityComponents = createComponentsFromCities([
      'London',
      'Paris',
      'Tokyo',
    ]);

    expect(cityComponents).toHaveLength(3);
    expect(cityComponents[0]).toEqual({
      name: 'weather',
      props: { city: 'London' },
    });
  });
});

describe('createComponent with TComponentDefinition type parameter', () => {
  it('should allow creating components that return custom components with type safety', async () => {
    // First, define base custom components
    const alertComponent = createComponent({
      name: 'alert' as const,
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({
            level: Type.Union([
              Type.Literal('info'),
              Type.Literal('warning'),
              Type.Literal('error'),
            ]),
            message: Type.String(),
          }),
          render: async ({ props }) => [
            {
              name: 'paragraph',
              props: { text: `[${props.level}] ${props.message}` },
            },
          ],
        },
      },
    });

    const statsComponent = createComponent({
      name: 'stats' as const,
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({
            value: Type.Number(),
            label: Type.String(),
          }),
          render: async ({ props }) => [
            {
              name: 'statistic',
              props: { value: String(props.value), label: props.label },
            },
          ],
        },
      },
    });

    // Create a generator with custom components
    const baseGenerator = createDocumentGenerator({ theme: testTheme })
      .addComponent(alertComponent)
      .addComponent(statsComponent);

    // Now create a dashboard component that can return those custom components
    const DashboardPropsSchema = Type.Object({
      title: Type.String(),
      showAlert: Type.Optional(Type.Boolean()),
    });

    const dashboardComponent = createComponent({
      name: 'dashboard' as const,
      versions: {
        '1.0.0': createVersion({
          propsSchema: DashboardPropsSchema,
          render: async ({ props }) => {
            const components: InferComponentDefinition<typeof baseGenerator>[] =
              [
                { name: 'heading', props: { level: 1, text: props.title } },
                { name: 'stats', props: { value: 42, label: 'Active Users' } },
              ];

            if (props.showAlert) {
              components.push({
                name: 'alert',
                props: { level: 'info', message: 'Dashboard loaded' },
              });
            }

            return components;
          },
        }),
      },
    });

    // Add dashboard component to the generator
    const fullGenerator = baseGenerator.addComponent(dashboardComponent);

    // Generate a document
    const result = await fullGenerator.generate({
      name: 'report',
      props: {},
      children: [
        {
          name: 'dashboard',
          props: { title: 'My Dashboard', showAlert: true },
        },
      ],
    });

    expect(result.document).toBeDefined();
  });

  it('should provide type safety for render return type', () => {
    // Create base components
    const cardComponent = createComponent({
      name: 'card' as const,
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({
            title: Type.String(),
            content: Type.String(),
          }),
          render: async ({ props }) => [
            {
              name: 'paragraph',
              props: { text: `${props.title}: ${props.content}` },
            },
          ],
        },
      },
    });

    const baseGenerator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(cardComponent);

    // Create a component that returns the base generator's component types
    type BaseComponentDef = InferComponentDefinition<typeof baseGenerator>;

    const PagePropsSchema = Type.Object({
      pageTitle: Type.String(),
      cards: Type.Array(
        Type.Object({
          title: Type.String(),
          content: Type.String(),
        })
      ),
    });

    const pageComponent = createComponent({
      name: 'page' as const,
      versions: {
        '1.0.0': createVersion({
          propsSchema: PagePropsSchema,
          render: async ({ props }) => {
            const components: BaseComponentDef[] = [
              { name: 'heading', props: { level: 1, text: props.pageTitle } },
            ];

            for (const card of props.cards) {
              components.push({
                name: 'card',
                props: { title: card.title, content: card.content },
              });
            }

            return components;
          },
        }),
      },
    });

    // Verify the component was created correctly
    expect(pageComponent.name).toBe('page');
    expect(typeof pageComponent.versions['1.0.0'].render).toBe('function');
  });

  it('should work with standard ComponentDefinition (default type parameter)', async () => {
    // When no type parameter is provided, defaults to ComponentDefinition
    const simpleComponent = createComponent({
      name: 'simple' as const,
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({ text: Type.String() }),
          render: async ({ props }) => [
            { name: 'paragraph', props: { text: props.text } },
            { name: 'heading', props: { level: 2, text: 'Title' } },
          ],
        },
      },
    });

    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(simpleComponent);

    const result = await generator.generate({
      name: 'report',
      props: {},
      children: [{ name: 'simple', props: { text: 'Hello' } }],
    });

    expect(result.document).toBeDefined();
  });

  it('should properly chain custom components that reference each other', async () => {
    // Step 1: Create first level custom component
    const badgeComponent = createComponent({
      name: 'badge' as const,
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({
            text: Type.String(),
            color: Type.Optional(Type.String()),
          }),
          render: async ({ props }) => [
            {
              name: 'paragraph',
              props: { text: `[${props.text}]` },
            },
          ],
        },
      },
    });

    // Step 2: Create generator with badge component
    const gen1 = createDocumentGenerator({ theme: testTheme }).addComponent(
      badgeComponent
    );

    // Step 3: Create a component that can return badge components
    const HeaderPropsSchema = Type.Object({
      title: Type.String(),
      badges: Type.Array(Type.String()),
    });

    const headerComponent = createComponent({
      name: 'header' as const,
      versions: {
        '1.0.0': createVersion({
          propsSchema: HeaderPropsSchema,
          render: async ({ props }) => {
            const components: InferComponentDefinition<typeof gen1>[] = [
              { name: 'heading', props: { level: 1, text: props.title } },
            ];

            for (const badgeText of props.badges) {
              components.push({
                name: 'badge',
                props: { text: badgeText },
              });
            }

            return components;
          },
        }),
      },
    });

    // Step 4: Create final generator
    const finalGenerator = gen1.addComponent(headerComponent);

    // Step 5: Use both custom components in a document
    const result = await finalGenerator.generate({
      name: 'report',
      props: {},
      children: [
        {
          name: 'header',
          props: { title: 'Welcome', badges: ['New', 'Featured'] },
        },
        { name: 'badge', props: { text: 'Important' } },
      ],
    });

    expect(result.document).toBeDefined();
  });
});

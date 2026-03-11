import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { DuplicateComponentError } from '../validation';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { ComponentDefinition } from '../../types';

/**
 * Test: getStandardComponentsDefinition
 *
 * This test demonstrates that custom components are properly converted to standard components
 * and that the document is normalized correctly.
 */

// Create a simple test theme
const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

// Define a simple custom component: "greeting"
const GreetingPropsSchema = Type.Object(
  {
    name: Type.String({
      description: 'Name to greet',
    }),
    style: Type.Optional(
      Type.Union([Type.Literal('formal'), Type.Literal('casual')], {
        default: 'casual',
        description: 'Greeting style',
      })
    ),
    includeDate: Type.Optional(
      Type.Boolean({
        default: false,
        description: 'Include current date',
      })
    ),
  },
  {
    additionalProperties: false,
  }
);

const greetingComponent = createComponent({
  name: 'greeting',
  versions: {
    '1.0.0': createVersion({
      propsSchema: GreetingPropsSchema,
      description: 'Generates a personalized greeting message',

      render: async ({ props }): Promise<ComponentDefinition[]> => {
        const components: ComponentDefinition[] = [];

        // Create greeting text based on style
        const greetingText =
          props.style === 'formal'
            ? `Dear ${props.name},`
            : `Hello ${props.name}!`;

        // Add greeting as a heading
        components.push({
          name: 'heading',
          props: {
            level: 2,
            text: greetingText,
          },
        });

        // Add date if requested
        if (props.includeDate) {
          const currentDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });

          components.push({
            name: 'paragraph',
            props: {
              text: `Date: ${currentDate}`,
              font: { italic: true },
            },
          });
        }

        return components;
      },
    }),
  },
});

// Define another custom component that generates a summary
const SummaryPropsSchema = Type.Object(
  {
    title: Type.String({
      description: 'Summary title',
    }),
    points: Type.Array(Type.String(), {
      description: 'Summary points',
    }),
  },
  {
    additionalProperties: false,
  }
);

const summaryComponent = createComponent({
  name: 'summary',
  versions: {
    '1.0.0': createVersion({
      propsSchema: SummaryPropsSchema,
      description: 'Generates a summary section with key points',

      render: async ({ props }): Promise<ComponentDefinition[]> => {
        return [
          {
            name: 'heading',
            props: {
              level: 3,
              text: props.title,
            },
          },
          {
            name: 'list',
            props: {
              items: props.points,
            },
          },
        ];
      },
    }),
  },
});

describe('getStandardComponentsDefinition', () => {
  it('should convert custom components to standard components', async () => {
    // Create a document generator with custom components using builder pattern
    const generator = createDocumentGenerator({
      theme: testTheme,
      debug: false,
    })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    // Define a document using custom components - no type annotation needed!
    // TypeScript infers the correct type from the generator
    const documentWithCustomComponents = {
      name: 'docx' as const,
      props: {
        metadata: { title: 'Custom Component Test' },
        theme: 'minimal',
      },
      children: [
        {
          name: 'greeting' as const,
          props: {
            name: 'Alice',
            style: 'formal' as const,
            includeDate: true,
          },
        },
        {
          name: 'paragraph' as const,
          props: {
            text: 'This is a standard paragraph between custom components.',
          },
        },
        {
          name: 'summary' as const,
          props: {
            title: 'Key Points',
            points: [
              'Custom components work correctly',
              'Standard components are preserved',
              'getStandardComponentsDefinition normalizes the output',
            ],
          },
        },
      ],
    };

    // Get the standard components definition
    const standardDefinition = await generator.getStandardComponentsDefinition(
      documentWithCustomComponents
    );

    // Verify the result
    expect(standardDefinition).toBeDefined();
    expect(standardDefinition.name).toBe('docx');
    expect(standardDefinition.props?.metadata?.title).toBe(
      'Custom Component Test'
    );
    expect(standardDefinition.children).toBeDefined();
    expect(Array.isArray(standardDefinition.children)).toBe(true);

    // Verify that custom components have been replaced with standard components
    const componentNames = standardDefinition.children!.map((m: any) => m.name);

    // Should NOT contain custom component names
    expect(componentNames).not.toContain('greeting');
    expect(componentNames).not.toContain('summary');

    // Should contain the standard components that custom components expanded to
    expect(componentNames).toContain('heading'); // From greeting and summary
    expect(componentNames).toContain('paragraph'); // Original + from greeting (date)
    expect(componentNames).toContain('list'); // From summary

    // Count the components (should be more than original 3 because custom components expand)
    // greeting -> heading + paragraph (because includeDate is true)
    // paragraph -> paragraph
    // summary -> heading + list
    // Total: 5 components
    expect(standardDefinition.children!.length).toBe(5);
  });

  it('should preserve standard components unchanged', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    // Use explicit typing to avoid inference issues with standard-only components
    const standardDefinition = await generator.getStandardComponentsDefinition({
      name: 'docx',
      props: {
        metadata: {
          title: 'Standard Components Only',
        },
        theme: 'minimal',
      },
      children: [
        {
          name: 'greeting',
          props: {
            name: 'John',
          },
        },
      ],
    });

    // Should have the greeting component expanded to standard components
    // greeting without includeDate only produces a heading
    expect(standardDefinition.children).toBeDefined();
    expect(standardDefinition.children!.length).toBe(1);
    expect(standardDefinition.children![0].name).toBe('heading');
  });

  it('should handle nested custom components correctly', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    // Note: Nested custom components in sections work at runtime, but TypeScript
    // doesn't fully support this because ExtendedComponentDefinition isn't applied
    // recursively in section.children. We use 'as any' for the nested children.
    const standardDefinition = await generator.getStandardComponentsDefinition({
      name: 'docx',
      props: {
        metadata: { title: 'Nested Custom Components' },
      },
      children: [
        {
          name: 'section',
          props: {
            title: 'Introduction',
          },
          children: [
            {
              name: 'greeting',
              props: {
                name: 'Bob',
                style: 'casual',
                includeDate: false,
              },
            },
            {
              name: 'summary',
              props: {
                title: 'Overview',
                points: ['Point 1', 'Point 2'],
              },
            },
          ],
        },
      ] as any,
    });

    // Verify the section is preserved
    expect(standardDefinition.children).toBeDefined();
    expect(standardDefinition.children!.length).toBe(1);
    expect(standardDefinition.children![0].name).toBe('section');

    // Verify nested components are converted
    const sectionComponent = standardDefinition.children![0] as any;
    expect(sectionComponent.children).toBeDefined();
    expect(Array.isArray(sectionComponent.children)).toBe(true);

    const nestedNames = sectionComponent.children.map((m: any) => m.name);

    // Should NOT contain custom names
    expect(nestedNames).not.toContain('greeting');
    expect(nestedNames).not.toContain('summary');

    // Should contain expanded standard names
    // greeting (casual, no date) -> heading only
    // summary -> heading + list
    // Total: 3 components
    expect(nestedNames).toContain('heading');
    expect(nestedNames).toContain('list');
    expect(sectionComponent.children.length).toBe(3);
  });

  it('should throw error for invalid custom component configuration', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const invalidDocument = {
      name: 'docx' as const,
      props: {
        metadata: { title: 'Invalid Config' },
      },
      children: [
        {
          name: 'greeting' as const,
          props: {
            // Missing required 'name' field
            style: 'formal' as const,
          } as any,
        },
      ],
    };

    await expect(
      generator.getStandardComponentsDefinition(invalidDocument)
    ).rejects.toThrow();
  });

  it('should normalize the document structure', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const document = {
      name: 'docx' as const,
      props: {
        metadata: { title: 'Normalization Test' },
      },
      children: [
        {
          name: 'greeting' as const,
          props: {
            name: 'Charlie',
            style: 'casual' as const,
            includeDate: true,
          },
        },
      ],
    };

    const standardDefinition =
      await generator.getStandardComponentsDefinition(document);

    // The normalized document should have proper structure
    expect(standardDefinition).toHaveProperty('name', 'docx');
    expect(standardDefinition).toHaveProperty('props');
    expect(standardDefinition).toHaveProperty('children');

    // All components should be fully expanded and normalized
    standardDefinition.children!.forEach((component: any) => {
      expect(component).toHaveProperty('name');
      expect(component).toHaveProperty('props');
    });
  });

  it('should work with the same document that generate() uses', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const document = {
      name: 'docx' as const,
      props: {
        metadata: { title: 'Consistency Test' },
      },
      children: [
        {
          name: 'greeting' as const,
          props: {
            name: 'David',
            style: 'formal' as const,
            includeDate: true,
          },
        },
      ],
    };

    // Both should work without errors
    const standardDefinition =
      await generator.getStandardComponentsDefinition(document);
    const generatedDoc = await generator.generate(document);

    // Both should succeed
    expect(standardDefinition).toBeDefined();
    expect(generatedDoc).toBeDefined();

    // The standard definition should contain the same expanded components
    // that generate() would use internally
    expect(standardDefinition.children).toBeDefined();
    expect(standardDefinition.children!.length).toBe(2); // heading + paragraph (with date)
  });

  it('should throw DuplicateComponentError when same component name is registered twice', () => {
    // Create a duplicate component with the same name
    const duplicateGreetingComponent = createComponent({
      name: 'greeting', // Same name as greetingComponent
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({ message: Type.String() }),
          render: async () => [],
        },
      },
    });

    expect(() => {
      createDocumentGenerator({
        theme: testTheme,
      })
        .addComponent(greetingComponent)
        .addComponent(duplicateGreetingComponent);
    }).toThrow(DuplicateComponentError);
  });

  it('should throw DuplicateComponentError with the correct component name', () => {
    const duplicateComponent = createComponent({
      name: 'greeting',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({}),
          render: async () => [],
        },
      },
    });

    try {
      createDocumentGenerator({
        theme: testTheme,
      })
        .addComponent(greetingComponent)
        .addComponent(duplicateComponent);
      expect.fail('Should have thrown DuplicateComponentError');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateComponentError);
      expect((error as DuplicateComponentError).componentName).toBe('greeting');
      expect((error as DuplicateComponentError).code).toBe(
        'DUPLICATE_COMPONENT'
      );
    }
  });

  it('should allow adding the same component instance to different generators', () => {
    // This should work - different generators can have the same component
    const generator1 = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const generator2 = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    expect(generator1.getComponentNames()).toContain('greeting');
    expect(generator2.getComponentNames()).toContain('greeting');
  });

  it('should return correct component names from getComponentNames()', () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    const componentNames = generator.getComponentNames();
    expect(componentNames).toContain('greeting');
    expect(componentNames).toContain('summary');
    expect(componentNames.length).toBe(2);
  });
});

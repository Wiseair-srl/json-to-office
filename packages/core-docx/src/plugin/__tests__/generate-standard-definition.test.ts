import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { DuplicateComponentError } from '../validation';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { ComponentDefinition } from '../../types';

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

const GreetingPropsSchema = Type.Object(
  {
    name: Type.String({ description: 'Name to greet' }),
    style: Type.Optional(
      Type.Union([Type.Literal('formal'), Type.Literal('casual')], {
        default: 'casual',
        description: 'Greeting style',
      })
    ),
    includeDate: Type.Optional(
      Type.Boolean({ default: false, description: 'Include current date' })
    ),
  },
  { additionalProperties: false }
);

const greetingComponent = createComponent({
  name: 'greeting',
  versions: {
    '1.0.0': createVersion({
      propsSchema: GreetingPropsSchema,
      description: 'Generates a personalized greeting message',
      render: async ({ props }): Promise<ComponentDefinition[]> => {
        const components: ComponentDefinition[] = [];
        const greetingText =
          props.style === 'formal'
            ? `Dear ${props.name},`
            : `Hello ${props.name}!`;
        components.push({
          name: 'heading',
          props: { level: 2, text: greetingText },
        });
        if (props.includeDate) {
          const currentDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          components.push({
            name: 'paragraph',
            props: { text: `Date: ${currentDate}`, font: { italic: true } },
          });
        }
        return components;
      },
    }),
  },
});

const SummaryPropsSchema = Type.Object(
  {
    title: Type.String({ description: 'Summary title' }),
    points: Type.Array(Type.String(), { description: 'Summary points' }),
  },
  { additionalProperties: false }
);

const summaryComponent = createComponent({
  name: 'summary',
  versions: {
    '1.0.0': createVersion({
      propsSchema: SummaryPropsSchema,
      description: 'Generates a summary section with key points',
      render: async ({ props }): Promise<ComponentDefinition[]> => {
        return [
          { name: 'heading', props: { level: 3, text: props.title } },
          { name: 'list', props: { items: props.points } },
        ];
      },
    }),
  },
});

describe('generateBuffer().standardDefinition', () => {
  it('should convert custom components to standard components', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
      debug: false,
    })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    const documentWithCustomComponents = {
      name: 'docx' as const,
      props: {
        metadata: { title: 'Custom Component Test' },
        theme: 'minimal',
      },
      children: [
        {
          name: 'greeting' as const,
          props: { name: 'Alice', style: 'formal' as const, includeDate: true },
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
              'standardDefinition normalizes the output',
            ],
          },
        },
      ],
    };

    const { standardDefinition } = await generator.generateBuffer(
      documentWithCustomComponents
    );

    expect(standardDefinition).toBeDefined();
    expect(standardDefinition.name).toBe('docx');
    expect(standardDefinition.props?.metadata?.title).toBe(
      'Custom Component Test'
    );
    expect(standardDefinition.children).toBeDefined();
    expect(Array.isArray(standardDefinition.children)).toBe(true);

    const componentNames = standardDefinition.children!.map((m: any) => m.name);

    expect(componentNames).not.toContain('greeting');
    expect(componentNames).not.toContain('summary');

    expect(componentNames).toContain('heading');
    expect(componentNames).toContain('paragraph');
    expect(componentNames).toContain('list');

    // greeting -> heading + paragraph (includeDate: true)
    // paragraph -> paragraph
    // summary -> heading + list
    expect(standardDefinition.children!.length).toBe(5);
  });

  it('should expand a single custom component', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const { standardDefinition } = await generator.generateBuffer({
      name: 'docx',
      props: {
        metadata: { title: 'Standard Components Only' },
        theme: 'minimal',
      },
      children: [{ name: 'greeting', props: { name: 'John' } }],
    });

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

    const { standardDefinition } = await generator.generateBuffer({
      name: 'docx',
      props: { metadata: { title: 'Nested Custom Components' } },
      children: [
        {
          name: 'section',
          props: { meta: { title: 'Introduction' } },
          children: [
            {
              name: 'greeting',
              props: { name: 'Bob', style: 'casual', includeDate: false },
            },
            {
              name: 'summary',
              props: { title: 'Overview', points: ['Point 1', 'Point 2'] },
            },
          ],
        },
      ] as any,
    });

    expect(standardDefinition.children).toBeDefined();
    expect(standardDefinition.children!.length).toBe(1);
    expect(standardDefinition.children![0].name).toBe('section');

    const sectionComponent = standardDefinition.children![0] as any;
    expect(sectionComponent.children).toBeDefined();
    expect(Array.isArray(sectionComponent.children)).toBe(true);

    const nestedNames = sectionComponent.children.map((m: any) => m.name);
    expect(nestedNames).not.toContain('greeting');
    expect(nestedNames).not.toContain('summary');
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
      props: { metadata: { title: 'Invalid Config' } },
      children: [
        {
          name: 'greeting' as const,
          props: { style: 'formal' as const } as any,
        },
      ],
    };

    await expect(generator.generateBuffer(invalidDocument)).rejects.toThrow();
  });

  it('should normalize the document structure', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const document = {
      name: 'docx' as const,
      props: { metadata: { title: 'Normalization Test' } },
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

    const { standardDefinition } = await generator.generateBuffer(document);

    expect(standardDefinition).toHaveProperty('name', 'docx');
    expect(standardDefinition).toHaveProperty('props');
    expect(standardDefinition).toHaveProperty('children');

    standardDefinition.children!.forEach((component: any) => {
      expect(component).toHaveProperty('name');
      expect(component).toHaveProperty('props');
    });
  });

  it('should expose the same expansion the rendered document is built from', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const document = {
      name: 'docx' as const,
      props: { metadata: { title: 'Consistency Test' } },
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

    const result = await generator.generateBuffer(document);

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(result.standardDefinition).toBeDefined();
    expect(result.standardDefinition.children).toBeDefined();
    // greeting (formal, with date) -> heading + paragraph
    expect(result.standardDefinition.children!.length).toBe(2);
  });

  it('expandStandardDefinition returns the same tree as generateBuffer() without rendering', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    const document = {
      name: 'docx' as const,
      props: { metadata: { title: 'Expansion Only' }, theme: 'minimal' },
      children: [
        { name: 'greeting' as const, props: { name: 'Eve' } },
        {
          name: 'summary' as const,
          props: { title: 'Points', points: ['a', 'b'] },
        },
      ],
    };

    const expanded = await generator.expandStandardDefinition(document);
    const generated = await generator.generateBuffer(document);

    expect(expanded.standardDefinition).toEqual(generated.standardDefinition);
    // Not a GenerationResult: nothing rendered, no document produced.
    expect(expanded).not.toHaveProperty('document');
  });

  it('expandStandardDefinition validates like generate()', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    await expect(
      generator.expandStandardDefinition({
        name: 'docx',
        props: { metadata: { title: 'Invalid' } },
        children: [{ name: 'greeting', props: {} as any }],
      })
    ).rejects.toThrow();
  });

  it('expandStandardDefinition never invokes rendering services', async () => {
    // A visual component would hit services.pptx during generate(); the
    // expansion-only path must not touch it (#155 — the whole point is
    // skipping LibreOffice).
    const renderSpy = { called: false };
    const generator = createDocumentGenerator({
      theme: testTheme,
      services: {
        pptx: {
          render: async () => {
            renderSpy.called = true;
            return {
              base64DataUri: 'data:image/png;base64,',
              width: 1,
              height: 1,
            };
          },
        },
      } as any,
    }).addComponent(greetingComponent);

    const { standardDefinition } = await generator.expandStandardDefinition({
      name: 'docx',
      props: { metadata: { title: 'No Render' } },
      children: [
        { name: 'greeting', props: { name: 'Frank' } },
        {
          name: 'visual',
          props: {
            canvas: { width: 6, height: 4 },
            elements: [
              { name: 'text', props: { text: 'Hi', x: 1, y: 1, w: 4, h: 1 } },
            ],
          },
        },
      ] as any,
    });

    expect(standardDefinition.children!.length).toBe(2);
    expect(renderSpy.called).toBe(false);
  });

  it('should throw DuplicateComponentError when same component name is registered twice', () => {
    const duplicateGreetingComponent = createComponent({
      name: 'greeting',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({ message: Type.String() }),
          render: async () => [],
        },
      },
    });

    expect(() => {
      createDocumentGenerator({ theme: testTheme })
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
      createDocumentGenerator({ theme: testTheme })
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

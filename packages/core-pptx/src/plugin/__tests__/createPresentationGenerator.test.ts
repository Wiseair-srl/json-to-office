import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  createComponent,
  createVersion,
  createPresentationGenerator,
  ComponentValidationError,
  DuplicateComponentError,
} from '../index';
import type { PptxComponentInput } from '../../types';

// ---- Test components ----

const bannerComponent = createComponent({
  name: 'banner' as const,
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object(
        {
          title: Type.String(),
          subtitle: Type.Optional(Type.String()),
        },
        { additionalProperties: false }
      ),
      render: async ({ props }) => {
        const components: PptxComponentInput[] = [
          {
            name: 'text',
            props: {
              text: props.title,
              x: 0.5,
              y: 0.5,
              w: 9,
              h: 1,
              fontSize: 32,
              bold: true,
            },
          },
        ];
        if (props.subtitle) {
          components.push({
            name: 'text',
            props: {
              text: props.subtitle,
              x: 0.5,
              y: 1.8,
              w: 9,
              h: 0.5,
              fontSize: 18,
            },
          });
        }
        return components;
      },
    }),
    '2.0.0': createVersion({
      propsSchema: Type.Object(
        {
          heading: Type.String(),
          color: Type.Optional(Type.String({ default: '#000000' })),
        },
        { additionalProperties: false }
      ),
      render: async ({ props }) => [
        {
          name: 'text',
          props: {
            text: props.heading,
            x: 0.5,
            y: 0.5,
            w: 9,
            h: 1,
            fontSize: 36,
            color: props.color,
          },
        } as PptxComponentInput,
      ],
    }),
  },
});

const infoBoxComponent = createComponent({
  name: 'info-box' as const,
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object({
        label: Type.String(),
        value: Type.String(),
      }),
      render: async ({ props, addWarning }) => {
        if (props.value.length > 100) {
          addWarning('Value exceeds 100 characters, may be truncated');
        }
        return [
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 0.5,
              y: 2,
              w: 4,
              h: 2,
              fill: { color: 'F0F0F0' },
            },
          } as PptxComponentInput,
          {
            name: 'text',
            props: {
              text: `${props.label}: ${props.value}`,
              x: 0.7,
              y: 2.2,
              w: 3.6,
              h: 1.6,
            },
          } as PptxComponentInput,
        ];
      },
    }),
  },
});

// ---- Tests ----

describe('createPresentationGenerator', () => {
  it('creates a generator with no components', () => {
    const gen = createPresentationGenerator();
    expect(gen.getComponentNames()).toEqual([]);
  });

  it('registers components via addComponent', () => {
    const gen = createPresentationGenerator()
      .addComponent(bannerComponent)
      .addComponent(infoBoxComponent);

    expect(gen.getComponentNames()).toEqual(['banner', 'info-box']);
  });

  it('throws DuplicateComponentError on duplicate name', () => {
    expect(() =>
      createPresentationGenerator()
        .addComponent(bannerComponent)
        .addComponent(bannerComponent)
    ).toThrow(DuplicateComponentError);
  });

  it('generates a buffer from a presentation with custom components', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);

    const result = await gen.generate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              version: '1.0.0',
              props: { title: 'Hello World', subtitle: 'Test subtitle' },
            },
          ],
        },
      ],
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('packages repeated plugin generations byte-identically', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const document = {
      name: 'pptx' as const,
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner' as const,
              version: '1.0.0' as const,
              props: { title: 'Stable plugin output' },
            },
          ],
        },
      ],
    };

    const first = await gen.generateBuffer(document);
    const second = await gen.generateBuffer(document);

    expect(first.buffer.equals(second.buffer)).toBe(true);
  });

  it('resolves latest version when no version specified', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);

    // v2.0.0 uses 'heading' prop, not 'title'
    const result = await gen.generate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              props: { heading: 'Latest Version' },
            },
          ],
        },
      ],
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it('resolves explicit version', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);

    const result = await gen.generate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              version: '1.0.0',
              props: { title: 'V1 Banner' },
            },
          ],
        },
      ],
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it('collects warnings from custom components', async () => {
    const gen = createPresentationGenerator().addComponent(infoBoxComponent);

    const result = await gen.generate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'info-box',
              props: {
                label: 'Description',
                value: 'A'.repeat(101),
              },
            },
          ],
        },
      ],
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    const pluginWarnings = result.warnings.filter(
      (w) => w.code === 'PLUGIN_WARNING'
    );
    expect(pluginWarnings.length).toBeGreaterThan(0);
    expect(pluginWarnings[0].message).toContain('exceeds 100 characters');
  });

  it('validates a presentation', () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);

    const valid = gen.validate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              props: { heading: 'Valid' },
            },
          ],
        },
      ],
    });

    expect(valid.valid).toBe(true);
  });

  it('validates and reports errors for invalid props', () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);

    const result = gen.validate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              version: '1.0.0',
              // missing required 'title' prop
              props: {},
            } as any, // intentionally invalid props for error test
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects dead props on authored standard components', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const document = {
      name: 'pptx' as const,
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'text',
              props: { text: 'Hello', fontColor: 'CC785C' },
            },
          ],
        },
      ],
    } as any;

    expect(gen.validate(document).valid).toBe(false);
    await expect(gen.generateBuffer(document)).rejects.toBeInstanceOf(
      ComponentValidationError
    );
  });

  it('rejects unknown custom props before render-time cleaning', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const document = {
      name: 'pptx' as const,
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              version: '1.0.0',
              props: { title: 'Hello', bogus: true },
            },
          ],
        },
      ],
    } as any;

    expect(gen.validate(document).valid).toBe(false);
    await expect(gen.generateBuffer(document)).rejects.toBeInstanceOf(
      ComponentValidationError
    );
  });

  it('allows unknown props only through the explicit migration option', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const document = {
      name: 'pptx' as const,
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'banner',
              version: '1.0.0',
              props: { title: 'Hello', bogus: true },
            },
          ],
        },
      ],
    } as any;

    const result = await gen.generateBuffer(document, {
      validation: { allowUnknownFields: true },
    });
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('rejects invalid standard output emitted by a custom render', async () => {
    const invalidEmitter = createComponent({
      name: 'invalid-emitter' as const,
      versions: {
        '1.0.0': createVersion({
          propsSchema: Type.Object({}, { additionalProperties: false }),
          render: async () => [
            {
              name: 'text',
              props: { text: 'Bad output', fontColor: 'CC785C' },
            } as any,
          ],
        }),
      },
    });
    const gen = createPresentationGenerator().addComponent(invalidEmitter);

    try {
      await gen.generateBuffer({
        name: 'pptx',
        props: {},
        children: [
          {
            name: 'slide',
            props: {},
            children: [{ name: 'invalid-emitter', props: {} }],
          },
        ],
      });
      throw new Error('expected generation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ComponentValidationError);
      expect((error as ComponentValidationError).message).toContain(
        "custom component 'invalid-emitter' emitted invalid output"
      );
      expect((error as ComponentValidationError).message).toContain(
        'fontColor'
      );
    }
  });

  it('rejects an image that sets more than one source (path/base64/svg)', () => {
    const gen = createPresentationGenerator();

    const result = gen.validate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'image',
              props: {
                svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
                path: 'https://example.com/x.png',
              },
            } as any,
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => /only one source/.test(e.message))).toBe(
      true
    );
  });

  it('detects multi-source image conflicts nested in a table cell', () => {
    const gen = createPresentationGenerator();

    const result = gen.validate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'table',
              props: {
                rows: [
                  [
                    {
                      children: [
                        {
                          name: 'image',
                          props: {
                            base64: 'data:image/png;base64,AAAA',
                            path: 'https://example.com/x.png',
                          },
                        },
                      ],
                    },
                  ],
                ],
              },
            } as any,
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => /only one source/.test(e.message))).toBe(
      true
    );
  });

  it('accepts an image with a single source', () => {
    const gen = createPresentationGenerator();

    const result = gen.validate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'image',
              props: {
                svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
              },
            } as any,
          ],
        },
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('generates a schema', () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const schema = gen.generateSchema();
    expect(schema).toBeDefined();
  });

  it('generates version-discriminated plugin schemas', () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const schema = gen.generateSchema();
    const presentation = (component: Record<string, unknown>) => ({
      name: 'pptx',
      props: {},
      children: [{ name: 'slide', props: {}, children: [component] }],
    });

    expect(
      Value.Check(
        schema,
        presentation({
          name: 'banner',
          version: '1.0.0',
          props: { title: 'Legacy' },
        })
      )
    ).toBe(true);
    expect(
      Value.Check(
        schema,
        presentation({ name: 'banner', props: { heading: 'Latest' } })
      )
    ).toBe(true);
    expect(
      Value.Check(
        schema,
        presentation({
          name: 'banner',
          version: '1.0.0',
          props: { heading: 'Wrong version' },
        })
      )
    ).toBe(false);
  });

  it('selects the latest plugin schema with semantic version ordering', () => {
    const semverComponent = createComponent({
      name: 'semver-card' as const,
      versions: {
        '1.9.0': createVersion({
          propsSchema: Type.Object({ oldValue: Type.String() }),
          render: async () => [],
        }),
        '1.10.0': createVersion({
          propsSchema: Type.Object({ newValue: Type.String() }),
          render: async () => [],
        }),
      },
    });
    const schema = createPresentationGenerator()
      .addComponent(semverComponent)
      .generateSchema();

    expect(
      Value.Check(schema, {
        name: 'pptx',
        props: {},
        children: [
          {
            name: 'slide',
            props: {},
            children: [{ name: 'semver-card', props: { newValue: 'latest' } }],
          },
        ],
      })
    ).toBe(true);
  });

  it('passes through standard components unchanged', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);

    const result = await gen.generate({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'text',
              props: { text: 'Standard text', x: 1, y: 1, w: 8, h: 1 },
            },
            {
              name: 'banner',
              props: { heading: 'Custom' },
            },
          ],
        },
      ],
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it('prefers customThemes[doc.props.theme] over constructor-supplied state.theme', async () => {
    // Regression: in the playground/CLI plugin path, a default theme passed
    // to the constructor used to shadow customThemes — so a doc with
    // `props.theme: "wiseair"` rendered as the constructor default even
    // though the wiseair theme was supplied. Spy via a custom component's
    // render args to capture the theme actually used.
    let observedTheme: any = null;
    const spy = createComponent({
      name: 'theme-spy' as const,
      versions: {
        '1.0.0': createVersion({
          propsSchema: Type.Object({}),
          render: async ({ theme }) => {
            observedTheme = theme;
            return [];
          },
        }),
      },
    });

    const constructorTheme = {
      name: 'minimal-fallback',
      colors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
        background: '#FFFFFF',
        text: '#000000',
      },
      fonts: { heading: 'Arial', body: 'Arial' },
      defaults: { fontSize: 12, fontColor: '#000000' },
    } as any;

    const customWiseair = {
      name: 'wiseair',
      colors: {
        primary: '#1D2130',
        secondary: '#383F5D',
        accent: '#586CC9',
        background: '#FAFAFA',
        text: '#1D2130',
      },
      fonts: { heading: 'Inter', body: 'Inter' },
      defaults: { fontSize: 16, fontColor: '#1D2130' },
    } as any;

    const gen = createPresentationGenerator({
      theme: constructorTheme,
      customThemes: { wiseair: customWiseair },
    }).addComponent(spy);

    await gen.generate({
      name: 'pptx',
      props: { theme: 'wiseair' },
      children: [
        {
          name: 'slide',
          props: {},
          children: [{ name: 'theme-spy', props: {} }],
        },
      ],
    });

    expect(observedTheme).not.toBeNull();
    expect(observedTheme.colors.accent).toBe('#586CC9');
    expect(observedTheme.colors.primary).toBe('#1D2130');
  });

  it('generates and saves to file', async () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-plugin-'));
    try {
      const outputPath = path.join(tmpDir, 'test.pptx');

      await gen.generateFile(
        {
          name: 'pptx',
          props: {},
          children: [
            {
              name: 'slide',
              props: {},
              children: [
                {
                  name: 'banner',
                  props: { heading: 'File Test' },
                },
              ],
            },
          ],
        },
        outputPath
      );

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import {
  createComponent,
  createVersion,
  createPresentationGenerator,
  DuplicateComponentError,
} from '../index';
import type { PptxComponentInput } from '../../types';

// ---- Test components ----

const bannerComponent = createComponent({
  name: 'banner' as const,
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object({
        title: Type.String(),
        subtitle: Type.Optional(Type.String()),
      }),
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
      propsSchema: Type.Object({
        heading: Type.String(),
        color: Type.Optional(Type.String({ default: '#000000' })),
      }),
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
            fontColor: props.color,
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

  it('generates a schema', () => {
    const gen = createPresentationGenerator().addComponent(bannerComponent);
    const schema = gen.generateSchema();
    expect(schema).toBeDefined();
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

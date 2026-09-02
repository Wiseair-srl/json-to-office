import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { ComponentValidationError } from '../validation';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { ComponentDefinition } from '../../types';

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

const CalloutPropsSchema = Type.Object(
  {
    text: Type.String({ description: 'Callout text' }),
    tone: Type.Optional(
      Type.Union([Type.Literal('info'), Type.Literal('warn')])
    ),
  },
  { additionalProperties: false }
);

const calloutComponent = createComponent({
  name: 'callout',
  versions: {
    '1.0.0': createVersion({
      propsSchema: CalloutPropsSchema,
      description: 'A callout box',
      render: async ({ props }): Promise<ComponentDefinition[]> => [
        { name: 'paragraph', props: { text: props.text } },
      ],
    }),
  },
});

function makeGenerator() {
  return createDocumentGenerator({ theme: testTheme }).addComponent(
    calloutComponent
  );
}

function docWith(children: any[]) {
  return {
    name: 'docx' as const,
    props: { theme: 'test' },
    children,
  };
}

describe('plugin generation validation', () => {
  it('generates a valid document containing a custom component', async () => {
    const gen = makeGenerator();
    const { buffer } = await gen.generateBuffer(
      docWith([
        { name: 'paragraph', props: { text: 'Intro' } },
        { name: 'callout', props: { text: 'Heads up', tone: 'info' } },
      ]) as any
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('throws when a required custom prop is missing', async () => {
    const gen = makeGenerator();
    await expect(
      gen.generateBuffer(
        docWith([{ name: 'callout', props: { tone: 'info' } }]) as any
      )
    ).rejects.toBeInstanceOf(ComponentValidationError);
  });

  it('throws on an unknown key in custom props (strict)', async () => {
    const gen = makeGenerator();
    await expect(
      gen.generateBuffer(
        docWith([{ name: 'callout', props: { text: 'x', bogus: true } }]) as any
      )
    ).rejects.toBeInstanceOf(ComponentValidationError);
  });

  it('throws on a malformed standard-component prop inside a plugin doc', async () => {
    const gen = makeGenerator();
    await expect(
      gen.generateBuffer(
        docWith([
          { name: 'callout', props: { text: 'x' } },
          {
            name: 'paragraph',
            props: { text: 'y', font: { lineSpacing: { name: 'single' } } },
          },
        ]) as any
      )
    ).rejects.toBeInstanceOf(ComponentValidationError);
  });

  it('validate() returns valid for a good doc and invalid for a malformed one', () => {
    const gen = makeGenerator();
    const good = gen.validate(
      docWith([{ name: 'callout', props: { text: 'ok' } }]) as any
    );
    expect(good.valid).toBe(true);

    const bad = gen.validate(
      docWith([
        {
          name: 'paragraph',
          props: { text: 'y', font: { lineSpacing: { name: 'single' } } },
        },
      ]) as any
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors && bad.errors.length).toBeGreaterThan(0);
  });

  // Every case above puts the custom component at the top level, which is
  // where the walk used to stop: it returned at the first standard component
  // instead of descending, so a `callout` inside a `section` — the shape of
  // every real document — was never checked against its props schema. The
  // schema route offered the name and the server validated it clean; the only
  // thing that objected was the component's own render, much later.
  it('checks custom props nested inside a standard container', () => {
    const gen = makeGenerator();
    const bad = gen.validate(
      docWith([
        {
          name: 'section',
          children: [{ name: 'callout', props: { tone: 'info' } }],
        },
      ]) as any
    );

    expect(bad.valid).toBe(false);
    expect(bad.errors?.some((e) => /text/.test(e.path ?? ''))).toBe(true);
  });

  it('accepts a good nested custom component', () => {
    const gen = makeGenerator();
    const good = gen.validate(
      docWith([
        {
          name: 'section',
          children: [{ name: 'callout', props: { text: 'ok', tone: 'info' } }],
        },
      ]) as any
    );

    expect(good.valid).toBe(true);
  });

  it('throws on a nested custom component with an unknown prop', async () => {
    const gen = makeGenerator();
    await expect(
      gen.generateBuffer(
        docWith([
          {
            name: 'section',
            children: [{ name: 'callout', props: { text: 'x', bogus: true } }],
          },
        ]) as any
      )
    ).rejects.toBeInstanceOf(ComponentValidationError);
  });

  it('allowUnknownFields lets a doc with unknown standard keys through', async () => {
    const gen = makeGenerator();
    const { buffer } = await gen.generateBuffer(
      docWith([
        {
          name: 'paragraph',
          props: { text: 'y', font: { lineSpacing: { type: 'single', x: 1 } } },
        },
      ]) as any,
      { validation: { allowUnknownFields: true } }
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('validation.enabled=false skips validation', async () => {
    const gen = makeGenerator();
    const { buffer } = await gen.generateBuffer(
      docWith([
        {
          name: 'paragraph',
          props: { text: 'y', font: { lineSpacing: { name: 'single' } } },
        },
      ]) as any,
      { validation: { enabled: false } }
    );
    expect(buffer.length).toBeGreaterThan(0);
  });
});

// A custom component whose render() emits a standard `statistic` node. The
// emitted props are parameterised so each test can make them valid or invalid.
// These nodes never exist in the input document, so the pre-expansion gate
// cannot see them — only the render-boundary check does.
function statBoxComponent(emittedProps: Record<string, unknown>) {
  return createComponent({
    name: 'stat-box',
    versions: {
      '1.0.0': createVersion({
        propsSchema: Type.Object({}, { additionalProperties: false }),
        description: 'Emits a standard statistic',
        render: async (): Promise<ComponentDefinition[]> => [
          { name: 'statistic', props: emittedProps },
        ],
      }),
    },
  });
}

describe('plugin render-output validation', () => {
  it('throws when a custom render() emits an invalid standard component', async () => {
    // `statistic` requires `number`/`description`; emit a bad extra prop instead.
    const gen = createDocumentGenerator({ theme: testTheme }).addComponent(
      statBoxComponent({ number: '42', description: 'Users', color: 'text' })
    );
    await expect(
      gen.generateBuffer(docWith([{ name: 'stat-box', props: {} }]) as any)
    ).rejects.toBeInstanceOf(ComponentValidationError);
  });

  it('attributes the error to the emitting component', async () => {
    const gen = createDocumentGenerator({ theme: testTheme }).addComponent(
      statBoxComponent({ number: '42', description: 'Users', color: 'text' })
    );
    try {
      await gen.generateBuffer(
        docWith([{ name: 'stat-box', props: {} }]) as any
      );
      throw new Error('expected generation to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ComponentValidationError);
      expect((e as ComponentValidationError).message).toContain(
        "custom component 'stat-box' emitted invalid output"
      );
    }
  });

  it('accepts a custom render() that emits a valid standard component', async () => {
    const gen = createDocumentGenerator({ theme: testTheme }).addComponent(
      statBoxComponent({ number: '42', description: 'Active Users' })
    );
    const { buffer } = await gen.generateBuffer(
      docWith([{ name: 'stat-box', props: {} }]) as any
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('validation.enabled=false lets invalid render output through', async () => {
    const gen = createDocumentGenerator({ theme: testTheme }).addComponent(
      statBoxComponent({ number: '42', description: 'Users', color: 'text' })
    );
    const { buffer } = await gen.generateBuffer(
      docWith([{ name: 'stat-box', props: {} }]) as any,
      { validation: { enabled: false } }
    );
    expect(buffer.length).toBeGreaterThan(0);
  });
});

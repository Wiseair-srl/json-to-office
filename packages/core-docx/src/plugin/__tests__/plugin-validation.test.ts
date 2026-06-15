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

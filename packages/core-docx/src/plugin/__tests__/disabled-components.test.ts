import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import AdmZip from 'adm-zip';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { ComponentDefinition } from '../../types';

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

function setup() {
  const render = vi.fn(
    async ({ props }: { props: { text: string } }) =>
      [
        { name: 'paragraph', props: { text: props.text } },
      ] as ComponentDefinition[]
  );
  const note = createComponent({
    name: 'note',
    versions: {
      '1.0.0': createVersion({
        propsSchema: Type.Object(
          { text: Type.String() },
          { additionalProperties: false }
        ),
        render,
      }),
    },
  });
  // Emits a disabled `note` next to an enabled one.
  const pair = createComponent({
    name: 'pair',
    versions: {
      '1.0.0': createVersion({
        propsSchema: Type.Object({}, { additionalProperties: false }),
        render: async (): Promise<ComponentDefinition[]> =>
          [
            { name: 'note', props: { text: 'EMITTED_ON' } },
            { name: 'note', enabled: false, props: { text: 'EMITTED_OFF' } },
          ] as unknown as ComponentDefinition[],
      }),
    },
  });
  const generator = createDocumentGenerator({ theme: testTheme })
    .addComponent(note)
    .addComponent(pair);
  return { generator, render };
}

const documentXml = (buffer: Buffer) =>
  new AdmZip(buffer).getEntry('word/document.xml')!.getData().toString('utf8');

describe('enabled: false on a custom component', () => {
  it('never calls render and leaves no trace in the docx', async () => {
    const { generator, render } = setup();
    const result = await generator.generateBuffer({
      name: 'docx',
      props: {},
      children: [
        { name: 'note', enabled: false, props: { text: 'HIDDEN_NOTE' } },
        { name: 'paragraph', props: { text: 'VISIBLE' } },
      ],
    } as any);

    expect(render).not.toHaveBeenCalled();
    const xml = documentXml(result.buffer);
    expect(xml).toContain('VISIBLE');
    expect(xml).not.toContain('HIDDEN_NOTE');
    // Kept with its flag, as a disabled standard node is.
    expect(result.standardDefinition.children![0]).toMatchObject({
      name: 'note',
      enabled: false,
    });
  });

  it('is skipped when another custom render emits it', async () => {
    const { generator, render } = setup();
    const result = await generator.generateBuffer({
      name: 'docx',
      props: {},
      children: [{ name: 'pair', props: {} }],
    } as any);

    expect(render).toHaveBeenCalledTimes(1);
    const xml = documentXml(result.buffer);
    expect(xml).toContain('EMITTED_ON');
    expect(xml).not.toContain('EMITTED_OFF');
  });

  it('is skipped inside a standard container and on the block path', async () => {
    const { generator, render } = setup();
    const result = await generator.generateBuffer({
      name: 'docx',
      props: { blocks: {} },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            { name: 'note', enabled: false, props: { text: 'NESTED_OFF' } },
            { name: 'note', props: { text: 'NESTED_ON' } },
          ],
        },
      ],
    } as any);

    expect(render).toHaveBeenCalledTimes(1);
    const xml = documentXml(result.buffer);
    expect(xml).toContain('NESTED_ON');
    expect(xml).not.toContain('NESTED_OFF');
  });

  it('a disabled standard parent still hides an enabled custom child', async () => {
    const { generator } = setup();
    const result = await generator.generateBuffer({
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          enabled: false,
          props: {},
          children: [{ name: 'note', props: { text: 'CHILD_OF_OFF' } }],
        },
        { name: 'paragraph', props: { text: 'VISIBLE' } },
      ],
    } as any);

    const xml = documentXml(result.buffer);
    expect(xml).toContain('VISIBLE');
    expect(xml).not.toContain('CHILD_OF_OFF');
  });

  it('preserveCustomComponents keeps the disabled node verbatim', async () => {
    const { generator, render } = setup();
    const disabled = {
      name: 'note',
      enabled: false,
      props: { text: 'HIDDEN_NOTE' },
    };
    const result = await generator.generateBuffer(
      {
        name: 'docx',
        props: {},
        children: [disabled, { name: 'note', props: { text: 'SHOWN' } }],
      } as any,
      { preserveCustomComponents: ['note'] }
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(result.preservedDefinition!.children![0]).toEqual(disabled);
    expect(documentXml(result.buffer)).not.toContain('HIDDEN_NOTE');
  });
});

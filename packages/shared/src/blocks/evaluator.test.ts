import { describe, it, expect } from 'vitest';
import {
  JsonBlockEvaluator,
  validateBlockDefinitions,
  validateBlockInvocations,
  toAuthoredBlockPointer,
  type JsonBlockDefinition,
} from './index';

const definition: JsonBlockDefinition = {
  format: 'docx',
  slots: {
    title: { type: 'string', required: true, maxWords: 3 },
    subtitle: { type: 'string' },
    items: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string' },
    },
  },
  body: [
    { name: 'paragraph', props: { text: { $slot: '/title' } } },
    {
      $if: '/subtitle',
      then: [
        { name: 'divider' },
        { name: 'paragraph', props: { text: { $slot: '/subtitle' } } },
      ],
    },
    {
      $each: '/items',
      template: { name: 'paragraph', props: { text: { $item: '' } } },
    },
  ],
};
const doc = (slots: Record<string, unknown>) => ({
  name: 'docx',
  props: { blocks: { summary: definition } },
  children: [
    {
      name: 'section',
      children: [{ name: 'block', props: { ref: 'summary', slots } }],
    },
  ],
});

describe('document-local JSON block evaluation', () => {
  it('collapses optional groups and maps repeated content to its authored item', () => {
    const input = doc({ title: 'Summary', items: ['First', 'Second'] });
    const evaluator = new JsonBlockEvaluator(input.props.blocks, {
      format: 'docx',
    });
    const expanded = evaluator.expand(input) as any;
    expect(
      expanded.children[0].children[0].children.map((v: any) => v.props.text)
    ).toEqual(['Summary', 'First', 'Second']);
    expect(
      toAuthoredBlockPointer(
        evaluator.sourceMap,
        '/children/0/children/0/children/2/props/text'
      )
    ).toBe('/children/0/children/0/props/slots/items/1');
    expect(input.children[0].children[0].name).toBe('block');
  });
  it('includes the whole optional group when content is present', () => {
    const input = doc({
      title: 'Summary',
      subtitle: 'Detail',
      items: ['One', 'Two', 'Three', 'Four'],
    });
    const output = new JsonBlockEvaluator(input.props.blocks, {
      format: 'docx',
    }).expand(input) as any;
    expect(output.children[0].children[0].children).toHaveLength(7);
  });
  it('distinguishes missing values, defaults and explicit empty values', () => {
    const def = {
      ...definition,
      slots: {
        ...definition.slots,
        subtitle: { type: 'string' as const, default: 'Default' },
      },
    };
    const input = doc({ title: 'Summary', items: ['One', 'Two'] });
    input.props.blocks.summary = def;
    const render = () =>
      new JsonBlockEvaluator(input.props.blocks, { format: 'docx' }).expand(
        input
      ) as any;
    expect(render().children[0].children[0].children).toHaveLength(5);
    input.children[0].children[0].props.slots.subtitle = '';
    expect(render().children[0].children[0].children).toHaveLength(3);
  });
  it.each([
    [{ items: ['a', 'b'] }, 'block_required_slot'],
    [{ title: 'One two three four', items: ['a', 'b'] }, 'block_slot_budget'],
    [{ title: 'Fine', items: ['a'] }, 'block_slot_budget'],
    [{ title: 'Fine', items: ['a', 'b'], x: 1 }, 'block_unknown_slot'],
  ])('reports authored slot failures', (slots, code) => {
    const input = doc(slots);
    expect(validateBlockInvocations(input, input.props.blocks, 'docx')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code,
          path: expect.stringContaining('/children/0/children/0/props/slots/'),
        }),
      ])
    );
  });
  it('never falls back to a reference catalog', () => {
    const input = doc({ title: 'Summary', items: ['a', 'b'] });
    input.children[0].children[0].props.ref = 'cover';
    expect(() =>
      new JsonBlockEvaluator(input.props.blocks, { format: 'docx' }).expand(
        input
      )
    ).toThrow("'cover' is not defined");
  });
  it('rejects malformed/unknown bindings at the definition location', () => {
    const defs = {
      summary: {
        ...definition,
        body: [{ $slot: '/missing' }, { $eval: '1+1' }],
      },
    };
    expect(validateBlockDefinitions(defs, 'docx').map((v) => v.path)).toEqual([
      '/props/blocks/summary/body/0',
      '/props/blocks/summary/body/1',
    ]);
  });
  it('bounds recursive block expansion', () => {
    const defs = {
      loop: {
        format: 'docx' as const,
        slots: {},
        body: [{ name: 'block', props: { ref: 'loop' } }],
      },
    };
    expect(() =>
      new JsonBlockEvaluator(defs, { format: 'docx' }).expand({
        name: 'block',
        props: { ref: 'loop' },
      })
    ).toThrow('limit');
  });
  it('maps renamed slots through nested block invocations', () => {
    const defs = {
      parent: {
        format: 'docx' as const,
        slots: { title: { type: 'string' as const } },
        body: [
          {
            name: 'block',
            props: { ref: 'child', slots: { text: { $slot: '/title' } } },
          },
        ],
      },
      child: {
        format: 'docx' as const,
        slots: { text: { type: 'string' as const } },
        body: [{ name: 'paragraph', props: { text: { $slot: '/text' } } }],
      },
    };
    const evaluator = new JsonBlockEvaluator(defs, { format: 'docx' });
    evaluator.expand({
      name: 'block',
      props: { ref: 'parent', slots: { title: 'Authored' } },
    });
    expect(
      toAuthoredBlockPointer(
        evaluator.sourceMap,
        '/children/0/children/0/props/text'
      )
    ).toBe('/props/slots/title');
  });
  it('rejects plugin name collisions and format mismatches', () => {
    expect(
      validateBlockDefinitions({ summary: definition }, 'docx', ['summary'])[0]
        .code
    ).toBe('block_name_collision');
    expect(
      validateBlockDefinitions({ summary: definition }, 'pptx')[0].code
    ).toBe('block_format');
  });
  it('does not read inherited properties as slot bindings', () => {
    const defs = {
      safe: {
        format: 'docx' as const,
        slots: { obj: { type: 'object' as const } },
        body: [
          {
            name: 'paragraph',
            props: { text: { $slot: '/obj/toString', default: 'Safe' } },
          },
        ],
      },
    };
    const result = new JsonBlockEvaluator(defs, { format: 'docx' }).expand({
      name: 'block',
      props: { ref: 'safe', slots: { obj: {} } },
    }) as any;
    expect(result.children[0].props.text).toBe('Safe');
  });
});

it('describes only document-local definitions and their fill pointers', async () => {
  const { documentBlockMetadata } = await import('./metadata');
  const input = doc({ title: 'Local', items: ['A', 'B'] });
  const local = documentBlockMetadata(input);
  expect(local.definitions[0].slotsSchema).toMatchObject({
    required: ['title'],
  });
  expect(local.invocations).toEqual([
    {
      ref: 'summary',
      path: '/children/0/children/0',
      slotsPath: '/children/0/children/0/props/slots',
      defined: true,
    },
  ]);
  expect(documentBlockMetadata({ name: 'docx' }).definitions).toEqual([]);
});

it('rejects unknown nested bindings and contradictory declared bounds', () => {
  const nested = {
    format: 'docx' as const,
    slots: {
      record: {
        type: 'object' as const,
        properties: { title: { type: 'string' as const } },
      },
    },
    body: [{ name: 'paragraph', props: { text: { $slot: '/record/typo' } } }],
  };
  expect(validateBlockDefinitions({ nested }, 'docx')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'block_unknown_binding' }),
    ])
  );
  expect(
    validateBlockDefinitions(
      {
        bad: {
          ...definition,
          slots: {
            ...definition.slots,
            items: { type: 'array', minItems: 5, maxItems: 2 },
          },
        },
      },
      'docx'
    )
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'block_invalid_definition' }),
    ])
  );
});

it('rejects placement hidden inside a component-slot group', () => {
  const component = {
    format: 'docx' as const,
    slots: { content: { type: 'component' as const } },
    body: [{ $slot: '/content' }],
  };
  const input = {
    name: 'block',
    props: {
      ref: 'component',
      slots: {
        content: {
          name: 'group',
          children: [
            {
              name: 'paragraph',
              props: { text: 'Nested', spacing: { before: 20 } },
            },
          ],
        },
      },
    },
  };
  expect(validateBlockInvocations(input, { component }, 'docx')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'block_slot_placement',
        path: '/props/slots/content/children/0/props/spacing',
      }),
    ])
  );
});

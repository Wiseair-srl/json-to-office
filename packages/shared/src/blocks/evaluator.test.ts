import { describe, it, expect } from 'vitest';
import {
  JsonBlockEvaluator,
  validateBlockDefinitions,
  validateBlockInvocations,
  toAuthoredBlockPointer,
  type JsonBlockDefinition,
} from './index';

const definition: JsonBlockDefinition = {
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
        slots: { title: { type: 'string' as const } },
        body: [
          {
            name: 'block',
            props: { ref: 'child', slots: { text: { $slot: '/title' } } },
          },
        ],
      },
      child: {
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
  it('rejects plugin collisions and format-incompatible operations', () => {
    expect(
      validateBlockDefinitions({ summary: definition }, 'docx', ['summary'])[0]
        .code
    ).toBe('block_name_collision');
    expect(
      validateBlockDefinitions(
        { summary: { ...definition, section: { tracker: 'Section' } } },
        'pptx'
      )[0].code
    ).toBe('block_format');
  });
  it('does not read inherited properties as slot bindings', () => {
    const defs = {
      safe: {
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

it('drops missing repeated values and preserves their original item pointers', () => {
  const definitions = {
    values: {
      slots: {
        items: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { label: { type: 'string' as const } },
          },
        },
      },
      body: [
        {
          name: 'list',
          props: {
            items: [{ $each: '/items', template: { $item: '/label' } }],
          },
        },
      ],
    },
  };
  const evaluator = new JsonBlockEvaluator(definitions, { format: 'docx' });
  const result = evaluator.expand({
    name: 'block',
    props: {
      ref: 'values',
      slots: { items: [{}, { label: 'A' }, {}, { label: 'B' }, {}] },
    },
  }) as any;
  expect(result.children[0].props.items).toEqual(['A', 'B']);
  expect(
    toAuthoredBlockPointer(evaluator.sourceMap, '/children/0/props/items/0')
  ).toBe('/props/slots/items/1/label');
  expect(
    toAuthoredBlockPointer(evaluator.sourceMap, '/children/0/props/items/1')
  ).toBe('/props/slots/items/3/label');
  expect(evaluator.sourceMap).not.toHaveProperty('/children/0/props/items/2');
});

it('inherits format from the host and rejects a redundant authored format field', () => {
  expect(validateBlockDefinitions({ summary: definition }, 'docx')).toEqual([]);
  expect(validateBlockDefinitions({ summary: definition }, 'pptx')).toEqual([]);
  expect(
    validateBlockDefinitions(
      { summary: { ...definition, format: 'docx' } },
      'docx'
    )[0].code
  ).toBe('block_invalid_definition');
});

describe('PPTX composition on the shared contract', () => {
  const slideDefinition: JsonBlockDefinition = {
    slots: {
      title: { type: 'string', required: true, role: 'actionTitle' },
      chart: { type: 'component', required: true },
      source: { type: 'string', role: 'source' },
    },
    slide: { background: { color: 'background' }, grid: { rows: 8 } },
    body: [
      {
        name: 'text',
        props: { text: { $slot: '/title' }, x: 0.5, y: 0.5, w: 12, h: 1 },
      },
      {
        $slot: '/chart',
        props: { x: 0.5, y: 1.7, w: 12, h: 4.5, showLegend: true },
      },
    ],
  };
  const deck = (slots: Record<string, unknown>) => ({
    name: 'pptx',
    props: { blocks: { 'action-chart': slideDefinition } },
    children: [
      {
        name: 'slide',
        children: [{ name: 'block', props: { ref: 'action-chart', slots } }],
      },
    ],
  });
  it('merges definition props beneath a component slot and keeps slot provenance', () => {
    const input = deck({
      title: 'Growth improved',
      chart: {
        name: 'chart',
        props: { type: 'bar', data: [], showLegend: false },
      },
    });
    const evaluator = new JsonBlockEvaluator(input.props.blocks, {
      format: 'pptx',
    });
    const expanded = evaluator.expand(input) as any;
    const chart = expanded.children[0].children[0].children[1];
    expect(chart.props).toEqual({
      x: 0.5,
      y: 1.7,
      w: 12,
      h: 4.5,
      showLegend: false,
      type: 'bar',
      data: [],
    });
    const base = '/children/0/children/0';
    expect(
      toAuthoredBlockPointer(
        evaluator.sourceMap,
        `${base}/children/1/props/showLegend`
      )
    ).toBe(`${base}/props/slots/chart/props/showLegend`);
    expect(
      toAuthoredBlockPointer(evaluator.sourceMap, `${base}/children/1/props/x`)
    ).toBe(base);
  });
  it('reports slide effects to the host and rejects them off a slide or in DOCX', () => {
    const input = deck({
      title: 'T',
      chart: { name: 'chart', props: { type: 'bar', data: [] } },
    });
    const effects: unknown[] = [];
    new JsonBlockEvaluator(input.props.blocks, {
      format: 'pptx',
      onSlide: (effect) => effects.push(effect.settings),
    }).expand(input);
    expect(effects).toEqual([slideDefinition.slide]);
    expect(
      validateBlockDefinitions(input.props.blocks, 'docx').map((i) => i.code)
    ).toEqual(['block_format']);
    const nested = deck({
      title: 'T',
      chart: { name: 'chart', props: { type: 'bar', data: [] } },
    }) as any;
    nested.children[0].children = [
      { name: 'group', children: nested.children[0].children },
    ];
    expect(
      validateBlockInvocations(nested, nested.props.blocks, 'pptx').map(
        (i) => i.code
      )
    ).toEqual(['invalid_placement']);
  });
  it('rejects placement smuggled through a component slot and malformed props', () => {
    const input = deck({
      title: 'T',
      chart: { name: 'chart', props: { type: 'bar', data: [], x: 3 } },
    });
    expect(validateBlockInvocations(input, input.props.blocks, 'pptx')).toEqual(
      [
        expect.objectContaining({
          code: 'block_slot_placement',
          path: '/children/0/children/0/props/slots/chart/props/x',
        }),
      ]
    );
    const bad = structuredClone(slideDefinition) as any;
    bad.body[1].props = 'x';
    expect(
      validateBlockDefinitions({ bad }, 'pptx').map((i) => [i.code, i.path])
    ).toEqual([['block_invalid_binding', '/props/blocks/bad/body/1/props']]);
  });
});

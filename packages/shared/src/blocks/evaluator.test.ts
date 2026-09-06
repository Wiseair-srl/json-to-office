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

describe('binding operands on $each, $if and $count', () => {
  // A data table repeats columns, and each column repeats its own cells: the
  // inner repeat reads the current column, not a slot of the block.
  const table: JsonBlockDefinition = {
    slots: {
      columns: {
        type: 'array',
        required: true,
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            header: { type: 'string', required: true },
            numeric: { type: 'boolean', default: true },
            cells: {
              type: 'array',
              required: true,
              items: { type: 'string' },
            },
          },
        },
      },
    },
    body: [
      {
        name: 'table',
        props: {
          columns: {
            $each: '/columns',
            template: {
              header: { content: { $item: '/header' } },
              cellDefaults: {
                horizontalAlignment: {
                  $if: { $item: '/numeric' },
                  then: 'right',
                  else: 'left',
                },
              },
              cells: {
                $each: { $item: '/cells' },
                template: { content: { $item: '' } },
              },
              span: { $count: { $item: '/cells' } },
            },
          },
        },
      },
    ],
  };
  const expand = (slots: Record<string, unknown>) => {
    const evaluator = new JsonBlockEvaluator({ table }, { format: 'docx' });
    const result = evaluator.expand({
      name: 'block',
      props: { ref: 'table', slots },
    }) as any;
    return { evaluator, columns: result.children[0].props.columns };
  };

  it('repeats the current item’s own array and tests its fields', () => {
    const { columns } = expand({
      columns: [
        { header: 'Region', numeric: false, cells: ['North', 'South'] },
        { header: 'Revenue', cells: ['4.2', '3.1'] },
      ],
    });
    expect(columns).toEqual([
      {
        header: { content: 'Region' },
        cellDefaults: { horizontalAlignment: 'left' },
        cells: [{ content: 'North' }, { content: 'South' }],
        span: 2,
      },
      {
        header: { content: 'Revenue' },
        cellDefaults: { horizontalAlignment: 'right' },
        cells: [{ content: '4.2' }, { content: '3.1' }],
        span: 2,
      },
    ]);
  });

  it('maps nested repeated content to the authored cell', () => {
    const { evaluator } = expand({
      columns: [
        { header: 'Region', cells: ['North'] },
        { header: 'Revenue', cells: ['4.2', '3.1'] },
      ],
    });
    expect(
      toAuthoredBlockPointer(
        evaluator.sourceMap,
        '/children/0/props/columns/1/cells/1/content'
      )
    ).toBe('/props/slots/columns/1/cells/1');
    expect(
      toAuthoredBlockPointer(
        evaluator.sourceMap,
        '/children/0/props/columns/1/cellDefaults/horizontalAlignment'
      )
    ).toBe('/props/slots/columns/1/numeric');
    // The repeated column itself belongs to the item that produced it.
    expect(
      toAuthoredBlockPointer(evaluator.sourceMap, '/children/0/props/columns/1')
    ).toBe('/props/slots/columns/1');
  });

  it('accepts a slot reference as an operand, like the pointer form', () => {
    const definition: JsonBlockDefinition = {
      slots: { items: { type: 'array', items: { type: 'string' } } },
      body: [
        { $count: { $slot: '/items' } },
        { $if: { $slot: '/items' }, then: 'some', else: 'none' },
      ],
    };
    const evaluator = new JsonBlockEvaluator(
      { list: definition },
      {
        format: 'docx',
      }
    );
    const result = evaluator.expand({
      name: 'block',
      props: { ref: 'list', slots: { items: ['a', 'b'] } },
    }) as any;
    expect(result.children).toEqual([2, 'some']);
  });

  it('rejects an item operand outside a repeat and a malformed operand', () => {
    const outside: JsonBlockDefinition = {
      slots: { items: { type: 'array', items: { type: 'string' } } },
      body: [{ $each: { $item: '/cells' }, template: 'x' }],
    };
    expect(
      validateBlockDefinitions({ outside }, 'docx').map((issue) => issue.code)
    ).toEqual(['block_invalid_binding']);
    const malformed: JsonBlockDefinition = {
      slots: { items: { type: 'array', items: { type: 'string' } } },
      body: [
        { $if: { $theme: '/x' }, then: 'x' },
        { $count: { $slot: '/items', default: 0 } },
        { $each: { $slot: '/missing' }, template: 'x' },
      ],
    };
    expect(
      validateBlockDefinitions({ malformed }, 'docx').map((issue) => [
        issue.path,
        issue.code,
      ])
    ).toEqual([
      ['/props/blocks/malformed/body/0', 'block_invalid_binding'],
      ['/props/blocks/malformed/body/1', 'block_invalid_binding'],
      ['/props/blocks/malformed/body/2', 'block_unknown_binding'],
    ]);
  });

  it('keeps element provenance through a slot the enclosing block repeated', () => {
    // A parent hands its child an array it built with $each; the child
    // repeats it. Every element must still point at the parent's item.
    const definitions: Record<string, JsonBlockDefinition> = {
      child: {
        slots: { items: { type: 'array', items: { type: 'string' } } },
        body: [
          {
            $each: '/items',
            template: { name: 'paragraph', props: { text: { $item: '' } } },
          },
        ],
      },
      parent: {
        slots: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' } },
            },
          },
        },
        body: [
          {
            name: 'block',
            props: {
              ref: 'child',
              slots: {
                items: { $each: '/rows', template: { $item: '/label' } },
              },
            },
          },
        ],
      },
    };
    const evaluator = new JsonBlockEvaluator(definitions, { format: 'docx' });
    const result = evaluator.expand({
      name: 'block',
      props: {
        ref: 'parent',
        slots: { rows: [{ label: 'A' }, { label: 'B' }] },
      },
    }) as any;
    const paragraphs = result.children[0].children;
    expect(paragraphs.map((p: any) => p.props.text)).toEqual(['A', 'B']);
    expect(
      toAuthoredBlockPointer(
        evaluator.sourceMap,
        '/children/0/children/1/props/text'
      )
    ).toBe('/props/slots/rows/1/label');
    expect(
      toAuthoredBlockPointer(evaluator.sourceMap, '/children/0/children/1')
    ).toBe('/props/slots/rows/1/label');
  });

  it('attributes a context operand like a context binding, and leaves a bound branch its origin', () => {
    const definition: JsonBlockDefinition = {
      slots: { flag: { type: 'boolean' } },
      body: [
        { $count: { $context: '/rows' } },
        { $if: '/flag', then: { $context: '/document/title' } },
        { $if: { $context: '/document/title' }, then: 'shown' },
      ],
    };
    const evaluator = new JsonBlockEvaluator(
      { probe: definition },
      {
        format: 'docx',
        context: { rows: ['x'], document: { title: 'Doc' } },
        contextSources: { '/document': '/props/metadata' },
      }
    );
    const result = evaluator.expand({
      name: 'block',
      props: { ref: 'probe', slots: { flag: true } },
    }) as any;
    expect(result.children).toEqual([1, 'Doc', 'shown']);
    expect(evaluator.sourceMap['/children/1']).toBe('/props/metadata/title');
    expect(evaluator.sourceMap['/children/2']).toBe('/props/metadata/title');
    expect(() =>
      new JsonBlockEvaluator(
        { probe: definition },
        {
          format: 'docx',
          context: { rows: 'no', document: {} },
          contextSources: { '/rows': '/props/rows' },
        }
      ).expand({ name: 'block', props: { ref: 'probe' } })
    ).toThrow(/\/props\/rows: \$count requires an array/);
  });

  it('fails a repeat whose operand is not an array, at the authored item', () => {
    const evaluator = new JsonBlockEvaluator({ table }, { format: 'docx' });
    expect(() =>
      evaluator.expand({
        name: 'block',
        props: {
          ref: 'table',
          slots: { columns: [{ header: 'Region', cells: 'North' as never }] },
        },
      })
    ).toThrow(/columns\/0\/cells/);
  });
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

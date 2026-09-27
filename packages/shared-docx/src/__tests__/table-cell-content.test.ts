/**
 * What a table cell holds.
 *
 * A cell renders one paragraph, so its `content` is a string or one of
 * `TABLE_CELL_COMPONENTS`. Anything else used to validate — the schema typed
 * content as any component — and render as a grey "[Unsupported component
 * type: …]" nobody was told about: three statistics in a KPI row shipped that
 * way. Validation now refuses it at the cell, once, with a code of its own.
 */
import { describe, expect, it } from 'vitest';
import { validateDocument, validateJsonDocument } from '../validation/unified';
import { STANDARD_COMPONENTS_REGISTRY } from '../schemas/component-registry';
import { TABLE_CELL_COMPONENTS } from '../schemas/components/table';

const tableDocument = (
  column: Record<string, unknown>,
  renderer?: 'office-open'
) => ({
  name: 'docx',
  ...(renderer ? { renderer } : {}),
  props: { theme: 'minimal' },
  children: [
    {
      name: 'section',
      props: {},
      children: [{ name: 'table', props: { columns: [column] } }],
    },
  ],
});

const CELL = '/children/0/children/0/props/columns/0/cells/0/content';
const HEADER = '/children/0/children/0/props/columns/0/header/content';

const statistic = {
  name: 'statistic',
  props: { number: '22', description: 'Journeys tested' },
};

describe('what a table cell holds', () => {
  it.each([
    ['a string', 'Plain **text**'],
    ['a paragraph', { name: 'paragraph', props: { text: 'Body copy' } }],
    ['an image', { name: 'image', props: { path: 'logo.png' } }],
    [
      'a raster visual',
      {
        name: 'visual',
        props: {
          canvas: { width: 4, height: 2 },
          elements: [{ name: 'text', props: { text: 'x' } }],
        },
      },
    ],
    [
      'a highcharts chart',
      {
        name: 'highcharts',
        props: {
          options: {
            chart: { type: 'bar', width: 300, height: 200 },
            series: [{ type: 'bar', data: [1, 2] }],
          },
        },
      },
    ],
  ])('accepts %s', (_label, content) => {
    const result = validateDocument(
      tableDocument({ header: { content }, cells: [{ content }] })
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('refuses a statistic with one coded, path-addressed error per cell', () => {
    const document = tableDocument({
      header: { content: 'Tested' },
      cells: [{ content: statistic }, { content: 'Plain' }],
    });
    for (const result of [
      validateDocument(document),
      validateJsonDocument(JSON.stringify(document)),
    ]) {
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          path: CELL,
          code: 'unsupported_cell_content',
          value: 'statistic',
          message: expect.stringContaining(
            'A table cell cannot hold a "statistic"'
          ),
          suggestion: expect.stringContaining(
            'columns component with one statistic per column'
          ),
        },
      ]);
    }
  });

  it('names every component a cell does hold', () => {
    const [error] = validateDocument(
      tableDocument({ cells: [{ content: statistic }] })
    ).errors!;
    for (const name of TABLE_CELL_COMPONENTS) {
      expect(error.message).toContain(`"${name}"`);
    }
  });

  it('refuses one in a column header too', () => {
    const result = validateDocument(
      tableDocument({ header: { content: statistic }, cells: [] })
    );
    expect(result.errors?.map((e) => [e.code, e.path])).toEqual([
      ['unsupported_cell_content', HEADER],
    ]);
  });

  it.each(
    STANDARD_COMPONENTS_REGISTRY.map((c) => c.name).filter(
      (name) => !(TABLE_CELL_COMPONENTS as readonly string[]).includes(name)
    )
  )('refuses a %s in a cell', (name) => {
    const errors = validateDocument(
      tableDocument({ cells: [{ content: { name, props: {} } }] })
    ).errors!;
    expect(errors.filter((e) => e.code === 'unsupported_cell_content')).toEqual(
      [expect.objectContaining({ path: CELL, value: name })]
    );
  });

  it('is not rescued by the containment leniency', () => {
    // A heading straight under the root fails stage 1 on containment alone,
    // which the empty-walk gate forgives; the cell must still be reported.
    const result = validateDocument({
      name: 'docx',
      props: {},
      children: [
        { name: 'heading', props: { text: 'Loose', level: 1 } },
        {
          name: 'table',
          props: { columns: [{ cells: [{ content: statistic }] }] },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.map((e) => [e.code, e.path])).toEqual([
      [
        'unsupported_cell_content',
        '/children/1/props/columns/0/cells/0/content',
      ],
    ]);
  });

  it('leaves a registered plugin to the plugin layer', () => {
    const result = validateDocument(
      tableDocument({ cells: [{ content: { name: 'kpi-tile', props: {} } }] }),
      { knownCustomNames: new Set(['kpi-tile']) }
    );
    expect(result.valid).toBe(true);
  });

  it('refuses one written into a block definition, where every invocation would paint it', () => {
    const result = validateDocument({
      name: 'docx',
      props: {
        blocks: {
          'kpi-table': {
            body: [
              {
                name: 'table',
                props: { columns: [{ cells: [{ content: statistic }] }] },
              },
            ],
          },
        },
      },
      children: [
        {
          name: 'section',
          props: {},
          children: [{ name: 'block', props: { ref: 'kpi-table' } }],
        },
      ],
    });
    expect(
      result.errors
        ?.filter((e) => e.code === 'unsupported_cell_content')
        .map((e) => e.path)
    ).toEqual([
      '/props/blocks/kpi-table/body/0/props/columns/0/cells/0/content',
    ]);
  });
});

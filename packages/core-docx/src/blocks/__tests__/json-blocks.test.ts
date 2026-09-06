import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { Type } from '@sinclair/typebox';
import { validateDocument } from '@json-to-office/shared-docx';
import { ComponentValidationError } from '../../plugin/validation';
import { blockSlotBudgets } from '../document';
import { expandBlocks, toAuthoredPointer } from '../index';
import {
  consultingTheme,
  minimalTheme,
  vermilionTheme,
  devportalTheme,
} from '../../styles';
import {
  generateBufferFromJson,
  generateBufferWithWarnings,
} from '../../core/generator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { QUALITY_CODES } from '@json-to-office/quality';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';
import { createComponent } from '../../plugin/createComponent';
import { prepareDocxQualityDocument } from '../../quality/facts';

import { example, invocation, on } from './example';
const simple = () => {
  const doc = example();
  doc.children = [
    {
      name: 'section',
      children: [
        {
          name: 'block',
          props: {
            ref: 'key-takeaways',
            slots: { items: ['First point.', 'Second point.', 'Third point.'] },
          },
        },
      ],
    },
  ];
  return doc;
};
const para = (text: string) => ({ name: 'paragraph', props: { text } });

describe('JSON report blocks from playground templates', () => {
  it('validates the complete example and rejects absent definitions', () => {
    expect(validateDocument(example()).valid).toBe(true);
    const input = simple();
    delete input.props.blocks;
    expect(validateDocument(input).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_unknown_reference',
          path: '/children/0/children/0/props/ref',
        }),
      ])
    );
  });
  it.each([consultingTheme, minimalTheme, vermilionTheme, devportalTheme])(
    'expands on $name without a privileged named-block registry',
    (theme) => {
      const input = simple();
      const expanded = expandBlocks(input, theme);
      expect(expanded.document.children[0].children[0].name).toBe('group');
      expect(
        expanded.document.children[0].children[0].children.map(
          (v: any) => v.name
        )
      ).toEqual(['divider', 'paragraph', 'list', 'divider']);
      expect(
        toAuthoredPointer(
          expanded.sourceMap,
          '/children/0/children/0/children/2/props/items/1'
        )
      ).toBe('/children/0/children/0/props/slots/items/1');
      expect(input.children[0].children[0].name).toBe('block');
    }
  );
  it('changes a copied definition without changing engine code', () => {
    const input = simple();
    input.props.blocks['my-summary'] = {
      ...input.props.blocks['key-takeaways'],
      body: [para('Custom composition')],
    };
    input.children[0].children[0].props.ref = 'my-summary';
    expect(
      expandBlocks(input, consultingTheme).document.children[0].children[0]
        .children
    ).toEqual([para('Custom composition')]);
  });
  it('reports invalid slot content and unknown slots before rendering', () => {
    const input = simple();
    input.children[0].children[0].props.slots.items[1] = 'word '.repeat(30);
    input.children[0].children[0].props.slots.x = 20;
    const issues = validateDocument(input).errors;
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_slot_budget',
          path: '/children/0/children/0/props/slots/items/1',
        }),
        expect.objectContaining({
          code: 'block_unknown_slot',
          path: '/children/0/children/0/props/slots/x',
        }),
      ])
    );
  });
  it('validates emitted primitives, even when their definition is structurally valid JSON', () => {
    const input = simple();
    input.props.blocks['key-takeaways'].body = [
      { name: 'paragraph', props: { text: 42 } },
    ];
    expect(() => expandBlocks(input, consultingTheme)).toThrow();
  });
  it('keeps optional cover groups absent, including their content', () => {
    const input = simple();
    input.children[0].children[0].props = {
      ref: 'cover',
      slots: { title: 'Only the title' },
    };
    const children = expandBlocks(input, consultingTheme).document.children[0]
      .children[0].children;
    expect(
      children
        .filter((v: any) => v.name === 'paragraph')
        .map((v: any) => v.props.text)
    ).toEqual(['', 'Only the title']);
  });
  it('applies section trackers, inherited chrome and each section’s page width', () => {
    const expanded = expandBlocks(example(), consultingTheme);
    expect(expanded.document.children[0].props.header).toBeUndefined();
    const report = expanded.document.children[1];
    const letter = expanded.document.children[2];
    expect(report.props.header[0].props.text).toBe(
      'Client performance report\tPerformance'
    );
    expect(letter.props.header[0].props.text).toBe(
      'Client performance report\tRecommendations'
    );
    expect(letter.props.header[0].props.tabStops[0].position).toBe(10800);
    expect(letter.props.footer[1].props.tabStops[0].position).toBe(5400);
    expect(letter.props.pageBreak).toBe(true);
  });
  it('honors authored section parts and page breaks', () => {
    const input = example();
    input.children[2].props.header = [para('Author header')];
    input.children[2].props.pageBreak = false;
    const section = expandBlocks(input, consultingTheme).document.children[2];
    expect(section.props.header).toEqual([para('Author header')]);
    expect(section.props.pageBreak).toBe(false);
    expect(section.props.footer).toHaveLength(2);
  });
  it('rejects section effects in header and nested layout regions', () => {
    const input = simple();
    input.children[0].props = {
      header: [{ name: 'block', props: { ref: 'running-head' } }],
    };
    expect(validateDocument(input).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_placement' }),
      ])
    );
  });
  it('keeps native page fields and real headings in the generated Word package', async () => {
    // The figures need an export server and a media directory; the page
    // fields and headings under test do not.
    const doc = example();
    for (const section of doc.children)
      section.children = section.children.filter(
        (child: any) =>
          !(
            child.name === 'block' &&
            ['chart-figure', 'figure'].includes(child.props.ref)
          )
      );
    const zip = new AdmZip(await generateBufferFromJson(doc));
    const main = zip.readAsText('word/document.xml');
    const headers = zip
      .getEntries()
      .filter((e) => /word\/header\d+\.xml$/.test(e.entryName))
      .map((e) => e.getData().toString())
      .join('');
    const footers = zip
      .getEntries()
      .filter((e) => /word\/footer\d+\.xml$/.test(e.entryName))
      .map((e) => e.getData().toString())
      .join('');
    expect(main).toContain('Growth improved');
    expect(main).toContain('Heading1');
    expect(headers).toContain('Recommendations');
    expect(footers).toContain('PAGE');
    expect(footers).toContain('NUMPAGES');
  });
  it('uses the same expanded model for quality and rendering', () => {
    const input = simple();
    const prepared = prepareDocxQualityDocument(input);
    expect(JSON.stringify(prepared)).toContain('/props/slots/items');
  });
  it('supports plugin → block and block → plugin → block with bounded recursion', async () => {
    const component = createComponent({
      name: 'calculated',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({ value: Type.String() }),
          render: async ({ props }) => [
            {
              name: 'block',
              props: { ref: 'leaf', slots: { value: props.value } },
            },
          ],
        },
      },
    });
    const input = simple();
    input.props.blocks.leaf = {
      slots: { value: { type: 'string', required: true } },
      body: [{ name: 'paragraph', props: { text: { $slot: '/value' } } }],
    };
    input.props.blocks.outer = {
      slots: {},
      body: [{ name: 'calculated', props: { value: 'Calculated content' } }],
    };
    input.children[0].children = [
      { name: 'block', props: { ref: 'outer' } },
      { name: 'calculated', props: { value: 'Direct plugin' } },
    ];
    const generator = createDocumentGenerator({}).addComponent(component);
    const expanded = await generator.expandStandardDefinition(input);
    expect(JSON.stringify(expanded.standardDefinition.children)).toContain(
      'Calculated content'
    );
    expect(JSON.stringify(expanded.standardDefinition.children)).toContain(
      'Direct plugin'
    );
    expect(validateDocument(expanded.standardDefinition).valid).toBe(true);
    input.props.blocks.leaf.body = [
      { name: 'calculated', props: { value: 'Loop' } },
    ];
    await expect(generator.expandStandardDefinition(input)).rejects.toThrow(
      /nesting|limit/
    );
  });
  it.each([2, 4])(
    'adapts %i items into equal columns and collapses optional decorations',
    (count) => {
      const input = simple();
      input.children[0].children = [
        {
          name: 'block',
          props: {
            ref: 'kpi-row',
            slots: {
              items: Array.from({ length: count }, (_, i) => ({
                value: String(i),
                label: 'Metric',
              })),
            },
          },
        },
      ];
      const expanded = expandBlocks(input, consultingTheme);
      const group = expanded.document.children[0].children[0];
      expect(group.children).toHaveLength(1);
      expect(group.children[0].props.columns).toBe(count);
      expect(group.children[0].children).toHaveLength(count);
      expect(
        toAuthoredPointer(
          expanded.sourceMap,
          `/children/0/children/0/children/0/children/${count - 1}/props/number`
        )
      ).toBe(`/children/0/children/0/props/slots/items/${count - 1}/value`);
      input.children[0].children[0].props.slots.source = 'Evidence';
      const sourced = expandBlocks(input, consultingTheme).document.children[0]
        .children[0].children;
      expect(sourced.map((c: any) => c.name)).toEqual(['columns', 'group']);
      expect(sourced[1].children).toHaveLength(2);
      input.children[0].children[0].props.slots.items = Array.from(
        { length: 5 },
        () => ({ value: '1', label: 'Too many' })
      );
      expect(() => expandBlocks(input, consultingTheme)).toThrow(
        /Maximum item count/
      );
    }
  );
  it('reports missing plugin registration and invalid plugin output at the authored block', async () => {
    const input = simple();
    input.props.blocks.outer = {
      slots: {},
      body: [{ name: 'missing-plugin', props: {} }],
    };
    input.children[0].children = [{ name: 'block', props: { ref: 'outer' } }];
    await expect(
      createDocumentGenerator({}).expandStandardDefinition(input)
    ).rejects.toThrow(/children\/0\/children\/0/);
    const invalid = createComponent({
      name: 'invalid-output',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({}),
          render: async () =>
            [{ name: 'paragraph', props: { text: 42 } }] as any,
        },
      },
    });
    input.props.blocks.outer.body[0].name = 'invalid-output';
    await expect(
      createDocumentGenerator({})
        .addComponent(invalid)
        .expandStandardDefinition(input)
    ).rejects.toBeInstanceOf(ComponentValidationError);
  });
  it('rejects section effects introduced inside a layout by another block', () => {
    const input = simple();
    input.props.blocks.outer = {
      slots: {},
      body: [
        {
          name: 'columns',
          props: { columns: 2 },
          children: [{ name: 'block', props: { ref: 'running-head' } }],
        },
      ],
    };
    input.children[0].children = [{ name: 'block', props: { ref: 'outer' } }];
    expect(() => expandBlocks(input, consultingTheme)).toThrow(
      /Section effects require/
    );
  });
  it('exports budgets and quality facts for nested object slots inside arrays', () => {
    const input = simple();
    input.props.blocks.nested = {
      slots: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string', maxWords: 6 } },
          },
        },
      },
      body: [
        {
          $each: '/items',
          template: { name: 'paragraph', props: { text: { $item: '/label' } } },
        },
      ],
    };
    input.children[0].children = [
      {
        name: 'block',
        props: {
          ref: 'nested',
          slots: {
            items: [{ label: 'First metric' }, { label: 'Second metric' }],
          },
        },
      },
    ];
    const budgets = blockSlotBudgets(input, ['/children/0/children/0']);
    expect(budgets).toHaveLength(2);
    expect(budgets[1]).toMatchObject({
      path: '/children/0/children/0/props/slots/items/1/label',
      words: 2,
      maxWords: 6,
    });
    expect(
      prepareDocxQualityDocument(input).facts.filter(
        (fact) => fact.kind === 'docx/block-slot'
      )
    ).toHaveLength(2);
  });
  it('accepts a plugin emitting section-effect blocks at a section boundary', async () => {
    const component = createComponent({
      name: 'chrome',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({}),
          render: async () => [
            {
              name: 'block',
              props: { ref: 'running-head', slots: { title: 'Plugin report' } },
            },
          ],
        },
      },
    });
    const input = simple();
    input.children[0].children = [{ name: 'chrome', props: {} }];
    const result = await createDocumentGenerator({})
      .addComponent(component)
      .expandStandardDefinition(input);
    expect(
      JSON.stringify(result.standardDefinition.children[0].props.header)
    ).toContain('Plugin report');
  });

  it('draws a kpi-row metric with its unit, delta and direction, and nothing it was not given', () => {
    const doc = on('consulting', invocation('kpi-row'));
    const expanded = expandBlocks(doc, consultingTheme);
    const stats =
      expanded.document.children[0].children[0].children[0].children;
    expect(stats.map((s: any) => s.name)).toEqual([
      'statistic',
      'statistic',
      'statistic',
    ]);
    expect(stats[0].props).toEqual({
      number: '8.8',
      unit: ' €m',
      description: 'Revenue year to date',
      trend: 'up',
      trendValue: '+16.9%',
    });
    doc.children[0].children[0].props.slots.items = [
      { value: '1', label: 'Bare' },
      { value: '2', label: 'Bare' },
    ];
    const bare = expandBlocks(doc, consultingTheme).document.children[0]
      .children[0].children[0].children[0].props;
    expect(Object.keys(bare)).toEqual(['number', 'description']);
    doc.children[0].children[0].props.slots.items[0].trend = 'sideways';
    expect(validateDocument(doc).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/children/0/children/0/props/slots/items/0/trend',
        }),
      ])
    );
  });

  describe('callout', () => {
    it('sets its text off with one hairline on the left, no fill, in the theme rule colour', () => {
      const box = expandBlocks(
        on('consulting', invocation('callout')),
        consultingTheme
      ).document.children[0].children[0].children[0];
      expect(box.name).toBe('text-box');
      expect(box.props.style.border).toEqual({
        left: { style: 'solid', width: 0.75, color: '#C9CED6' },
      });
      expect(box.props.style.shading).toBeUndefined();
      expect(box.children.map((c: any) => c.props.text)).toEqual([
        'How to read the deltas',
        expect.stringContaining('Deltas compare'),
      ]);
      expect(box.children[0].props.font.size).toBe(9);
    });
    it('labels itself "Note" by default and budgets the body at sixty words', () => {
      const doc = on('minimal', {
        name: 'block',
        props: { ref: 'callout', slots: { text: 'Short.' } },
      });
      expect(
        expandBlocks(doc, minimalTheme).document.children[0].children[0]
          .children[0].children[0].props.text
      ).toBe('Note');
      doc.children[0].children[0].props.slots.text = 'word '.repeat(61);
      expect(validateDocument(doc).errors).toEqual([
        expect.objectContaining({
          code: 'block_slot_budget',
          path: '/children/0/children/0/props/slots/text',
        }),
      ]);
    });
  });

  describe('data-table', () => {
    const table = (doc: any, theme = consultingTheme) =>
      expandBlocks(doc, theme).document.children[0].children[0].children[1];

    it('right-aligns every numeric column, header included, and leaves the label column alone', () => {
      const compiled = table(on('consulting', invocation('data-table')));
      expect(compiled.name).toBe('table');
      expect(compiled.props.width).toBe(100);
      const [labels, ...data] = compiled.props.columns;
      expect(labels.header).toEqual({ content: 'Segment' });
      expect(labels.cellDefaults).toBeUndefined();
      expect(labels.cells.map((c: any) => c.content)).toEqual([
        'Enterprise',
        'Mid-market',
        'Public sector',
        'All segments',
      ]);
      expect(data).toHaveLength(3);
      for (const column of data) {
        expect(column.header.horizontalAlignment).toBe('right');
        expect(column.cellDefaults).toEqual({ horizontalAlignment: 'right' });
        expect(column.cells).toHaveLength(4);
      }
      expect(data[0].cells.map((c: any) => c.content)).toEqual([
        '4.2',
        '2.7',
        '1.9',
        '8.8',
      ]);
    });

    it('lets a column opt out of numeric alignment', () => {
      const doc = on('consulting', invocation('data-table'));
      doc.children[0].children[0].props.slots.columns[1] = {
        header: 'Owner',
        numeric: false,
        cells: ['A', 'B', 'C', 'D'],
      };
      const column = table(doc).props.columns[2];
      expect(column.header.horizontalAlignment).toBe('left');
      expect(column.cellDefaults).toEqual({ horizontalAlignment: 'left' });
    });

    it('passes the table-design rules on the compiled table, and reports a rounding slip at the authored column', () => {
      const tableCodes = [
        QUALITY_CODES.TABLE_NUMERIC_ALIGN,
        QUALITY_CODES.TABLE_MIXED_DECIMALS,
        QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
        QUALITY_CODES.TABLE_GRID,
      ];
      const findings = (doc: unknown) =>
        analyzeDocxQuality(doc).diagnostics.filter((d) =>
          tableCodes.includes(d.code as never)
        );
      expect(findings(example())).toEqual([]);
      const doc = on('consulting', invocation('data-table'));
      doc.children[0].children[0].props.slots.columns[1].cells = [
        '21.0',
        '14',
        '9.8',
        '16.9',
      ];
      expect(findings(doc)).toEqual([
        expect.objectContaining({
          code: QUALITY_CODES.TABLE_MIXED_DECIMALS,
          path: '/children/0/children/0/props/slots/columns/1',
        }),
      ]);
    });

    it('still offers the alignment patch when a whole authored table passes through a slot', () => {
      const doc = on('consulting');
      doc.props.blocks.framed = {
        slots: { table: { type: 'component', required: true } },
        body: [{ $slot: '/table' }],
      };
      doc.children[0].children = [
        {
          name: 'block',
          props: {
            ref: 'framed',
            slots: {
              table: {
                name: 'table',
                props: {
                  columns: [
                    {
                      header: { content: 'Region' },
                      cells: [{ content: 'North' }, { content: 'South' }],
                    },
                    {
                      header: { content: 'Revenue' },
                      cells: [{ content: '4.2' }, { content: '3.1' }],
                    },
                  ],
                },
              },
            },
          },
        },
      ];
      const [finding] = analyzeDocxQuality(doc).diagnostics.filter(
        (d) => d.code === QUALITY_CODES.TABLE_NUMERIC_ALIGN
      );
      expect(finding.path).toBe(
        '/children/0/children/0/props/slots/table/props/columns/1'
      );
      expect(finding.fixes?.[0]).toEqual({
        op: 'add',
        path: '/children/0/children/0/props/slots/table/props/columns/1/cellDefaults',
        value: { horizontalAlignment: 'right' },
      });
    });

    it('keeps the row count page-safe by schema, header row included', () => {
      const doc = on('consulting', invocation('data-table'));
      const slots = doc.children[0].children[0].props.slots;
      slots.labels = Array.from({ length: 24 }, (_, i) => `Row ${i + 1}`);
      for (const column of slots.columns) column.cells = slots.labels;
      expect(
        analyzeDocxQuality(doc).diagnostics.filter(
          (d) => d.code === QUALITY_CODES.TABLE_ROW_COUNT
        )
      ).toEqual([]);
      slots.labels = Array.from({ length: 25 }, (_, i) => `Row ${i + 1}`);
      expect(validateDocument(doc).errors).toEqual([
        expect.objectContaining({
          code: 'block_slot_budget',
          path: '/children/0/children/0/props/slots/labels',
        }),
      ]);
    });

    it('collapses notes and source with their rule', () => {
      const doc = on('consulting', invocation('data-table'));
      const full = expandBlocks(doc, consultingTheme).document.children[0]
        .children[0].children;
      expect(full.map((c: any) => c.name)).toEqual([
        'paragraph',
        'table',
        'paragraph',
        'group',
      ]);
      expect(full[3].children.map((c: any) => c.name)).toEqual([
        'divider',
        'paragraph',
      ]);
      expect(
        toAuthoredPointer(
          expandBlocks(doc, consultingTheme).sourceMap,
          '/children/0/children/0/children/3/children/1/props/text'
        )
      ).toBe('/children/0/children/0/props/slots/source');
      delete doc.children[0].children[0].props.slots.notes;
      delete doc.children[0].children[0].props.slots.source;
      expect(
        expandBlocks(
          doc,
          consultingTheme
        ).document.children[0].children[0].children.map((c: any) => c.name)
      ).toEqual(['paragraph', 'table']);
    });
  });

  describe('sources and figures', () => {
    const chart = {
      name: 'chart',
      props: {
        type: 'bar',
        valAxisTitle: 'Revenue (€m)',
        data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [4.2, 4.6] }],
      },
    };
    const withDefinitions = (doc: any) => {
      doc.renderer = 'office-open';
      doc.props.blocks.figure = {
        slots: {
          chart: { type: 'component', required: true },
          takeaway: { type: 'string', role: 'takeaway' },
          source: { type: 'string', role: 'source' },
        },
        body: [{ $slot: '/chart' }],
      };
      doc.props.blocks.sources = {
        slots: {},
        body: [
          {
            $if: { $context: '/sources' },
            then: {
              name: 'list',
              props: {
                format: 'decimal',
                items: {
                  $each: { $context: '/sources' },
                  template: { $item: '' },
                },
              },
            },
          },
        ],
      };
      return doc;
    };

    it('exposes every distinct source line, in order, at the slot it was written', () => {
      const doc = withDefinitions(
        on(
          'consulting',
          {
            name: 'block',
            props: { ref: 'figure', slots: { chart, source: 'Source: A.' } },
          },
          {
            name: 'block',
            props: { ref: 'figure', slots: { chart, source: 'Source: B.' } },
          },
          {
            name: 'block',
            props: { ref: 'figure', slots: { chart, source: 'Source: A.' } },
          },
          { name: 'block', props: { ref: 'sources' } }
        )
      );
      const expanded = expandBlocks(doc, consultingTheme);
      const list = expanded.document.children[0].children[3].children[0];
      expect(list.props.items).toEqual(['Source: A.', 'Source: B.']);
      expect(
        toAuthoredPointer(
          expanded.sourceMap,
          '/children/0/children/3/children/0/props/items/1'
        )
      ).toBe('/children/0/children/1/props/slots/source');
      doc.children[0].children = [{ name: 'block', props: { ref: 'sources' } }];
      expect(
        expandBlocks(doc, consultingTheme).document.children[0].children[0]
          .children
      ).toEqual([]);
    });

    it('reads a chart’s takeaway and source from the block that placed it', () => {
      const annotation = (slots: Record<string, unknown>) =>
        analyzeDocxQuality(
          withDefinitions(
            on('consulting', {
              name: 'block',
              props: { ref: 'figure', slots: { chart, ...slots } },
            })
          )
        ).diagnostics.filter((d) => d.code === QUALITY_CODES.CHART_ANNOTATION);
      expect(annotation({ source: 'Source: A.' })).toEqual([]);
      expect(annotation({ takeaway: 'Growth held.' })).toEqual([]);
      expect(annotation({})).toEqual([
        expect.objectContaining({
          path: '/children/0/children/0/props/slots/chart',
        }),
      ]);
    });
  });

  describe.each([
    ['consulting', consultingTheme],
    ['minimal', minimalTheme],
    ['vermilion', vermilionTheme],
    ['devportal', devportalTheme],
  ])('on the %s theme', (theme) => {
    it('renders kpi-row, callout and data-table warning-clean under the default profile', async () => {
      const doc = on(
        theme,
        invocation('kpi-row'),
        invocation('callout'),
        invocation('data-table')
      );
      expect(validateDocument(doc).errors).toEqual([]);
      const { warnings } = await generateBufferWithWarnings(doc);
      expect(warnings).toEqual([]);
      expect(
        analyzeDocxQuality(doc).diagnostics.filter(
          (finding) => finding.severity !== 'info'
        )
      ).toEqual([]);
    });
  });
});

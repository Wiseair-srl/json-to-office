import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { Type } from '@sinclair/typebox';
import { validateDocument } from '@json-to-office/shared-docx';
import { expandBlocks, toAuthoredPointer } from '../index';
import {
  consultingTheme,
  minimalTheme,
  vermilionTheme,
  devportalTheme,
} from '../../styles';
import { generateBufferFromJson } from '../../core/generator';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';
import { createComponent } from '../../plugin/createComponent';
import { prepareDocxQualityDocument } from '../../quality/facts';

const example = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../jto/src/client/public/templates/client-report-blocks.docx.json',
        import.meta.url
      ),
      'utf8'
    )
  );
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
    const zip = new AdmZip(await generateBufferFromJson(example()));
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
      format: 'docx',
      slots: { value: { type: 'string', required: true } },
      body: [{ name: 'paragraph', props: { text: { $slot: '/value' } } }],
    };
    input.props.blocks.outer = {
      format: 'docx',
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
            ref: 'metric-row',
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
      expect(
        expandBlocks(input, consultingTheme).document.children[0].children[0]
          .children
      ).toHaveLength(3);
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
      format: 'docx',
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
    ).rejects.toThrow(/children\/0\/children\/0/);
  });
  it('rejects section effects introduced inside a layout by another block', () => {
    const input = simple();
    input.props.blocks.outer = {
      format: 'docx',
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
});

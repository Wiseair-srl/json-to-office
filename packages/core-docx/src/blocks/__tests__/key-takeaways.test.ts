/**
 * The key-takeaways block, from authored slots to rendered paragraphs.
 *
 * What a block promises is observable from outside: the primitives it lowers
 * to and where their values come from (the theme's recipe, never a constant
 * of its own), that the lowered tree is itself a valid document, that a
 * finding inside the compiled output is reported at the authored slot, and
 * that both renderers draw it. Everything here is asserted on those.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { validateStrict } from '@json-to-office/shared-docx';
import { blockSlotBudgets, expandBlocks, toAuthoredPointer } from '../index';
import { consultingTheme, minimalTheme } from '../../templates/themes';
import { resolveDocxDesignSystem } from '../../themes/design-system';
import { prepareDocxQualityDocument } from '../../quality/facts';
import { analyzeDocxQuality } from '../../quality/preflight';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { generateBufferFromJson } from '../../core/generator';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';

const takeaways = [
  'Revenue grew in every region for a third consecutive quarter.',
  'The gap between the strongest and weakest region narrowed from 31 to 19 points.',
  'Islands remains below plan; a targeted channel review is recommended.',
];

const report = (theme: string, items = takeaways, extra = {}) => ({
  name: 'docx',
  props: { theme, metadata: { title: 'Report', author: 'A' } },
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { text: 'Summary', level: 1 } },
        { name: 'key-takeaways', props: { items, ...extra } },
        { name: 'paragraph', props: { text: 'After the box.' } },
      ],
    },
  ],
});

const BLOCK = '/children/0/children/1';

describe('expandBlocks', () => {
  it('lowers the block to the theme recipe, in place, with a source map', () => {
    const theme = resolveDocxDesignSystem(consultingTheme);
    const { document, sourceMap, blocks } = expandBlocks(
      report('consulting'),
      theme
    );
    const block = document.children[0].children[1] as {
      name: string;
      props: unknown;
      children: Array<{ name: string; props: Record<string, unknown> }>;
    };
    expect(blocks).toEqual([BLOCK]);
    // The block node keeps its name and slots: nothing around it moved.
    expect(block.name).toBe('key-takeaways');
    expect(block.props).toEqual({ items: takeaways });
    expect(document.children[0].children[2]).toEqual({
      name: 'paragraph',
      props: { text: 'After the box.' },
    });
    // The consulting recipe: a 2pt accent rule, the label role, 8pt pad.
    expect(block.children.map((child) => child.name)).toEqual([
      'divider',
      'paragraph',
      'list',
      'divider',
    ]);
    expect(block.children[0].props).toEqual({
      thickness: 2,
      color: 'accent',
      spacing: { before: 12, after: 8 },
    });
    expect(block.children[1].props).toEqual({
      text: 'Key takeaways',
      themeStyle: 'label',
      keepNext: true,
      spacing: { after: 4 },
    });
    expect(block.children[2].props).toEqual({ items: takeaways });
    expect(block.children[3].props).toMatchObject({
      thickness: 0.5,
      color: 'borderPrimary',
    });
    expect(sourceMap).toEqual({
      [`${BLOCK}/children/0`]: BLOCK,
      [`${BLOCK}/children/1`]: BLOCK,
      [`${BLOCK}/children/1/props/text`]: `${BLOCK}/props/label`,
      [`${BLOCK}/children/2`]: BLOCK,
      [`${BLOCK}/children/2/props/items`]: `${BLOCK}/props/items`,
      [`${BLOCK}/children/3`]: BLOCK,
    });
    expect(
      toAuthoredPointer(sourceMap, `${BLOCK}/children/2/props/items/1`)
    ).toBe(`${BLOCK}/props/items/1`);
    expect(
      toAuthoredPointer(sourceMap, '/children/0/children/2/props/text')
    ).toBe('/children/0/children/2/props/text');
  });

  it('holds on a theme with no recipe: accent rule, bold label, authored label', () => {
    const { document } = expandBlocks(
      report('minimal', takeaways, { label: 'What matters' }),
      minimalTheme
    );
    const block = document.children[0].children[1] as {
      children: Array<{ name: string; props: Record<string, unknown> }>;
    };
    expect(block.children[0].props).toEqual({
      thickness: 1.5,
      color: 'accent',
      spacing: { before: 12, after: 6 },
    });
    expect(block.children[1].props).toEqual({
      text: 'What matters',
      keepNext: true,
      spacing: { after: 4 },
      font: { bold: true },
    });
  });

  it('emits primitives that validate as a document on their own', () => {
    const { document } = expandBlocks(report('consulting'), consultingTheme);
    const block = document.children[0].children[1] as { children: unknown[] };
    const lowered = {
      ...document,
      children: [{ name: 'section', children: block.children }],
    };
    expect(validateStrict.document(lowered).errors).toEqual([]);
  });

  it('leaves a document without blocks untouched, and a disabled block unexpanded', () => {
    const plain = report('minimal');
    plain.children[0].children.splice(1, 1);
    const same = expandBlocks(plain, minimalTheme);
    expect(same.document).toBe(plain);
    expect(same.sourceMap).toEqual({});
    const disabled = report('minimal');
    (disabled.children[0].children[1] as Record<string, unknown>).enabled =
      false;
    const { document, blocks } = expandBlocks(disabled, minimalTheme);
    expect(blocks).toEqual([]);
    expect(document.children[0].children[1]).not.toHaveProperty('children');
  });

  it('reaches blocks inside section headers and table cells', () => {
    const nested = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {
            header: [{ name: 'key-takeaways', props: { items: takeaways } }],
          },
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  {
                    header: { content: 'A' },
                    cells: [
                      {
                        content: {
                          name: 'key-takeaways',
                          props: { items: takeaways },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(expandBlocks(nested, minimalTheme).blocks).toEqual([
      '/children/0/props/header/0',
      '/children/0/children/0/props/columns/0/cells/0/content',
    ]);
  });

  it('counts each takeaway against its word budget', () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    expect(
      blockSlotBudgets(report('minimal', [takeaways[0], long, 'x  y']), [BLOCK])
    ).toEqual([
      {
        block: 'key-takeaways',
        slot: 'items',
        path: `${BLOCK}/props/items/0`,
        words: 10,
        maxWords: 25,
      },
      {
        block: 'key-takeaways',
        slot: 'items',
        path: `${BLOCK}/props/items/1`,
        words: 30,
        maxWords: 25,
      },
      {
        block: 'key-takeaways',
        slot: 'items',
        path: `${BLOCK}/props/items/2`,
        words: 2,
        maxWords: 25,
      },
    ]);
  });
});

describe('the block in the pipeline', () => {
  it('prepares the expanded tree and remaps facts onto the authored slots', () => {
    const prepared = prepareDocxQualityDocument(
      report('consulting', [
        takeaways[0],
        'Lorem ipsum dolor sit amet, the second takeaway.',
        takeaways[2],
      ]) as never
    );
    expect(prepared.metadata?.blocks).toMatchObject({
      sourceMap: {
        [`${BLOCK}/children/2/props/items`]: `${BLOCK}/props/items`,
      },
    });
    const compiled = (
      prepared.model.context.document.children[0] as { children: unknown[] }
    ).children[1] as { children: unknown[] };
    expect(compiled.children).toHaveLength(4);
    // Every fact path is an authored pointer: nothing points into children
    // the author never wrote.
    for (const fact of prepared.facts) {
      expect(fact.path.startsWith(`${BLOCK}/children`)).toBe(false);
    }
    const placeholder = prepared.facts.find(
      (fact) => fact.kind === 'docx/placeholder'
    );
    expect(placeholder?.path).toBe(`${BLOCK}/props/items/1`);
  });

  it('reports an over-budget takeaway at its slot, and nothing on a fitting one', () => {
    const long =
      'This takeaway runs on and on, listing every region and every quarter and every caveat until nobody can say what the point of it was meant to be.';
    const analysis = analyzeDocxQuality(
      report('consulting', [takeaways[0], long, takeaways[2]])
    );
    const budget = analysis.diagnostics.filter(
      (entry) => entry.code === 'W_QUALITY_SLOT_BUDGET'
    );
    expect(budget).toHaveLength(1);
    expect(budget[0]).toMatchObject({
      severity: 'warning',
      path: `${BLOCK}/props/items/1`,
      evidence: { actual: 28, expected: 25, unit: 'words' },
    });
    expect(budget[0].message).toContain('28 words');
    expect(analyzeDocxQuality(report('consulting')).counts).toEqual({
      error: 0,
      warning: 0,
      info: 0,
    });
  });

  it('compiles a disabled block, even one a container forwards unfiltered, to nothing', async () => {
    const document = {
      ...report('consulting'),
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'columns',
              props: { columns: 2 },
              children: [
                { name: 'paragraph', props: { text: 'Left.' } },
                {
                  name: 'key-takeaways',
                  enabled: false,
                  props: { items: takeaways },
                },
              ],
            },
            {
              name: 'key-takeaways',
              enabled: false,
              props: { items: takeaways },
            },
          ],
        },
      ],
    };
    const compiled = await compileDocumentToIr(document as never, {
      validation: { enabled: false },
    });
    expect(compiled.unsupported).toEqual([]);
    const xml = JSON.stringify(compiled.ir);
    expect(xml).not.toContain('Key takeaways');
    expect(xml).toContain('Left.');
  });

  it('compiles to IR under the block path and renders through both pipelines', async () => {
    const compiled = await compileDocumentToIr(report('consulting') as never, {
      validation: { enabled: false },
    });
    expect(compiled.unsupported).toEqual([]);
    const section = compiled.ir.sections[0];
    const paths = section.children.map((block) => block.path);
    expect(paths).toContain('sections[0].children[1].children[1]');
    // The list lowers to one paragraph per item, each under the list's path.
    expect(
      paths.filter((path) =>
        path.startsWith('sections[0].children[1].children[2]')
      )
    ).toHaveLength(3);
    for (const renderer of ['docxjs', 'office-open'] as const) {
      const input = { ...report('consulting'), renderer };
      const core = await generateBufferFromJson(
        structuredClone(input) as never
      );
      const plugin = await createDocumentGenerator({}).generateBuffer(
        structuredClone(input) as never
      );
      const a = await JSZip.loadAsync(core);
      const b = await JSZip.loadAsync(plugin.buffer);
      const xml = await a.file('word/document.xml')!.async('string');
      expect(await b.file('word/document.xml')!.async('string')).toBe(xml);
      expect(xml).toContain('Key takeaways');
      expect(xml).toContain('w:pStyle w:val="label"');
      expect(xml).toContain('narrowed from 31 to 19 points');
      expect(xml).toContain('After the box.');
      // The accent rule: a 2pt (16 eighths) bottom border in the accent blue.
      expect(xml).toContain(
        '<w:bottom w:val="single" w:color="1B4F8A" w:sz="16"'
      );
      expect(xml).toContain(
        '<w:bottom w:val="single" w:color="C9CED6" w:sz="4"'
      );
    }
  });
});

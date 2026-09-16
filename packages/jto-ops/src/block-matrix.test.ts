/**
 * The block boundary matrix, static half (#343).
 *
 * The inventory reads every playground template the way MCP discovery does
 * and states, for each embedded definition, the themes, canvases, fonts and
 * slot edges it is supported on — and why not the rest. Every supported
 * case must then validate and come back free of warning-severity findings
 * under the profile of the blueprint that draws on its template: a block
 * that ships a budget its own composition cannot hold at the theme's sizes
 * fails here, before LibreOffice is asked. The rendered half lives beside
 * the preview integration suite in `mcp-server`, where the converters are.
 *
 * The last part checks the opposite: a slot one past its budget, an array
 * one past its bound and a definition that names a missing dependency are
 * coded issues at the authored pointer. Those are expected diagnostics, not
 * matrix cases, and they keep the clean half honest — a suite that only ever
 * expects silence cannot tell a rule from its absence.
 */

import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCX_BLUEPRINTS,
  DOCX_QUALITY_PROFILES,
  themes,
} from '@json-to-office/core-docx';
import {
  PPTX_BLUEPRINTS,
  PPTX_QUALITY_PROFILES,
  pptxThemes,
} from '@json-to-office/core-pptx';
import {
  blockReferencesFromDocument,
  blockValueAt,
  readBlockDefinitions,
  validateBlockInvocations,
  type BlockSlot,
} from '@json-to-office/shared';
import {
  blockCaseDocument,
  boundaryInvocation,
  boundarySlotValue,
  deckBlockCaseDocument,
  enumerateBlockDefinitions,
  generateBlockMatrix,
  generateMatrixCases,
  overBudgetInvocation,
  widestNumber,
  type MatrixCase,
} from './block-matrix';
import { DocxFormatAdapter, PptxFormatAdapter } from './format-adapter';
import {
  buildMatrixInventory,
  describeInventory,
  inventoryGaps,
  matrixUniverse,
  templateFormat,
  type MatrixTemplateSource,
} from './matrix-inventory';

const TEMPLATES_DIR = path.resolve(
  __dirname,
  '../../jto/src/client/public/templates'
);
const TEMPLATES: MatrixTemplateSource[] = readdirSync(TEMPLATES_DIR)
  .filter((name) => /\.(docx|pptx)\.json$/.test(name))
  .sort()
  .map((name) => ({
    name,
    document: JSON.parse(readFileSync(path.join(TEMPLATES_DIR, name), 'utf8')),
  }));
const THEMES = { docx: Object.keys(themes), pptx: Object.keys(pptxThemes) };
const OPTIONS = {
  themes: THEMES,
  blueprints: [
    ...Object.values(DOCX_BLUEPRINTS),
    ...Object.values(PPTX_BLUEPRINTS),
  ],
  profiles: { ...DOCX_QUALITY_PROFILES, ...PPTX_QUALITY_PROFILES },
};
const INVENTORY = buildMatrixInventory(TEMPLATES, OPTIONS);
const themeObject = (name: string) =>
  (pptxThemes as Record<string, Record<string, unknown>>)[name];

const TEMPLATE_NAME = 'client-report-blocks.docx.json';
const TEMPLATE = TEMPLATES.find((t) => t.name === TEMPLATE_NAME)!
  .document as Record<string, any>;

const adapters = {
  docx: new DocxFormatAdapter(),
  pptx: new PptxFormatAdapter(),
};

/**
 * A block case is one block at its edge, not a composed report: whether the
 * document carries a chart or a table is a property of the report, so the
 * exhibit rule is suppressed here the way an author suppresses it.
 */
function qualityFor(format: 'docx' | 'pptx', profile?: string) {
  return {
    quality: {
      ...(profile && { profile: { id: profile, formats: [format] } }),
      policy: {
        suppressions: [
          {
            code: 'W_QUALITY_EXHIBIT_MISSING',
            reason: 'boundary matrix, not a composed report',
          },
        ],
      },
    },
  };
}

async function failuresOf(c: MatrixCase): Promise<string[]> {
  const failures: string[] = [];
  for (const issue of validateBlockInvocations(
    c.document,
    readBlockDefinitions(c.document),
    c.format
  ))
    failures.push(`${c.id}: ${issue.code} at ${issue.path}`);
  const analysis = await adapters[c.format].analyzeQuality(
    c.document,
    qualityFor(c.format, c.profile) as never
  );
  // A document the engine could not prepare reports nothing, and nothing is
  // not clean.
  for (const error of analysis.ruleErrors ?? [])
    failures.push(`${c.id}: ${error.ruleId}: ${error.message}`);
  if (c.profile && analysis.profileId !== c.profile)
    failures.push(`${c.id}: profile ${analysis.profileId}`);
  for (const d of analysis.diagnostics) {
    if (
      d.severity === 'warning' ||
      d.code === 'W_QUALITY_SCAFFOLD_MARKER' ||
      d.code === 'W_QUALITY_PLACEHOLDER_TEXT'
    )
      failures.push(`${c.id}: ${d.code} at ${d.path}`);
    // Advice too names something the author wrote: a pointer into the
    // expanded tree would send a patch nowhere.
    if (d.path !== undefined && blockValueAt(c.document, d.path) === undefined)
      failures.push(
        `${c.id}: ${d.code} at ${d.path}, which is not in the document`
      );
  }
  return failures;
}

describe('the inventory', () => {
  it('lists every gallery template, and every definition discovery publishes from it', () => {
    expect(INVENTORY.templates.map((t) => t.template)).toEqual(
      TEMPLATES.map((t) => t.name)
    );
    for (const source of TEMPLATES) {
      const format = templateFormat(source.name, source.document)!;
      const summary = INVENTORY.templates.find(
        (t) => t.template === source.name
      )!;
      const declared = Object.keys(readBlockDefinitions(source.document));
      expect(summary.definitions, source.name).toEqual(declared);
      const published = blockReferencesFromDocument(source.document, {
        template: source.name,
        format,
      });
      expect(
        INVENTORY.entries
          .filter((e) => e.template === source.name)
          .map((e) => [e.id, e.dependencies])
      ).toEqual(
        published.map((r) => [
          `${source.name}#${r.definitionPointer}`,
          r.dependencies,
        ])
      );
      // A template whose definitions do not validate would publish none.
      expect(published).toHaveLength(declared.length);
    }
    // eslint-disable-next-line no-console
    console.log(describeInventory(INVENTORY));
  });

  it('gives every condition it does not support a reason', () => {
    for (const entry of INVENTORY.entries) {
      const universe = matrixUniverse(entry.format, THEMES[entry.format]);
      expect(inventoryGaps(entry, universe), entry.id).toEqual([]);
      for (const exclusion of entry.exclusions)
        expect(exclusion.reason.length, entry.id).toBeGreaterThan(20);
    }
    for (const template of INVENTORY.templates) {
      const universe = matrixUniverse(template.format, THEMES[template.format]);
      expect(
        inventoryGaps(
          { ...template.conditions, exclusions: template.exclusions },
          universe
        ),
        template.template
      ).toEqual([]);
    }
  });

  it('judges a template under the profile of the blueprint that draws on it', () => {
    const profile = (name: string) =>
      INVENTORY.templates.find((t) => t.template === name);
    expect(profile('client-report-blocks.docx.json')).toMatchObject({
      profile: 'client-report',
      requiredRoles: ['takeaway', 'source'],
    });
    expect(profile('technical-report-blocks.docx.json')).toMatchObject({
      profile: 'technical-report',
      requiredRoles: ['source'],
    });
    expect(profile('consulting-deck-blocks.pptx.json')).toMatchObject({
      profile: 'consulting-deck',
      requiredRoles: ['takeaway', 'source'],
    });
    expect(profile('management-plan.pptx.json')?.profile).toBeUndefined();
  });

  it('holds a deck to the slide it is drawn on, and a theme object to itself', () => {
    const deck = INVENTORY.entries.find(
      (e) => e.id === 'consulting-deck-blocks.pptx.json#/props/blocks/statement'
    )!;
    expect(deck.themes).toEqual(THEMES.pptx);
    expect(deck.canvases).toEqual(['wide169']);
    expect(deck.exclusions).toEqual([
      {
        condition: 'canvas standard43',
        reason: expect.stringMatching(/budgets are measured/),
      },
    ]);
    const chrome = INVENTORY.entries.find(
      (e) => e.id === 'management-plan.pptx.json#/props/blocks/grid'
    )!;
    expect(chrome).toMatchObject({
      themes: ['inline'],
      canvases: ['wide169'],
      fonts: ['design'],
      edges: ['max'],
    });
    const report = INVENTORY.entries.find(
      (e) => e.id === `${TEMPLATE_NAME}#/props/blocks/kpi-row`
    )!;
    expect(report.canvases).toEqual(['A4', 'LETTER']);
    expect(report.fonts).toEqual(['design', 'fallback']);
    expect(report.exclusions).toEqual([]);
  });

  it('gains cases for a new theme or a new template without an edit', () => {
    const withTheme = buildMatrixInventory(TEMPLATES, {
      ...OPTIONS,
      themes: { ...THEMES, docx: [...THEMES.docx, 'house-two'] },
    });
    for (const entry of withTheme.entries.filter((e) => e.format === 'docx'))
      expect(entry.themes, entry.id).toContain('house-two');
    const before = generateMatrixCases(INVENTORY, TEMPLATES, {
      templates: [TEMPLATE_NAME],
      fonts: ['design'],
      canvases: ['A4'],
    });
    const after = generateMatrixCases(withTheme, TEMPLATES, {
      templates: [TEMPLATE_NAME],
      fonts: ['design'],
      canvases: ['A4'],
    });
    expect(after.length).toBe(
      before.length + before.length / THEMES.docx.length
    );

    const quote = {
      name: 'quote.pptx.json',
      document: {
        name: 'pptx',
        props: {
          theme: 'consulting',
          slideWidth: 13.333,
          slideHeight: 7.5,
          blocks: {
            quote: {
              slots: {
                text: { type: 'string', required: true, maxWords: 12 },
              },
              body: [
                {
                  name: 'text',
                  props: { text: { $slot: '/text' }, x: 1, y: 1, w: 8, h: 1 },
                },
              ],
            },
          },
        },
        children: [],
      },
    };
    const extended = buildMatrixInventory([...TEMPLATES, quote], OPTIONS);
    expect(extended.entries.map((e) => e.id)).toContain(
      'quote.pptx.json#/props/blocks/quote'
    );
    expect(
      generateMatrixCases(
        extended,
        [...TEMPLATES, quote],
        { templates: ['quote.pptx.json'] },
        { themeObject }
      ).length
    ).toBeGreaterThan(0);
  });
});

describe('the generator', () => {
  it('enumerates every definition the template embeds, with where it lives', () => {
    const entries = enumerateBlockDefinitions(TEMPLATE, TEMPLATE_NAME);
    expect(entries.map((e) => e.name).sort()).toEqual(
      Object.keys(TEMPLATE.props.blocks).sort()
    );
    for (const entry of entries) {
      expect(entry.template).toBe(TEMPLATE_NAME);
      expect(entry.format).toBe('docx');
      expect(entry.pointer).toBe(`/props/blocks/${entry.name}`);
    }
    // The template invokes every block it defines but the two the others
    // compose from; those still get a case, from their schema alone.
    const withoutExample = entries.filter((e) => !e.example).map((e) => e.name);
    expect(withoutExample.sort()).toEqual(['figure-caption', 'source-line']);
  });

  it('refuses a template whose definitions discovery would not publish', () => {
    const broken = structuredClone(TEMPLATE);
    broken.props.blocks.callout.slots.title = { type: 'date' };
    expect(() => enumerateBlockDefinitions(broken, TEMPLATE_NAME)).toThrow(
      /do not validate/
    );
  });

  it('fills a string to its word budget and a figure to its width', () => {
    const budget: BlockSlot = { type: 'string', maxWords: 8, oneLine: true };
    expect(
      String(boundarySlotValue(budget, 'title', 'max')).split(' ')
    ).toHaveLength(8);
    expect(
      String(boundarySlotValue(budget, 'title', 'min')).split(' ').length
    ).toBeLessThanOrEqual(2);
    expect(widestNumber(12)).toBe('−1,234,567.0');
    expect(widestNumber(12)).toHaveLength(12);
    expect(widestNumber(16)).toHaveLength(16);
    expect(widestNumber(3)).toHaveLength(3);
    const value: BlockSlot = { type: 'string', maxLength: 12 };
    expect(String(boundarySlotValue(value, 'value', 'max'))).toHaveLength(12);
  });

  it('holds min and max cardinality, and counts table cells by the rows', () => {
    const definition = TEMPLATE.props.blocks['data-table'];
    const max = boundaryInvocation('data-table', definition, 'max');
    const min = boundaryInvocation('data-table', definition, 'min');
    const slots = (inv: Record<string, unknown>) =>
      (inv.props as Record<string, unknown>).slots as Record<string, unknown[]>;
    expect(slots(max).labels).toHaveLength(definition.slots.labels.maxItems);
    expect(slots(max).columns).toHaveLength(definition.slots.columns.maxItems);
    for (const column of slots(max).columns as { cells: unknown[] }[])
      expect(column.cells).toHaveLength(24);
    expect(slots(min).labels).toHaveLength(1);
    expect(slots(min).columns).toHaveLength(1);
    expect(slots(min)).not.toHaveProperty('notes');
    expect(slots(min)).not.toHaveProperty('source');
  });

  it('spans themes, fonts, edges and canvases without a list of blocks', () => {
    const cases = generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      themes: ['consulting'],
      canvases: ['A4', 'LETTER'],
    });
    const blocks = Object.keys(TEMPLATE.props.blocks).length;
    expect(cases).toHaveLength((blocks + 1) * 2 * 2 * 2);
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
    const letter = cases.find(
      (c) => c.canvas === 'LETTER' && c.block === 'report'
    )!;
    for (const section of letter.document.children as {
      props?: { page?: { size?: string } };
    }[])
      expect(section.props?.page?.size).toBe('LETTER');
    // A section's own page override survives the canvas: the template's
    // third section states its margins, and the A4 case is A4 there too.
    const a4 = cases.find((c) => c.canvas === 'A4' && c.block === 'report')!;
    const third = (a4.document.children as { props?: { page?: unknown } }[])[2];
    expect(third.props?.page).toMatchObject({
      size: 'A4',
      margins: { left: 1080, right: 1080 },
    });
    const fallback = cases.find((c) => c.font === 'fallback')!;
    expect(
      (fallback.document.props as { themeOverrides?: unknown }).themeOverrides
    ).toMatchObject({
      fonts: { body: { family: 'DejaVu Sans' } },
    });
  });

  it('opens a deck case on the cover, and carries the fallback faces in an inline theme', () => {
    const deck = TEMPLATES.find(
      (t) => t.name === 'consulting-deck-blocks.pptx.json'
    )!.document;
    const entries = enumerateBlockDefinitions(
      deck,
      'consulting-deck-blocks.pptx.json'
    );
    const design = deckBlockCaseDocument(
      deck,
      entries,
      'kpi-row',
      'max',
      'vermilion'
    );
    const slides = design.children as {
      children: { props: { ref: string } }[];
    }[];
    expect(slides.map((s) => s.children[0].props.ref)).toEqual([
      'cover',
      'kpi-row',
    ]);
    expect(design.props).toMatchObject({
      theme: 'vermilion',
      slideWidth: 13.333,
      slideHeight: 7.5,
    });
    expect(
      Object.keys((design.props as { blocks: object }).blocks).sort()
    ).toEqual(['cover', 'kpi-row']);
    const fallback = deckBlockCaseDocument(
      deck,
      entries,
      'kpi-row',
      'max',
      'vermilion',
      {
        font: 'fallback',
        canvas: 'standard43',
        themeObject,
      }
    );
    expect(fallback.props).toMatchObject({
      slideWidth: 10,
      slideHeight: 7.5,
      theme: {
        name: 'vermilion',
        fonts: { heading: 'DejaVu Sans', body: 'DejaVu Sans' },
      },
    });
    // The chart slot takes the worst-case chart, upright in a deck.
    const actionChart = deckBlockCaseDocument(
      deck,
      entries,
      'action-chart',
      'max',
      'consulting'
    );
    const chart = (actionChart.children as any[])[1].children[0].props.slots
      .chart as {
      name: string;
      props: { type: string; data: { labels: string[] }[] };
    };
    expect(chart.name).toBe('chart');
    expect(chart.props.type).toBe('bar');
    expect(chart.props.data[0].labels).toHaveLength(8);
  });

  it('keeps a template theme object, and a deck on its own slide size', () => {
    const plan = TEMPLATES.find((t) => t.name === 'management-plan.pptx.json')!;
    const [c] = generateMatrixCases(INVENTORY, TEMPLATES, {
      templates: [plan.name],
    });
    const props = (plan.document as { props: Record<string, unknown> }).props;
    expect(c.document.props).toMatchObject({
      theme: props.theme,
      slideWidth: props.slideWidth,
      slideHeight: props.slideHeight,
    });
    expect(c.id).toBe('management-plan/grid@max/inline/design/wide169');
  });
});

const MATRIX = generateMatrixCases(INVENTORY, TEMPLATES, {}, { themeObject });

describe('every supported case is warning-clean under its profile', () => {
  it('covers every bundled theme of both formats', () => {
    expect(THEMES.docx).toEqual(
      expect.arrayContaining([
        'consulting',
        'minimal',
        'vermilion',
        'devportal',
      ])
    );
    expect(THEMES.pptx).toEqual(
      expect.arrayContaining([
        'consulting',
        'dark',
        'minimal',
        'vermilion',
        'devportal',
      ])
    );
    const covered = new Set(MATRIX.map((c) => `${c.format}/${c.theme}`));
    for (const [format, names] of Object.entries(THEMES))
      for (const theme of names)
        expect(covered).toContain(`${format}/${theme}`);
  });

  const groups = new Map<string, MatrixCase[]>();
  for (const c of MATRIX) {
    const key = `${c.template} on ${c.theme}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  for (const [group, cases] of groups) {
    it(`${group}: ${cases.length} cases`, async () => {
      const failures: string[] = [];
      for (const c of cases) failures.push(...(await failuresOf(c)));
      expect(failures).toEqual([]);
    }, 120_000);
  }
});

describe('a step past the boundary is a coded issue at the authored slot', () => {
  for (const summary of INVENTORY.templates) {
    const source = TEMPLATES.find((t) => t.name === summary.template)!;
    const entries = INVENTORY.entries.filter(
      (e) => e.template === summary.template
    );
    if (entries.length === 0) continue;
    const definitions = enumerateBlockDefinitions(
      source.document,
      summary.template
    );
    for (const entry of entries) {
      const definition = definitions.find((d) => d.name === entry.name)!;
      const over = overBudgetInvocation(
        entry.name,
        definition.definition,
        0,
        entry.format
      );
      if (!over) continue;
      const theme = entry.themes[0];
      it(`${summary.template} ${entry.name}: ${over.slot} one ${
        over.kind === 'words' ? 'word' : 'item'
      } over`, async () => {
        const document =
          entry.format === 'docx'
            ? blockCaseDocument(definitions, entry.name, 'max', theme)
            : deckBlockCaseDocument(
                source.document,
                definitions,
                entry.name,
                'max',
                theme
              );
        // Replace the block under test with its over-budget twin.
        const walk = (node: unknown): unknown => {
          if (Array.isArray(node)) return node.map(walk);
          if (typeof node !== 'object' || node === null) return node;
          const rec = node as Record<string, unknown>;
          const props = rec.props as Record<string, unknown> | undefined;
          if (rec.name === 'block' && props?.ref === entry.name)
            return over.invocation;
          return Array.isArray(rec.children)
            ? { ...rec, children: walk(rec.children) }
            : rec;
        };
        const broken = {
          ...document,
          children: walk(document.children),
        } as Record<string, unknown>;
        const slotPath = new RegExp(`/props/slots/${over.slot}(?![\\w-])`);
        const issues = validateBlockInvocations(
          broken,
          readBlockDefinitions(broken),
          entry.format
        );
        expect(issues.map((i) => `${i.code} ${i.path}`).join('\n')).toMatch(
          slotPath
        );
        // The engine refuses to prepare it, naming the same pointer: a
        // document past a budget never reaches the rules half-analysed.
        const analysis = await adapters[entry.format].analyzeQuality(
          broken,
          qualityFor(entry.format, entry.profile) as never
        );
        expect(
          (analysis.ruleErrors ?? []).map((e) => e.message).join('\n')
        ).toMatch(slotPath);
      });
    }
  }

  it('a definition that composes from a block the document lacks', async () => {
    const entries = enumerateBlockDefinitions(TEMPLATE, TEMPLATE_NAME);
    const document = blockCaseDocument(entries, 'kpi-row', 'max', 'consulting');
    const blocks = (document.props as { blocks: Record<string, unknown> })
      .blocks;
    expect(blocks).toHaveProperty('source-line');
    delete blocks['source-line'];
    // Named at the definition that composes from it, not in the expanded tree.
    expect(
      validateBlockInvocations(document, readBlockDefinitions(document), 'docx')
        .filter((i) => i.code === 'block_unknown_reference')
        .map((i) => i.path)
    ).toEqual([
      expect.stringMatching(/^\/props\/blocks\/kpi-row\/.*\/props\/ref$/),
    ]);
    const analysis = await adapters.docx.analyzeQuality(document);
    expect(
      (analysis.ruleErrors ?? []).map((e) => e.message).join('\n')
    ).toMatch(/source-line/);
  });
});

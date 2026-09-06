/**
 * Document-local JSON blocks on slides.
 *
 * Everything here is JSON-only: no plugin, no per-block compiler. The engine
 * owns the generic evaluator and three layout operations — frames, row/column
 * distribution and bounded fit — and the definitions in the playground deck
 * are ordinary data any user could have written.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Type } from '@sinclair/typebox';
import { QUALITY_CODES } from '@json-to-office/quality';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { expandPptxBlocks, toAuthoredPointer } from '../document';
import { generateBufferWithWarnings } from '../../core/generator';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { createPresentationGenerator } from '../../plugin/createPresentationGenerator';
import { createComponent } from '../../plugin';
import { preparePptxQualityDocument } from '../../quality/facts';
import { analyzePptxQuality } from '../../quality/preflight';
import { pptxThemes } from '../../themes';
import type { PresentationComponentDefinition } from '../../types';

const template = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../jto/src/client/public/templates/consulting-deck-blocks.pptx.json',
        import.meta.url
      ),
      'utf8'
    )
  ) as PresentationComponentDefinition & { props: Record<string, any> };

const SERIES = [
  { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 15] },
];
const chart = {
  name: 'chart',
  props: { type: 'bar', data: SERIES, valAxisTitle: 'Revenue (€m)' },
};

/** A one-slide deck invoking the template's action-chart with these slots. */
function actionChart(
  slots: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  const doc = template();
  doc.props = { ...doc.props, ...extra };
  doc.children = [
    {
      name: 'slide',
      children: [{ name: 'block', props: { ref: 'action-chart', slots } }],
    },
  ];
  return doc;
}

const CANVASES: Array<[number, number]> = [
  [13.333, 7.5],
  [10, 5.625],
  [10, 7.5],
];

describe('the action-chart playground template', () => {
  it('contains the definition and a working invocation, and validates', () => {
    const doc = template();
    expect(doc.props.blocks['action-chart']).toBeDefined();
    expect(
      doc.children!.some((slide: any) =>
        slide.children?.some(
          (child: any) =>
            child.name === 'block' && child.props.ref === 'action-chart'
        )
      )
    ).toBe(true);
    expect(validatePresentationDocument(doc).errors).toEqual([]);
  });

  it('is not a runtime name: a deck without the definition fails explicitly', () => {
    const doc = actionChart({ title: 'Growth improved', chart });
    delete doc.props.blocks;
    expect(validatePresentationDocument(doc).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_unknown_reference',
          path: '/children/0/children/0/props/ref',
        }),
      ])
    );
  });

  it('expands into a group of primitives with slot provenance', () => {
    const doc = actionChart({
      title: 'Growth improved as delivery became reliable',
      chart,
      takeaway: 'Retention drove the gain.',
      source: 'Source: quarterly operating review.',
    });
    const expanded = expandPptxBlocks(doc, pptxThemes.consulting);
    const group = (expanded.document.children as any[])[0].children[0];
    expect(group.name).toBe('group');
    const names = JSON.stringify(group).match(/"name":"(\w+)"/g);
    expect(names).not.toContain('"name":"block"');
    const base = '/children/0/children/0';
    const titlePointer = Object.keys(expanded.sourceMap).find(
      (key) => expanded.sourceMap[key] === `${base}/props/slots/title`
    );
    expect(titlePointer).toBeDefined();
    expect(toAuthoredPointer(expanded.sourceMap, `${base}/children/0`)).toBe(
      base
    );
    expect(doc.children![0].children![0].name).toBe('block');
  });

  it('collapses the optional source with its rule and leaves no stray decoration', () => {
    const withSource = expandPptxBlocks(
      actionChart({ title: 'T', chart, source: 'Source: x' }),
      pptxThemes.consulting
    );
    const without = expandPptxBlocks(
      actionChart({ title: 'T', chart }),
      pptxThemes.consulting
    );
    const texts = (expanded: typeof withSource) =>
      JSON.stringify(expanded.document).match(/"text":"[^"]*"/g) ?? [];
    const shapes = (expanded: typeof withSource) =>
      (JSON.stringify(expanded.document).match(/"name":"shape"/g) ?? []).length;
    expect(texts(withSource)).toContain('"text":"Source: x"');
    expect(texts(without).join()).not.toContain('Source');
    expect(shapes(withSource)).toBe(shapes(without) + 1);
  });

  it('rejects placement smuggled through the chart slot', () => {
    const doc = actionChart({
      title: 'T',
      chart: { name: 'chart', props: { type: 'bar', data: SERIES, x: 2 } },
    });
    expect(validatePresentationDocument(doc).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_slot_placement',
          path: '/children/0/children/0/props/slots/chart/props/x',
        }),
      ])
    );
    const groupInSlot = actionChart({
      title: 'T',
      chart: {
        name: 'group',
        props: { direction: 'row', gap: 1 },
        children: [chart],
      },
    });
    expect(
      validatePresentationDocument(groupInSlot).errors.map((e) => e.path)
    ).toEqual(
      expect.arrayContaining([
        '/children/0/children/0/props/slots/chart/props/direction',
        '/children/0/children/0/props/slots/chart/props/gap',
      ])
    );
    const withCoords = actionChart({ title: 'T', chart });
    (withCoords.children![0].children![0] as any).props.x = 1;
    expect(validatePresentationDocument(withCoords).valid).toBe(false);
  });

  it('keeps intrinsic content data and lets slot content override styling', () => {
    const doc = actionChart({
      title: 'T',
      chart: {
        name: 'chart',
        props: { type: 'bar', data: SERIES, showLegend: false },
      },
    });
    expect(validatePresentationDocument(doc).valid).toBe(true);
    const expanded = expandPptxBlocks(doc, pptxThemes.consulting);
    const compiled = JSON.stringify(expanded.document);
    expect(compiled).toContain('"showLegend":false');
  });

  describe.each(Object.keys(pptxThemes))('on the %s theme', (theme) => {
    it.each(CANVASES)(
      'renders warning-clean on a %s × %s canvas, in both pipelines and both renderers',
      async (slideWidth, slideHeight) => {
        const doc = actionChart(
          {
            title:
              'Revenue grew 18% as on-time delivery reached 94% of contracted work',
            tracker: 'Performance',
            chart,
            takeaway:
              'Reliability, not price, drove the gain: retained clients expanded scope in every quarter after delivery stabilised, and the pipeline followed.',
            source: 'Source: quarterly operating review, 2026.',
          },
          { theme, slideWidth, slideHeight }
        );
        const core = await generateBufferWithWarnings(structuredClone(doc));
        expect(core.warnings).toEqual([]);
        const plugin = await createPresentationGenerator({}).generateBuffer(
          structuredClone(doc) as never
        );
        expect(plugin.warnings).toEqual([]);
        const officeOpen = await generateBufferWithWarnings({
          ...structuredClone(doc),
          renderer: 'office-open',
        } as never);
        expect(officeOpen.warnings).toEqual([]);
        // Warning-clean includes staying on the canvas: every text box the
        // definition draws lands inside the slide, on the small and 4:3
        // canvases as much as on the wide one.
        expect(
          analyzePptxQuality(doc).diagnostics.filter(
            (finding) => finding.severity !== 'info'
          )
        ).toEqual([]);
        const a = await JSZip.loadAsync(core.buffer);
        const b = await JSZip.loadAsync(plugin.buffer);
        expect(await b.file('ppt/slides/slide1.xml')!.async('string')).toBe(
          await a.file('ppt/slides/slide1.xml')!.async('string')
        );
      }
    );
  });

  it('reports a backend limitation inside a block as a capability diagnostic', () => {
    const doc = actionChart({
      title: 'T',
      chart: {
        name: 'chart',
        props: {
          type: 'bubble',
          data: [{ name: 'a', labels: ['x'], values: [1], sizes: [1] }],
        },
      },
    });
    (doc as any).renderer = 'office-open';
    expect(validatePresentationDocument(doc).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsupported_renderer_feature',
          path: '/children/0/children/0/props/slots/chart/props/type',
        }),
      ])
    );
  });

  it('catches a definition drawn in fixed inches for a wider canvas', () => {
    const doc = actionChart(
      {
        title: 'A title long enough to wrap in a box that hangs off the slide',
        chart,
      },
      { slideWidth: 10, slideHeight: 5.625 }
    );
    doc.props.blocks['action-chart'].body = [
      {
        name: 'text',
        props: { text: { $slot: '/title' }, x: 9.3, y: 0.5, w: 3.5, h: 0.5 },
      },
    ];
    expect(analyzePptxQuality(doc).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: QUALITY_CODES.OFF_CANVAS,
          path: '/children/0/children/0',
        }),
      ])
    );
  });

  it('fails the box, not the reader, when a title cannot fit its declared bounds', () => {
    const doc = actionChart({
      title: 'word '.repeat(60).trim(),
      chart,
    });
    doc.props.blocks['action-chart'].slots.title.maxWords = 200;
    expect(validatePresentationDocument(doc).valid).toBe(true);
    let error: unknown;
    try {
      preparePptxQualityDocument(doc);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'text_fit_overflow',
          path: '/children/0/children/0/props/slots/title',
        }),
      ],
    });
    const analysis = analyzePptxQuality(doc);
    expect(analysis.ruleErrors[0]?.message).toContain('must fit 2 lines');
  });

  it('shrinks a long title through the declared steps before failing', () => {
    const doc = actionChart({
      title:
        'Revenue grew eighteen percent across every region this quarter as on-time delivery reached ninety-four percent of contracted work and churn fell to a record low',
      chart,
    });
    doc.props.blocks['action-chart'].slots.title.maxWords = 200;
    const prepared = preparePptxQualityDocument(doc);
    const title = prepared.facts.find(
      (fact) =>
        fact.kind === 'pptx/text' &&
        (fact as any).text.startsWith('Revenue grew eighteen')
    ) as any;
    const declared = pptxThemes.consulting.typography!.roles!.display!.size!;
    expect(title.fontSizePt).toBeLessThan(declared);
    expect(title.fontSizePt).toBe(24);
  });
});

describe('the consulting profile against the theme', () => {
  const findings = (doc: unknown, profileId?: string) =>
    analyzePptxQuality(doc, {
      ...(profileId && { profile: { id: profileId, formats: ['pptx'] } }),
    }).diagnostics;

  it('requires takeaway and source, and bounds the title, only under the profile', () => {
    const doc = actionChart({
      title:
        'This is an action title so long that it will need three full lines at the display size the house theme declares for a wide canvas, which is too many',
      chart,
    });
    doc.props.blocks['action-chart'].slots.title.maxWords = 200;
    // The title is the second child of the definition's frame; allow it three
    // lines so the fit pass keeps the size and the profile can judge it.
    doc.props.blocks['action-chart'].body[0].children[1].props.fit = {
      maxLines: 3,
    };
    const base = '/children/0/children/0/props/slots';
    expect(
      findings(doc).filter((finding) =>
        [
          QUALITY_CODES.CHROME_MISSING,
          QUALITY_CODES.ACTION_TITLE_LENGTH,
        ].includes(finding.code as never)
      )
    ).toEqual([]);
    const consulting = findings(doc, 'consulting-deck');
    expect(consulting).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: QUALITY_CODES.CHROME_MISSING,
          path: `${base}/takeaway`,
        }),
        expect.objectContaining({
          code: QUALITY_CODES.CHROME_MISSING,
          path: `${base}/source`,
        }),
        expect.objectContaining({
          code: QUALITY_CODES.ACTION_TITLE_LENGTH,
          path: `${base}/title`,
        }),
      ])
    );
  });

  it('adds no required content to a coordinate-authored deck on the theme', () => {
    const doc = {
      name: 'pptx',
      props: { theme: 'consulting', slideWidth: 13.333, slideHeight: 7.5 },
      children: [
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'A label title', style: 'title' } },
            {
              name: 'chart',
              props: { ...chart.props, x: 1, y: 2, w: 8, h: 4 },
            },
          ],
        },
      ],
    };
    for (const profile of [undefined, 'consulting-deck']) {
      expect(
        findings(doc, profile).filter((finding) =>
          [
            QUALITY_CODES.CHROME_MISSING,
            QUALITY_CODES.ACTION_TITLE_LENGTH,
          ].includes(finding.code as never)
        )
      ).toEqual([]);
    }
  });
});

describe('JSON-only adaptation', () => {
  const metricRow = (items: unknown[]) => ({
    name: 'pptx',
    props: {
      theme: 'consulting',
      slideWidth: 13.333,
      slideHeight: 7.5,
      blocks: {
        'metric-row': {
          slots: {
            items: {
              type: 'array',
              required: true,
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  value: { type: 'string', required: true, maxLength: 8 },
                  label: { type: 'string', required: true, maxWords: 4 },
                },
              },
            },
            source: { type: 'string', role: 'source' },
          },
          body: [
            {
              name: 'group',
              props: {
                x: 0.5,
                y: 1.5,
                w: 12.333,
                h: 2.5,
                direction: 'row',
                gap: 0.3,
              },
              children: [
                {
                  $each: '/items',
                  template: {
                    name: 'group',
                    props: { direction: 'column' },
                    children: [
                      {
                        name: 'text',
                        props: { text: { $item: '/value' }, style: 'stat' },
                      },
                      {
                        name: 'text',
                        props: { text: { $item: '/label' }, style: 'label' },
                      },
                    ],
                  },
                },
              ],
            },
            {
              $if: '/source',
              then: [
                {
                  name: 'shape',
                  props: { type: 'line', x: 0.5, y: 6.6, w: 12.333, h: 0 },
                },
                {
                  name: 'text',
                  props: {
                    text: { $slot: '/source' },
                    style: 'source',
                    x: 0.5,
                    y: 6.7,
                    w: 12.333,
                    h: 0.4,
                  },
                },
              ],
            },
          ],
        },
      },
    },
    children: [
      {
        name: 'slide',
        children: [
          { name: 'block', props: { ref: 'metric-row', slots: { items } } },
        ],
      },
    ],
  });
  const tiles = (doc: unknown) => {
    const prepared = preparePptxQualityDocument(doc as never);
    return prepared.model.processed.slides[0].components[0].children![0].children!.map(
      (tile: any) => tile.children[0].props
    );
  };

  it('redistributes two and four items into equal cells', () => {
    const two = tiles(
      metricRow([
        { value: '+18%', label: 'Growth' },
        { value: '94%', label: 'Retention' },
      ])
    );
    expect(two.map((props: any) => props.x)).toEqual([0.5, 0.5 + 6.0165 + 0.3]);
    expect(two[0].w).toBeCloseTo(6.0165, 3);
    const four = tiles(
      metricRow([
        { value: '1', label: 'a' },
        { value: '2', label: 'b' },
        { value: '3', label: 'c' },
        { value: '4', label: 'd' },
      ])
    );
    expect(four).toHaveLength(4);
    expect(four[3].x + four[3].w).toBeCloseTo(0.5 + 12.333, 3);
    expect(four[0].w).toBeCloseTo((12.333 - 0.9) / 4, 3);
  });

  it('rejects a count outside the declared bounds at the authored slot', () => {
    expect(
      validatePresentationDocument(metricRow([{ value: '1', label: 'only' }]))
        .errors
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_slot_budget',
          path: '/children/0/children/0/props/slots/items',
        }),
      ])
    );
  });

  it('exposes the compiled form and source map for inspection', () => {
    const prepared = preparePptxQualityDocument(
      metricRow([
        { value: '+18%', label: 'Growth' },
        { value: '94%', label: 'Retention' },
      ]) as never
    );
    const blocks = prepared.metadata?.blocks as any;
    expect(blocks.blocks).toEqual(['/children/0/children/0']);
    expect(
      toAuthoredPointer(
        blocks.sourceMap,
        '/children/0/children/0/children/0/children/1/children/0/props/text'
      )
    ).toBe('/children/0/children/0/props/slots/items/1/value');
  });
});

describe('user-defined blocks and plugin composition', () => {
  it('a user definition has the same validation and provenance as a template one', () => {
    const doc = actionChart({ title: 'T', chart });
    doc.props.blocks['my-chart'] = {
      ...structuredClone(doc.props.blocks['action-chart']),
      body: [
        {
          name: 'text',
          props: { text: { $slot: '/title' }, x: 1, y: 1, w: 8, h: 1 },
        },
      ],
    };
    (doc.children![0].children![0] as any).props.ref = 'my-chart';
    expect(validatePresentationDocument(doc).valid).toBe(true);
    const expanded = expandPptxBlocks(doc, pptxThemes.consulting);
    expect(
      (expanded.document.children as any[])[0].children[0].children[0].props
        .text
    ).toBe('T');
  });

  it('supports plugin → block and block → plugin → block with authored paths', async () => {
    const ribbon = createComponent({
      name: 'ribbon',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({ label: Type.String() }),
          render: async ({ props }) => [
            {
              name: 'block',
              props: { ref: 'label', slots: { text: props.label } },
            },
          ],
        },
      },
    });
    const doc = {
      name: 'pptx',
      props: {
        theme: 'consulting',
        slideWidth: 13.333,
        slideHeight: 7.5,
        blocks: {
          label: {
            slots: { text: { type: 'string', required: true, maxWords: 3 } },
            body: [
              {
                name: 'text',
                props: { text: { $slot: '/text' }, x: 1, y: 1, w: 4, h: 0.5 },
              },
            ],
          },
          outer: {
            slots: {},
            body: [{ name: 'ribbon', props: { label: 'From plugin' } }],
          },
        },
      },
      children: [
        {
          name: 'slide',
          children: [{ name: 'block', props: { ref: 'outer' } }],
        },
      ],
    };
    const generator = createPresentationGenerator({}).addComponent(ribbon);
    const { warnings, buffer } = await generator.generateBuffer(doc as never);
    expect(warnings).toEqual([]);
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain(
      'From plugin'
    );

    const overBudget = structuredClone(doc);
    overBudget.props.blocks.outer.body[0].props.label = 'one two three four';
    // Emitted output is validated where the plugin was authored: the budget
    // overrun names the emitted block's slot, under the outer invocation.
    await expect(
      generator.generateBuffer(overBudget as never)
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          code: 'block_slot_budget',
          path: '/children/0/children/0/props/slots/text',
        }),
      ],
    });
  });

  it('bounds recursion between a block and itself', () => {
    const doc = {
      name: 'pptx',
      props: {
        slideWidth: 13.333,
        slideHeight: 7.5,
        blocks: {
          loop: {
            slots: {},
            body: [{ name: 'block', props: { ref: 'loop' } }],
          },
        },
      },
      children: [
        {
          name: 'slide',
          children: [{ name: 'block', props: { ref: 'loop' } }],
        },
      ],
    };
    expect(() => expandPptxBlocks(doc, pptxThemes.default)).toThrow(
      /block_expansion_limit|depth/
    );
  });

  it('applies a definition background only where the slide states none', async () => {
    const doc = {
      name: 'pptx',
      props: {
        slideWidth: 10,
        slideHeight: 7.5,
        blocks: {
          dark: {
            slots: {},
            slide: { background: { color: 'primary' } },
            body: [],
          },
        },
      },
      children: [
        {
          name: 'slide',
          children: [{ name: 'block', props: { ref: 'dark' } }],
        },
        {
          name: 'slide',
          props: { background: { color: 'accent' } },
          children: [{ name: 'block', props: { ref: 'dark' } }],
        },
      ],
    };
    const { ir } = await compileDocumentToIr(doc as never);
    expect(ir.slides[0].background).toEqual({
      kind: 'solid',
      color: { hex: '4472C4' },
    });
    expect(ir.slides[1].background).toEqual({
      kind: 'solid',
      color: { hex: '70AD47' },
    });
  });
});

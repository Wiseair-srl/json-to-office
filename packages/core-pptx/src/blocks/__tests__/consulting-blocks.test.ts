/**
 * The four consulting deck blocks that join `action-chart` (#341): `cover`,
 * `kpi-row`, `two-column` and `statement`, as the playground deck defines
 * them. What matters is observable from outside: the deck invokes every
 * definition and validates; each block at its widest cardinality renders
 * warning-clean in both pipelines and both renderers on every bundled theme
 * and canvas, and stays on the slide; the KPI row redistributes two and four
 * figures into equal cells; slot bounds and placement smuggled through a
 * component slot are coded errors at the authored slot.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { expandPptxBlocks } from '../document';
import { generateBufferWithWarnings } from '../../core/generator';
import { createPresentationGenerator } from '../../plugin/createPresentationGenerator';
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

const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';
const BLOCKS = ['cover', 'kpi-row', 'two-column', 'statement'] as const;
const CANVASES: Array<[number, number]> = [
  [13.333, 7.5],
  [10, 5.625],
  [10, 7.5],
];
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
/** An action title at the two lines the definitions fit, not at the budget. */
const ACTION_TITLE =
  'Revenue grew 18% as on-time delivery reached 94% of contracted work this year';

/** Every block at its widest cardinality, one slide each. */
const WIDEST: Record<(typeof BLOCKS)[number], Record<string, unknown>> = {
  cover: {
    title: words(16),
    subtitle: words(20),
    client: words(8),
    date: words(6),
    confidentiality: words(6),
    logo: { name: 'image', props: { path: PNG_4X2 } },
  },
  'kpi-row': {
    title: ACTION_TITLE,
    tracker: words(4),
    items: [1, 2, 3, 4].map((i) => ({
      value: '1234567',
      unit: 'units',
      label: words(6),
      delta: `+${i}23.4 pts`,
    })),
    source: words(24),
  },
  'two-column': {
    title: ACTION_TITLE,
    tracker: words(4),
    bullets: Array.from({ length: 5 }, () => words(10)),
    content: {
      name: 'table',
      props: {
        rows: [
          ['Stage', 'Before', 'After'],
          ['Intake', '6 days', '2 days'],
          ['Delivery', '81%', '94%'],
        ],
      },
    },
    source: words(24),
  },
  statement: { tracker: words(4), assertion: words(14), support: words(30) },
};

function deck(
  slides: Array<[string, Record<string, unknown>]>,
  extra: Record<string, unknown> = {}
) {
  const doc = template();
  doc.props = { ...doc.props, ...extra };
  doc.children = slides.map(([ref, slots]) => ({
    name: 'slide',
    children: [{ name: 'block', props: { ref, slots } }],
  }));
  return doc;
}

describe('the consulting deck template', () => {
  it('defines the five blocks and invokes each of them, and validates', () => {
    const doc = template();
    expect(Object.keys(doc.props.blocks)).toEqual([
      'cover',
      'action-chart',
      'kpi-row',
      'two-column',
      'statement',
    ]);
    const invoked = doc.children!.map(
      (slide: any) => slide.children[0].props.ref
    );
    for (const name of Object.keys(doc.props.blocks))
      expect(invoked).toContain(name);
    expect(validatePresentationDocument(doc).errors).toEqual([]);
  });
});

describe.each(BLOCKS)('the %s block', (ref) => {
  it('is a document-local definition with bounded slots', () => {
    const definition = template().props.blocks[ref];
    expect(definition.description).toMatch(/Copy and adapt/);
    for (const slot of Object.values(definition.slots) as any[])
      if (slot.type === 'string')
        expect(slot.maxWords ?? slot.maxLength, ref).toBeDefined();
  });

  describe.each(Object.keys(pptxThemes))('on the %s theme', (theme) => {
    it.each(CANVASES)(
      'renders its widest fill warning-clean on a %s × %s canvas, in both pipelines and both renderers',
      async (slideWidth, slideHeight) => {
        const doc = deck([[ref, WIDEST[ref]]], {
          theme,
          slideWidth,
          slideHeight,
        });
        expect(validatePresentationDocument(doc).errors).toEqual([]);
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
        expect(
          analyzePptxQuality(doc)
            .diagnostics.filter((finding) => finding.severity !== 'info')
            .map(
              (finding) => `${finding.code} ${finding.path} ${finding.message}`
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
});

describe('the kpi-row block', () => {
  const cells = (items: unknown[]) => {
    const doc = deck([
      ['kpi-row', { title: 'T', items, source: 'Source: s.' }],
    ]);
    const expanded = expandPptxBlocks(doc as never, pptxThemes.consulting)
      .document as any;
    const frame = expanded.children[0].children[0].children[0];
    const row = frame.children.find(
      (child: any) => child.name === 'group' && child.props.direction === 'row'
    );
    return row.children as any[];
  };

  it('distributes two and four figures into equal cells that fill the row', () => {
    expect(
      cells([
        { value: '8.8', label: 'a' },
        { value: '94', label: 'b' },
      ])
    ).toHaveLength(2);
    expect(
      cells([
        { value: '1', label: 'a' },
        { value: '2', label: 'b' },
        { value: '3', label: 'c' },
        { value: '4', label: 'd' },
      ])
    ).toHaveLength(4);
  });

  it('draws the unit beside the value in the muted colour and drops the delta line when there is none', () => {
    const [withUnit, bare] = cells([
      { value: '8.8', unit: '€m', label: 'a', delta: '+1' },
      { value: '94', label: 'b' },
    ]);
    const stat = withUnit.children[0].props;
    expect(stat.runs.map((run: any) => run.text)).toEqual(['8.8', ' €m']);
    expect(stat.runs[1].color).toBe('text2');
    expect(withUnit.children).toHaveLength(3);
    expect(bare.children[0].props.runs.map((run: any) => run.text)).toEqual([
      '94',
    ]);
    expect(bare.children).toHaveLength(2);
  });

  it('rejects one figure or five at the authored slot', () => {
    for (const items of [
      [{ value: '1', label: 'only' }],
      Array.from({ length: 5 }, (_, i) => ({ value: `${i}`, label: 'x' })),
    ])
      expect(
        validatePresentationDocument(deck([['kpi-row', { title: 'T', items }]]))
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
});

describe('the two-column block', () => {
  const content = {
    name: 'chart',
    props: {
      type: 'bar',
      data: [{ name: 'A', labels: ['x', 'y'], values: [1, 2] }],
    },
  };

  it('takes prose on the left, or bullets as one bulleted paragraph list', () => {
    const left = (slots: Record<string, unknown>) => {
      const expanded = expandPptxBlocks(
        deck([['two-column', { title: 'T', content, ...slots }]]) as never,
        pptxThemes.consulting
      ).document as any;
      const frame = expanded.children[0].children[0].children[0];
      const row = frame.children.find(
        (child: any) => child.props?.direction === 'row'
      );
      return row.children[0].children as any[];
    };
    const prose = left({ text: 'One paragraph.' });
    expect(prose).toHaveLength(1);
    expect(prose[0].props.text).toBe('One paragraph.');
    expect(prose[0].props.bullet).toBeUndefined();
    const bullets = left({ bullets: ['First', 'Second', 'Third'] });
    expect(bullets).toHaveLength(1);
    expect(bullets[0].props.text).toBe('First\nSecond\nThird');
    expect(bullets[0].props.bullet).toBe(true);
  });

  it('draws one left column when both text and bullets are given: the prose wins', () => {
    const expanded = expandPptxBlocks(
      deck([
        ['two-column', { title: 'T', content, text: 'Prose.', bullets: ['A'] }],
      ]) as never,
      pptxThemes.consulting
    ).document as any;
    const frame = expanded.children[0].children[0].children[0];
    const row = frame.children.find(
      (child: any) => child.props?.direction === 'row'
    );
    expect(row.children[0].children).toHaveLength(1);
    expect(row.children[0].children[0].props.text).toBe('Prose.');
    // Neither given: nothing is drawn on the left, no empty box.
    const empty = expandPptxBlocks(
      deck([['two-column', { title: 'T', content }]]) as never,
      pptxThemes.consulting
    ).document as any;
    const emptyRow = empty.children[0].children[0].children[0].children.find(
      (child: any) => child.props?.direction === 'row'
    );
    expect(emptyRow.children[0].children).toEqual([]);
  });

  it('rejects placement smuggled through the content slot', () => {
    const doc = deck([
      [
        'two-column',
        {
          title: 'T',
          text: 'x',
          content: { ...content, props: { ...content.props, x: 2 } },
        },
      ],
    ]);
    expect(validatePresentationDocument(doc).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_slot_placement',
          path: '/children/0/children/0/props/slots/content/props/x',
        }),
      ])
    );
  });
});

describe('the cover and statement blocks', () => {
  it('require their one sentence and bound it', () => {
    const missing = validatePresentationDocument(
      deck([
        ['cover', { subtitle: 'S' }],
        ['statement', { support: 'S' }],
      ])
    ).errors;
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_required_slot',
          path: '/children/0/children/0/props/slots/title',
        }),
        expect.objectContaining({
          code: 'block_required_slot',
          path: '/children/1/children/0/props/slots/assertion',
        }),
      ])
    );
    const long = validatePresentationDocument(
      deck([
        ['cover', { title: words(17) }],
        ['statement', { assertion: words(15) }],
      ])
    ).errors;
    expect(long.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        '/children/0/children/0/props/slots/title',
        '/children/1/children/0/props/slots/assertion',
      ])
    );
  });

  it('draws the eyebrow only with a client, and the logo only when given', () => {
    const cover = (slots: Record<string, unknown>) => {
      const expanded = expandPptxBlocks(
        deck([['cover', { title: 'T', ...slots }]]) as never,
        pptxThemes.consulting
      ).document as any;
      return expanded.children[0].children[0].children[0].children as any[];
    };
    // consulting declares a motif, so the first shape is the top-edge mark
    // and the second is the cover rule (#361).
    const bare = cover({});
    expect(bare.map((child: any) => child.name)).toEqual([
      'shape',
      'shape',
      'text',
    ]);
    const full = cover({
      client: 'Acme',
      date: 'May 2026',
      logo: { name: 'image', props: { path: PNG_4X2 } },
    });
    expect(full.map((child: any) => child.name)).toEqual([
      'image',
      'shape',
      'shape',
      'text',
      'text',
    ]);
    expect(full[3].props.text).toBe('Acme · May 2026');
  });
});

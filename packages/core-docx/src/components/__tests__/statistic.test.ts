/**
 * The shapes a `statistic` has to accept.
 *
 * A statistic is a figure and its caption, as two styled paragraphs — so what
 * is worth saying here is that every shape produces exactly those two, that the
 * styles are the ones the theme defines them under, and that a blank line stays
 * a blank paragraph rather than becoming a run with nothing in it.
 */

import { describe, it, expect } from 'vitest';
import type { GenerationWarning } from '@json-to-office/shared';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrBlock } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

async function statisticBlocks(
  props: Record<string, unknown>
): Promise<DocxIrBlock[]> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: {},
    children: [{ name: 'statistic', props }],
  } as unknown as ReportComponentDefinition);
  return compiled.ir.sections[0].children;
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ['a number and a description', { number: '42', description: 'Total Items' }],
  ['a bare numeral', { number: '100', description: 'Percentage Complete' }],
  [
    'formatting in the figure',
    { number: '$1,234.56', description: 'Total Revenue' },
  ],
  [
    'a very large number',
    { number: '999,999,999,999', description: 'Large Number' },
  ],
  ['a decimal', { number: '3.14159', description: 'Pi Value' }],
  ['a percentage', { number: '87.5%', description: 'Success Rate' }],
  ['a short description', { number: '7', description: 'Days' }],
  ['an empty description', { number: '123', description: '' }],
  [
    'special characters',
    { number: '42', description: 'Special chars: & < > " \' © ® ™' },
  ],
  [
    'a multiline description',
    { number: '500', description: 'Line one\nLine two' },
  ],
  [
    'spacing on both sides',
    {
      number: '25',
      description: 'With Spacing',
      spacing: { before: 240, after: 480 },
    },
  ],
  [
    'spacing before only',
    {
      number: '33',
      description: 'Before Spacing Only',
      spacing: { before: 360 },
    },
  ],
  [
    'spacing after only',
    {
      number: '67',
      description: 'After Spacing Only',
      spacing: { after: 300 },
    },
  ],
];

describe('components/statistic', () => {
  it.each(CASES)('compiles a statistic with %s', async (_name, props) => {
    const blocks = await statisticBlocks(props);

    expect(blocks).toHaveLength(2);
    expect(
      blocks.map((block) => block.kind === 'paragraph' && block.styleId)
    ).toEqual(['StatisticNumber', 'StatisticDescription']);
  });

  it.each(['left', 'center', 'right'] as const)(
    'compiles a statistic aligned %s',
    async (alignment) => {
      const blocks = await statisticBlocks({
        number: '1',
        description: 'Aligned',
        alignment,
      });

      for (const block of blocks) {
        expect(block.kind === 'paragraph' && block.formatting?.alignment).toBe(
          alignment
        );
      }
    }
  );

  it('takes the alignment its theme states for statistics', async () => {
    // The default theme aligns statistics left; `center` is only the fallback
    // for a theme that says nothing, which is why an unstated alignment here
    // is not centred.
    const blocks = await statisticBlocks({
      number: '1',
      description: 'Themed',
    });

    for (const block of blocks) {
      expect(block.kind === 'paragraph' && block.formatting?.alignment).toBe(
        'left'
      );
    }
  });

  it('leaves an empty line without a run at all', async () => {
    const [, description] = await statisticBlocks({
      number: '0',
      description: '',
    });

    expect(description.kind === 'paragraph' && description.children).toEqual(
      []
    );
  });

  it('reads its spacing as twips, as the writer always has', async () => {
    const [figure] = await statisticBlocks({
      number: '25',
      description: 'With Spacing',
      spacing: { before: 240, after: 480 },
    });

    expect(figure.kind === 'paragraph' && figure.formatting?.spacing).toEqual({
      beforeTwips: 240,
      afterTwips: 480,
    });
  });

  it('compiles nothing for a statistic with no props at all', async () => {
    const blocks = await statisticBlocks({});

    // Still two paragraphs: an empty statistic is a styled blank, not nothing.
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.kind === 'paragraph' && block.children).toEqual([]);
    }
  });
});

/**
 * The props that used to validate and then vanish.
 *
 * `unit`, `size`, `trend` and `trendValue` were all declared, all accepted by
 * the schema and all read by nothing — a `%` that passed validation and never
 * reached the page. What is worth pinning is that each one now reaches a run,
 * and that the two styles the paragraphs name actually exist in the document
 * they are emitted into.
 */
describe('components/statistic — the figure line', () => {
  async function numberRuns(
    props: Record<string, unknown>
  ): Promise<Array<{ text: string; sizeHalfPoints?: number }>> {
    const [figure] = await statisticBlocks(props);
    if (figure.kind !== 'paragraph') throw new Error('not a paragraph');
    return figure.children.flatMap((run) =>
      run.kind === 'text'
        ? [
            {
              text: run.text,
              ...(run.formatting?.sizeHalfPoints !== undefined && {
                sizeHalfPoints: run.formatting.sizeHalfPoints,
              }),
            },
          ]
        : []
    );
  }

  it('renders `unit` as a suffix run on the figure', async () => {
    const runs = await numberRuns({
      number: '99',
      unit: '%',
      description: 'Uptime',
    });

    expect(runs.map((run) => run.text)).toEqual(['99', '%']);
  });

  it('sets the unit smaller than the figure it follows', async () => {
    const [figure, unit] = await numberRuns({
      number: '99',
      unit: '%',
      description: 'Uptime',
    });

    // The figure takes its size from the style at `medium`, so it states none.
    expect(figure.sizeHalfPoints).toBeUndefined();
    expect(unit.sizeHalfPoints).toBe(28);
  });

  it('leaves the figure run bare at the size the style already carries', async () => {
    const [figure] = await numberRuns({
      number: '42',
      size: 'medium',
      description: 'Medium',
    });

    expect(figure.sizeHalfPoints).toBeUndefined();
  });

  it.each([
    ['small', 40],
    ['large', 80],
  ] as const)('resizes the figure for size %s', async (size, halfPoints) => {
    const [figure] = await numberRuns({
      number: '42',
      size,
      description: 'Sized',
    });

    expect(figure.sizeHalfPoints).toBe(halfPoints);
  });

  it.each([
    ['up', '▲'],
    ['down', '▼'],
    ['neutral', '–'],
  ] as const)('marks trend %s with its own glyph', async (trend, glyph) => {
    const runs = await numberRuns({
      number: '42',
      trend,
      description: 'Trending',
    });

    expect(runs.map((run) => run.text)).toEqual(['42', ` ${glyph}`]);
  });

  it('sets the trend value beside its glyph', async () => {
    const runs = await numberRuns({
      number: '42',
      trend: 'up',
      trendValue: '+3.1pp',
      description: 'Trending',
    });

    expect(runs.map((run) => run.text)).toEqual(['42', ' ▲ +3.1pp']);
  });

  it('renders a trend value with no direction stated', async () => {
    const runs = await numberRuns({
      number: '42',
      trendValue: '+3.1pp',
      description: 'Trending',
    });

    expect(runs.map((run) => run.text)).toEqual(['42', ' +3.1pp']);
  });

  it('orders unit before trend on one line', async () => {
    const runs = await numberRuns({
      number: '99',
      unit: '%',
      trend: 'up',
      trendValue: '2',
      description: 'Everything',
    });

    expect(runs.map((run) => run.text)).toEqual(['99', '%', ' ▲ 2']);
  });

  it('says so rather than dropping `format` in silence', async () => {
    const warnings: GenerationWarning[] = [];
    await compileDocumentToIr(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'statistic',
            props: {
              number: '42',
              format: '#,##0.00',
              description: 'Formatted',
            },
          },
        ],
      } as unknown as ReportComponentDefinition,
      {},
      warnings
    );

    expect(warnings.map((warning) => warning.context?.code)).toContain(
      'W_STATISTIC_FORMAT_IGNORED'
    );
  });
});

describe('components/statistic — the styles it names', () => {
  async function styleIds(children: unknown[]): Promise<string[]> {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: {},
      children,
    } as unknown as ReportComponentDefinition);
    return compiled.ir.styles.paragraph.map((style) => style.id);
  }

  it('defines both styles the paragraphs reference', async () => {
    const ids = await styleIds([
      { name: 'statistic', props: { number: '1', description: 'One' } },
    ]);

    // Without these two the `w:pStyle` on each paragraph resolves to Normal in
    // silence, which is how the component came to look like body text.
    expect(ids).toContain('StatisticNumber');
    expect(ids).toContain('StatisticDescription');
  });

  it('defines neither in a document with no statistic', async () => {
    const ids = await styleIds([
      { name: 'paragraph', props: { text: 'No statistics here.' } },
    ]);

    expect(ids).not.toContain('StatisticNumber');
    expect(ids).not.toContain('StatisticDescription');
  });

  it('sets the figure larger and bolder than its caption', async () => {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: {},
      children: [
        { name: 'statistic', props: { number: '1', description: 'One' } },
      ],
    } as unknown as ReportComponentDefinition);
    const byId = new Map(
      compiled.ir.styles.paragraph.map((style) => [style.id, style])
    );

    const figure = byId.get('StatisticNumber');
    const caption = byId.get('StatisticDescription');
    expect(figure?.run?.bold).toBe(true);
    expect(figure?.run?.sizeHalfPoints).toBe(56);
    expect(caption?.run?.sizeHalfPoints).toBe(20);
    // A page break between a number and its label leaves a number with no label.
    expect(figure?.paragraph?.keepNext).toBe(true);
  });
});

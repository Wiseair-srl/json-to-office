/**
 * The shapes a `statistic` has to accept.
 *
 * A statistic is a figure and its caption, as two styled paragraphs — so what
 * is worth saying here is that every shape produces exactly those two, that the
 * styles are the ones the theme defines them under, and that a blank line stays
 * a blank paragraph rather than becoming a run with nothing in it.
 */

import { describe, it, expect } from 'vitest';
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

/**
 * What a markdown outline is, to a scaffold.
 *
 * The parser answers one question — what did the author actually write under
 * each `##` — and the numeric-fact reader answers a second: which of those
 * bullets is a measurement that belongs in a KPI row rather than a sentence.
 * Both are pure, so the rules can be pinned here and the slide sequence they
 * produce pinned against the real blueprint in `scaffold.test.ts`. The plan's
 * fallbacks are pinned here too, on variants written for the purpose: the
 * shapes they guard against are ones the shipped blueprint has no slide for,
 * so a test against the real one would prove the guard by never reaching it.
 */

import { describe, it, expect } from 'vitest';

import type { JsonBlockDefinition } from '@json-to-office/shared';

import { parseOutline } from '../scaffold/outline.js';
import { numericFact, planDeck } from '../scaffold/deck-plan.js';

describe('reading a section', () => {
  it('keeps prose, bullets and tables apart, and keeps every line in order', () => {
    const outline = parseOutline(
      [
        '# Q3 review',
        '## Growth held',
        'Revenue grew for the third quarter running.',
        '',
        '- New logos carried it',
        '- Expansion did not',
        '',
        '| Segment | Revenue | Growth |',
        '| --- | ---: | ---: |',
        '| Enterprise | 4.2 | 12% |',
        '| Mid-market | 1.8 | 3% |',
      ].join('\n')
    );
    expect(outline.title).toBe('Q3 review');
    expect(outline.sections).toHaveLength(1);
    const [section] = outline.sections;
    expect(section.paragraphs).toEqual([
      'Revenue grew for the third quarter running.',
    ]);
    expect(section.bullets).toEqual([
      'New logos carried it',
      'Expansion did not',
    ]);
    expect(section.lines).toEqual([
      'Revenue grew for the third quarter running.',
      'New logos carried it',
      'Expansion did not',
    ]);
    expect(section.tables).toEqual([
      {
        headers: ['Segment', 'Revenue', 'Growth'],
        rows: [
          ['Enterprise', '4.2', '12%'],
          ['Mid-market', '1.8', '3%'],
        ],
      },
    ]);
  });

  it('reads every bullet marker, and folds a wrapped item back into one bullet', () => {
    const [section] = parseOutline(
      [
        '## Findings',
        '* Star bullets count',
        '+ So do plus bullets',
        '1. And numbered ones',
        '2) Even with a paren',
        '- A long item that',
        '  wraps onto a second line',
      ].join('\n')
    ).sections;
    expect(section.bullets).toEqual([
      'Star bullets count',
      'So do plus bullets',
      'And numbered ones',
      'Even with a paren',
      'A long item that wraps onto a second line',
    ]);
    expect(section.paragraphs).toEqual([]);
  });

  it('reads a second table in the same section, and a table with no delimiter row', () => {
    const [section] = parseOutline(
      [
        '## Two of them',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '| C | D |',
        '| 3 | 4 |',
      ].join('\n')
    ).sections;
    expect(section.tables).toEqual([
      { headers: ['A', 'B'], rows: [['1', '2']] },
      { headers: ['C', 'D'], rows: [['3', '4']] },
    ]);
  });

  it('still reports what it has no place for', () => {
    const outline = parseOutline(
      ['# Title', '- A stray bullet', '## One', 'Body.'].join('\n')
    );
    expect(outline.orphans).toEqual(['A stray bullet']);
    expect(outline.sections[0].lines).toEqual(['Body.']);
  });
});

describe('what counts as a numeric fact', () => {
  it.each([
    ['Revenue: 4.2', { label: 'Revenue', value: '4.2' }],
    ['Churn: 3.1%', { label: 'Churn', value: '3.1', unit: '%' }],
    ['ARR: €4.2M', { label: 'ARR', value: '€4.2', unit: 'M' }],
    [
      'Margin: 41 pts (+3.2)',
      { label: 'Margin', value: '41', unit: 'pts', delta: '+3.2' },
    ],
    ['NPS: 62 (−4)', { label: 'NPS', value: '62', delta: '−4' }],
  ])('reads %s', (bullet, expected) => {
    expect(numericFact(bullet)).toMatchObject(expected);
  });

  it.each([
    'A claim with no number at all',
    'Growth was strong: it kept up all quarter',
    'A sentence: 4.2 is buried in a longer clause here',
    'No colon 4.2%',
  ])('refuses %s', (bullet) => {
    expect(numericFact(bullet)).toBeUndefined();
  });
});

describe('what the plan refuses to do', () => {
  /** A slide carrying one block invocation, as a variant's children hold it. */
  const slide = (ref: string, slots: Record<string, unknown>) => ({
    name: 'slide',
    children: [{ name: 'block', props: { ref, slots } }],
  });
  const cover = slide('cover', { title: '{{Title}}' });
  const definitions = {
    listed: { slots: { bullets: { type: 'array', maxItems: 5 } } },
    headless: { slots: { bullets: { type: 'array', maxItems: 5 } } },
  } as unknown as Record<string, JsonBlockDefinition>;

  const plan = (children: unknown[], markdown: string) =>
    planDeck({ children, outline: parseOutline(markdown), definitions });

  it('leaves a section alone when the slide that holds its shape has nowhere to put the heading', () => {
    // The donor takes bullets but has no title and no assertion, so filling it
    // would drop the heading and hand the next section this slide.
    const children = [
      cover,
      slide('headless', { bullets: ['{{One}}', '{{Two}}'] }),
    ];
    const result = plan(children, '## What changed\n- First\n- Second');
    expect(result.handled.size).toBe(0);
    expect(result.children).toEqual(children);
    const [reported] = result.diagnostics;
    expect(reported.code).toBe('W_OUTLINE_UNMAPPED');
    expect(reported.message).toContain('no title to put the heading on');
    expect(result.diagnostics.map((d) => d.code)).not.toContain(
      'W_OUTLINE_TRANSFORMED'
    );
  });

  it('never writes a table into a component that is not one, and says it was not written', () => {
    // The only donor that takes the bullets carries a chart, so the table has
    // nowhere to go: the chart keeps its own props and the table is reported.
    const children = [
      cover,
      slide('listed', {
        title: '{{Action title}}',
        bullets: ['{{One}}', '{{Two}}'],
        content: { name: 'chart', props: { type: 'bar', data: [] } },
      }),
    ];
    const result = plan(
      children,
      [
        '## What changed',
        '- Delivery stabilised',
        '- Escalations fell',
        '',
        '| Segment | Revenue |',
        '| --- | --- |',
        '| Enterprise | 4.2 |',
      ].join('\n')
    );
    expect(result.handled.has(0)).toBe(true);
    const placed = result.children[1] as {
      children: [{ props: { slots: Record<string, any> } }];
    };
    const slots = placed.children[0].props.slots;
    expect(slots.bullets).toEqual(['Delivery stabilised', 'Escalations fell']);
    expect(slots.content).toEqual({
      name: 'chart',
      props: { type: 'bar', data: [] },
    });
    expect(slots.content.props.rows).toBeUndefined();
    expect(
      result.diagnostics.find((d) => d.code === 'W_OUTLINE_UNMAPPED')?.context
    ).toMatchObject({ tables: 1 });
  });
});

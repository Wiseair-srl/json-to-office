/**
 * What a markdown outline is, to a scaffold.
 *
 * The parser answers one question — what did the author actually write under
 * each `##` — and the numeric-fact reader answers a second: which of those
 * bullets is a measurement that belongs in a KPI row rather than a sentence.
 * Both are pure, so the rules can be pinned here and the slide sequence they
 * produce pinned against the real blueprint in `scaffold.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { parseOutline } from '../scaffold/outline.js';
import { numericFact } from '../scaffold/deck-plan.js';

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

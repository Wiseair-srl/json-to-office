/**
 * Matching an emitted chart part back to the node it came from.
 *
 * Position cannot do that job — the emitter's walk and the backend's part
 * numbering need not agree — so the pairing is by content. That makes the two
 * signatures a contract: one is read out of escaped XML, the other built from
 * raw IR strings, and any disagreement between them silently strands a chart
 * without its workbook.
 */

import { describe, expect, it } from 'vitest';
import {
  chartInputSignature,
  chartPartSignature,
  matchChartParts,
  type ChartPartInput,
} from '../chart-parts';

const series = (
  name: string,
  labels: string[],
  values: number[]
): ChartPartInput => ({
  chartType: 'bar',
  colors: [],
  series: [{ name, labels, values }],
});

/** One `<c:ser>` as the backend writes it, escaping included. */
const part = (name: string, labels: string[], values: number[]): string => {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const cell = (value: string) => `<c:pt><c:v>${escape(value)}</c:v></c:pt>`;
  return (
    `<c:ser><c:tx><c:strRef>${cell(name)}</c:strRef></c:tx>` +
    `<c:cat><c:strRef>${labels.map(cell).join('')}</c:strRef></c:cat>` +
    `<c:val><c:numRef>${values.map((v) => cell(String(v))).join('')}</c:numRef></c:val>` +
    `</c:ser>`
  );
};

describe('chart part signatures', () => {
  it('agrees on text the backend had to escape', () => {
    const name = `A & B < C > D " E ' F`;
    const labels = ['x & y', '<z>'];
    expect(chartPartSignature(part(name, labels, [1, 2]))).toBe(
      chartInputSignature(series(name, labels, [1, 2]))
    );
  });

  it('agrees on plain text', () => {
    expect(chartPartSignature(part('Revenue', ['Q1'], [1]))).toBe(
      chartInputSignature(series('Revenue', ['Q1'], [1]))
    );
  });

  it('separates fields, so neighbouring values cannot be confused', () => {
    // Joining on '' would make ['ab','c'] and ['a','bc'] one chart, and the
    // wrong workbook would follow.
    expect(chartInputSignature(series('ab', ['c'], [1]))).not.toBe(
      chartInputSignature(series('a', ['bc'], [1]))
    );
  });

  it('pairs each part with its own chart, whatever the order', () => {
    const first = series('First', ['a'], [1]);
    const second = series('Second', ['b'], [2]);
    // Parts numbered opposite to the order the charts were collected in.
    const matched = matchChartParts(
      [
        [1, part('Second', ['b'], [2])],
        [2, part('First', ['a'], [1])],
      ],
      [first, second]
    );
    expect(matched.map((entry) => [entry.ordinal, entry.chart])).toEqual([
      [1, second],
      [2, first],
    ]);
  });

  it('refuses to leave a chart without a part rather than shipping it broken', () => {
    expect(() =>
      matchChartParts(
        [[1, part('Present', ['a'], [1])]],
        [series('Present', ['a'], [1]), series('Missing', ['b'], [2])]
      )
    ).toThrow(/Missing/);
  });
});

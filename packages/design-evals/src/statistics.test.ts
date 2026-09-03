import { describe, expect, it } from 'vitest';
import { bootstrapKappa, cohensKappa, rawAgreement } from './statistics.js';

const pairs = (rows: Array<[boolean, boolean]>) =>
  rows.map(([a, b]) => ({ a, b }));

describe('cohensKappa', () => {
  it('is 1 for perfect agreement on a varied sample', () => {
    expect(
      cohensKappa(
        pairs([
          [true, true],
          [false, false],
          [true, true],
          [false, false],
        ])
      )
    ).toBe(1);
  });

  it('is undefined when a rater never varies, not zero', () => {
    // Both raters said "no" every time. Raw agreement is perfect and empty.
    expect(
      cohensKappa(
        pairs([
          [false, false],
          [false, false],
        ])
      )
    ).toBeNaN();
    expect(
      rawAgreement(
        pairs([
          [false, false],
          [false, false],
        ])
      )
    ).toBe(1);
  });

  it('is near zero for agreement no better than chance', () => {
    const rows: Array<[boolean, boolean]> = [];
    for (let index = 0; index < 100; index += 1) {
      rows.push([index % 2 === 0, index % 4 < 2]);
    }
    expect(Math.abs(cohensKappa(pairs(rows)))).toBeLessThan(0.1);
  });

  it('goes negative when the raters systematically disagree', () => {
    expect(
      cohensKappa(
        pairs([
          [true, false],
          [false, true],
          [true, false],
          [false, true],
        ])
      )
    ).toBeLessThan(0);
  });

  it('handles more than two categories', () => {
    const levels = [
      { a: 1, b: 1 },
      { a: 2, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 5 },
    ];
    expect(cohensKappa(levels)).toBeGreaterThan(0.5);
    expect(cohensKappa(levels)).toBeLessThan(1);
  });
});

describe('bootstrapKappa', () => {
  const sample = pairs([
    [true, true],
    [true, true],
    [false, false],
    [false, false],
    [true, false],
    [false, true],
    [true, true],
    [false, false],
    [true, true],
    [false, false],
  ]);

  it('reports an interval that brackets the point estimate', () => {
    const report = bootstrapKappa(sample, { resamples: 500 });
    expect(report.n).toBe(10);
    expect(report.interval).toBeDefined();
    expect(report.interval!.low).toBeLessThanOrEqual(report.kappa);
    expect(report.interval!.high).toBeGreaterThanOrEqual(report.kappa);
  });

  it('is reproducible, so "run it again" is not an argument', () => {
    const first = bootstrapKappa(sample, { resamples: 300 });
    const second = bootstrapKappa(sample, { resamples: 300 });
    expect(first.interval).toEqual(second.interval);
    expect(
      bootstrapKappa(sample, { resamples: 300, seed: 7 }).interval
    ).not.toEqual(first.interval);
  });

  it('answers without an interval when the sample cannot support one', () => {
    expect(bootstrapKappa(pairs([[true, true]])).interval).toBeUndefined();
    expect(bootstrapKappa([]).n).toBe(0);
  });

  it('widens the interval as the sample shrinks', () => {
    // Slice kept to a stretch that still contains disagreement: a sample
    // where the two raters never differ has a kappa of 1 in every resample,
    // and an interval of zero width for a reason that is not sample size.
    const wide = bootstrapKappa(sample.slice(0, 6), { resamples: 800 });
    const narrow = bootstrapKappa(
      [...sample, ...sample, ...sample, ...sample],
      { resamples: 800 }
    );
    const width = (report: typeof wide) =>
      report.interval ? report.interval.high - report.interval.low : 0;
    expect(width(wide)).toBeGreaterThan(width(narrow));
  });
});

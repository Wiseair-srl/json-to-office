import { describe, expect, it } from 'vitest';
import { agreement } from './paired.js';

const verdicts = (pattern: Array<[boolean, boolean]>) =>
  pattern.map(([headless, desktop], index) => ({
    briefId: `brief-${index}`,
    headless,
    desktop,
  }));

describe('agreement', () => {
  it('reports the confusion matrix, not just a rate', () => {
    const report = agreement(
      verdicts([
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ])
    );
    expect(report.matrix).toEqual({
      bothShippable: 1,
      headlessOnly: 1,
      desktopOnly: 1,
      neither: 1,
    });
    expect(report.rawAgreement).toBe(0.5);
    expect(report.disagreements).toEqual(['brief-1', 'brief-2']);
  });

  it('gives perfect agreement a kappa of 1', () => {
    const report = agreement(
      verdicts([
        [true, true],
        [false, false],
        [true, true],
      ])
    );
    expect(report.rawAgreement).toBe(1);
    expect(report.kappa).toBe(1);
  });

  it('refuses to call chance agreement agreement', () => {
    // Both raters say "not shippable" every time. Raw agreement is perfect and
    // means nothing, which is exactly what kappa is for.
    const report = agreement(
      verdicts([
        [false, false],
        [false, false],
        [false, false],
      ])
    );
    expect(report.rawAgreement).toBe(1);
    expect(report.kappa).toBeNaN();
  });

  it('goes negative when the two raters disagree worse than chance', () => {
    const report = agreement(
      verdicts([
        [true, false],
        [false, true],
        [true, false],
        [false, true],
      ])
    );
    expect(report.kappa).toBeLessThan(0);
  });

  it('answers for an empty set without dividing by zero', () => {
    expect(agreement([])).toMatchObject({ pairs: 0, agreed: 0 });
  });
});

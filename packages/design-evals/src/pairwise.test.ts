import { describe, expect, it } from 'vitest';

import { bShownFirst, signTest, tally, type PairOutcome } from './pairwise.js';

const outcome = (
  briefId: string,
  winner: PairOutcome['winner']
): PairOutcome => ({
  briefId,
  winner,
  margin: 'slight',
  bShownFirst: false,
  rationale: '',
});

describe('bShownFirst', () => {
  it('is stable for a brief, so two runs of a comparison can be diffed', () => {
    expect(bShownFirst('cd-capital-allocation', 1)).toBe(
      bShownFirst('cd-capital-allocation', 1)
    );
  });

  it('does not put the same side first every time', () => {
    // A judge shown the new work second on all forty briefs has been told
    // where to find it.
    const ids = Array.from({ length: 40 }, (_, index) => `brief-${index}`);
    const first = ids.filter((id) => bShownFirst(id, 20260905)).length;
    expect(first).toBeGreaterThan(8);
    expect(first).toBeLessThan(32);
  });

  it('shuffles differently under a different seed', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `brief-${index}`);
    const one = ids.map((id) => bShownFirst(id, 1)).join('');
    const two = ids.map((id) => bShownFirst(id, 2)).join('');
    expect(one).not.toBe(two);
  });
});

describe('signTest', () => {
  it('calls an even split a coin', () => {
    expect(signTest(5, 5)).toBe(1);
  });

  it('does not call 9 against 4 a result', () => {
    // The shape the cold-versus-assisted paired analysis actually had.
    expect(signTest(9, 4)).toBeGreaterThan(0.05);
  });

  it('calls a clean sweep one', () => {
    expect(signTest(10, 0)).toBeLessThan(0.01);
  });

  it('claims nothing when nothing was decided', () => {
    expect(signTest(0, 0)).toBe(1);
  });

  it('is symmetric: the same split either way round reads the same', () => {
    expect(signTest(12, 3)).toBeCloseTo(signTest(3, 12), 12);
  });
});

describe('tally', () => {
  it('counts ties without letting them vote', () => {
    const result = tally([
      outcome('a', 'b'),
      outcome('b', 'b'),
      outcome('c', 'tie'),
      outcome('d', 'a'),
    ]);
    expect(result).toMatchObject({ a: 1, b: 2, tie: 1, decided: 3 });
    expect(result.pValue).toBeGreaterThan(0.05);
  });
});

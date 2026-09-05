import { describe, expect, it } from 'vitest';

import {
  agreedVerdict,
  bShownFirst,
  signTest,
  tally,
  type PairJudgement,
  type PairOutcome,
} from './pairwise.js';

const showing = (
  bShownFirst: boolean,
  winner: PairJudgement['winner']
): PairJudgement => ({ bShownFirst, winner, margin: 'slight', rationale: '' });

/** A brief both orders agreed on. */
const outcome = (briefId: string, winner: 'a' | 'b' | 'tie'): PairOutcome => ({
  briefId,
  judgements: [showing(false, winner), showing(true, winner)],
  verdict: winner,
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

describe('agreedVerdict', () => {
  it('does not count a single showing or duplicate orders as a result', () => {
    for (const judgements of [
      [showing(false, 'b')],
      [showing(false, 'b'), showing(false, 'b')],
    ]) {
      const verdict = agreedVerdict(judgements);
      expect(verdict).toBe('inconsistent');
      expect(tally([{ briefId: 'smoke', judgements, verdict }]).decided).toBe(
        0
      );
    }
  });
  it('takes the winner both orders named', () => {
    expect(agreedVerdict([showing(false, 'b'), showing(true, 'b')])).toBe('b');
  });

  it('calls a pair the judge ranked differently in each order inconsistent', () => {
    // The failure the two-order design exists to expose: a document that wins
    // only from the second slot has not won.
    expect(agreedVerdict([showing(false, 'b'), showing(true, 'a')])).toBe(
      'inconsistent'
    );
  });
});

describe('tally', () => {
  it('counts ties and disagreements without letting them vote', () => {
    const result = tally([
      outcome('a', 'b'),
      outcome('b', 'b'),
      outcome('c', 'tie'),
      outcome('d', 'a'),
      {
        briefId: 'e',
        judgements: [showing(false, 'b'), showing(true, 'a')],
        verdict: 'inconsistent',
      },
    ]);
    expect(result).toMatchObject({
      a: 1,
      b: 2,
      tie: 1,
      inconsistent: 1,
      decided: 3,
    });
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it('measures the judge preferring whatever it saw second', () => {
    // Every showing won by the second document: the instrument, not the work.
    const alwaysSecond = ['p', 'q'].map((briefId) => ({
      briefId,
      judgements: [showing(false, 'b'), showing(true, 'a')],
      verdict: 'inconsistent' as const,
    }));
    expect(tally(alwaysSecond).secondShownWinRate).toBe(1);
    expect(tally(alwaysSecond).decided).toBe(0);
  });

  it('reports no preference when order made no difference', () => {
    expect(
      tally([outcome('a', 'b'), outcome('b', 'a')]).secondShownWinRate
    ).toBe(0.5);
  });
});

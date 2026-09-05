import { describe, expect, it } from 'vitest';

import { pairs, summarise, type RejudgedRun } from './rejudge.js';

const run = (
  briefId: string,
  then: RejudgedRun['then'],
  now?: RejudgedRun['now']
): RejudgedRun => ({ briefId, then, ...(now && { now }) });

describe('pairs', () => {
  it('keeps only documents that carry both judgements', () => {
    const runs = [
      run(
        'a',
        { wouldShip: true },
        { wouldShip: false, level: 3, genericness: 2 }
      ),
      // Never re-judged: a missing contact sheet is not a disagreement.
      run('b', { wouldShip: true }),
      // Judged now but not then: an unjudged baseline run is not one either.
      run('c', {}, { wouldShip: true, level: 4, genericness: 1 }),
    ];
    expect(pairs<boolean>(runs, (v) => v.wouldShip)).toEqual([
      { a: true, b: false },
    ]);
  });
});

describe('summarise', () => {
  it('reports nothing rather than a perfect score when nothing was compared', () => {
    expect(summarise([run('a', { wouldShip: true })])).toBeUndefined();
  });

  it('gives a judge that reproduces itself a kappa of one', () => {
    const runs = [
      run(
        'a',
        { wouldShip: true, level: 4, genericness: 2 },
        { wouldShip: true, level: 4, genericness: 2 }
      ),
      run(
        'b',
        { wouldShip: false, level: 3, genericness: 3 },
        { wouldShip: false, level: 3, genericness: 3 }
      ),
      run(
        'c',
        { wouldShip: false, level: 2, genericness: 4 },
        { wouldShip: false, level: 2, genericness: 4 }
      ),
    ];
    expect(summarise(runs)?.wouldShip.kappa).toBe(1);
    expect(summarise(runs)?.levelMovedMoreThanOne).toBe(0);
  });

  it('does not credit a judge that only ever says no', () => {
    // Eighty per cent raw agreement and no information: the case kappa exists
    // for, and the reason the CLI reports kappa rather than agreement.
    const runs = [
      ...Array.from({ length: 4 }, (_, index) =>
        run(
          `no-${index}`,
          { wouldShip: false, level: 3, genericness: 3 },
          { wouldShip: false, level: 3, genericness: 3 }
        )
      ),
      run(
        'yes',
        { wouldShip: true, level: 4, genericness: 2 },
        { wouldShip: false, level: 3, genericness: 3 }
      ),
    ];
    const report = summarise(runs);
    expect(report?.wouldShip.rawAgreement).toBe(0.8);
    expect(report?.wouldShip.kappa).toBe(0);
  });

  it('counts levels that moved by more than one step', () => {
    const runs = [
      run(
        'a',
        { wouldShip: true, level: 4, genericness: 2 },
        { wouldShip: true, level: 2, genericness: 2 }
      ),
      run(
        'b',
        { wouldShip: false, level: 3, genericness: 3 },
        { wouldShip: false, level: 4, genericness: 3 }
      ),
    ];
    expect(summarise(runs)?.levelMovedMoreThanOne).toBe(1);
  });
});

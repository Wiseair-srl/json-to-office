import { describe, expect, it } from 'vitest';

import {
  comparableRuns,
  pairs,
  summarise,
  type RejudgedRun,
} from './rejudge.js';

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

describe('summarise with a field nothing can be compared on', () => {
  it('omits the metric rather than reporting NaN as a measurement', () => {
    // A stored verdict that carried `wouldShip` and no rubric numbers: the
    // shipping answer is comparable, the other two are not. `bootstrapKappa([])`
    // answers `n: 0, rawAgreement: 0, kappa: NaN`, and a report carrying that
    // reads as a measurement of perfect disagreement.
    const agreement = summarise([
      run(
        'a',
        { wouldShip: true },
        { wouldShip: true, level: 3, genericness: 2 }
      ),
      run(
        'b',
        { wouldShip: false },
        { wouldShip: false, level: 4, genericness: 1 }
      ),
    ]);

    expect(agreement?.wouldShip.n).toBe(2);
    expect(agreement?.level).toBeUndefined();
    expect(agreement?.genericness).toBeUndefined();
    expect(agreement?.levelMovedMoreThanOne).toBe(0);
  });

  it('still reports a field every stored verdict carried', () => {
    const agreement = summarise([
      run(
        'a',
        { wouldShip: true, level: 3, genericness: 2 },
        { wouldShip: true, level: 3, genericness: 2 }
      ),
      run(
        'b',
        { wouldShip: false, level: 2, genericness: 4 },
        { wouldShip: false, level: 2, genericness: 4 }
      ),
    ]);

    expect(agreement?.level?.n).toBe(2);
    expect(agreement?.genericness?.n).toBe(2);
  });
});

describe('comparableRuns', () => {
  it('keeps the first pass of a repeated brief and drops the rest', () => {
    // Under --repeat the set holds three verdicts for one brief; a committed
    // baseline reports the first, so that is the one a re-judge must match.
    const kept = comparableRuns([
      { briefId: 'a', judge: { wouldShip: true } },
      { briefId: 'a', judge: { wouldShip: false } },
      { briefId: 'b', judge: { wouldShip: false } },
    ]);
    expect(kept.map((run) => run.briefId)).toEqual(['a', 'b']);
    expect(kept[0].judge?.wouldShip).toBe(true);
  });

  it('drops a contaminated run, because no baseline published its verdict', () => {
    // The raw cold scorecard and the committed baseline disagreed 9 against 8
    // on the same forty runs for exactly this reason.
    const kept = comparableRuns([
      { briefId: 'clean', judge: { wouldShip: false } },
      {
        briefId: 'reached-another-server',
        judge: { wouldShip: true },
        foreignTools: ['mcp__unrelated__list_things'],
      },
    ]);
    expect(kept.map((run) => run.briefId)).toEqual(['clean']);
  });

  it('keeps a run whose foreignTools list is present but empty', () => {
    expect(
      comparableRuns([{ briefId: 'a', foreignTools: [] }]).map((r) => r.briefId)
    ).toEqual(['a']);
  });
});

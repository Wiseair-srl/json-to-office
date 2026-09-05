/**
 * The rejudge CLI's argument handling and its two counts.
 *
 * Both defects here are the same shape: a rule that reads one thing as another
 * and produces a plausible answer rather than an error. An option's value read
 * as the runs directory sends the whole run at a path that holds nothing; a
 * run with no original verdict counted as both compared and changed prints two
 * numbers that contradict each other about one document.
 */

import { describe, expect, it } from 'vitest';

import { runsDirArgument, verdictCounts } from './rejudge-cli.js';

describe('runsDirArgument', () => {
  it('takes the positional argument when it comes first', () => {
    expect(runsDirArgument(['runs/foo', '--scorecard', 'out/sc.json'])).toBe(
      'runs/foo'
    );
  });

  it('does not read an option value as the runs directory', () => {
    // The regression: `argv.find(arg => !arg.startsWith('--'))` answered
    // `out/sc.json`, which then had `runs` joined onto it and `rejudge.json`
    // written inside it — a documented invocation producing nothing, or
    // ENOTDIR when the value is a file.
    for (const argv of [
      ['--scorecard', 'out/sc.json', 'runs/foo'],
      ['--briefs', 'a,b', 'runs/foo'],
      ['--judge', 'claude-opus-5', 'runs/foo'],
      ['--scorecard', 'out/sc.json', '--briefs', 'a,b', 'runs/foo'],
    ]) {
      expect(runsDirArgument(argv), argv.join(' ')).toBe('runs/foo');
    }
  });

  it('leaves a valueless flag alone', () => {
    expect(runsDirArgument(['--judge-api', 'runs/foo'])).toBe('runs/foo');
  });

  it('answers undefined when only options were given', () => {
    expect(runsDirArgument(['--scorecard', 'out/sc.json'])).toBeUndefined();
    expect(runsDirArgument([])).toBeUndefined();
  });

  it('does not consume a value that is itself an option', () => {
    // `--scorecard --judge-api runs/foo` is a mistake, but the runs directory
    // is still unambiguous and should not be swallowed.
    expect(runsDirArgument(['--scorecard', '--judge-api', 'runs/foo'])).toBe(
      'runs/foo'
    );
  });
});

describe('verdictCounts', () => {
  const run = (
    briefId: string,
    then: { wouldShip?: boolean },
    now?: { wouldShip: boolean; level: number; genericness: number }
  ) => ({ briefId, then, ...(now && { now }) });

  it('counts a document that kept its answer as compared and not changed', () => {
    expect(
      verdictCounts([
        run(
          'a',
          { wouldShip: true },
          { wouldShip: true, level: 3, genericness: 2 }
        ),
      ])
    ).toEqual({ compared: 1, changed: 0 });
  });

  it('counts a document that flipped as both compared and changed', () => {
    expect(
      verdictCounts([
        run(
          'a',
          { wouldShip: true },
          { wouldShip: false, level: 3, genericness: 2 }
        ),
      ])
    ).toEqual({ compared: 1, changed: 1 });
  });

  it('excludes a run with no original verdict from both counts', () => {
    // The regression: `undefined !== true` is a change, so one such document
    // printed "1 re-judged, unchanged since; 1 changed" about itself.
    expect(
      verdictCounts([
        run('a', {}, { wouldShip: true, level: 3, genericness: 2 }),
      ])
    ).toEqual({ compared: 0, changed: 0 });
  });

  it('excludes a run that was never re-judged', () => {
    expect(verdictCounts([run('a', { wouldShip: true })])).toEqual({
      compared: 0,
      changed: 0,
    });
  });
});

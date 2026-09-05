/** `pnpm rejudge <runs-dir> --scorecard <path>` — the judge against itself. */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { rejudge, type RejudgedRun } from './rejudge.js';

/** Options that take a value, so their value is never read as the runs dir. */
const VALUED_OPTIONS = ['scorecard', 'judge', 'briefs'] as const;
type ValuedOption = (typeof VALUED_OPTIONS)[number];

/**
 * `name` is narrowed to the declared list on purpose. A valued option added
 * here and forgotten in `VALUED_OPTIONS` is exactly how the runs directory
 * came to be read from an option's value; typing it makes that a compile
 * error instead of a silent one.
 */
function value(
  argv: readonly string[],
  name: ValuedOption
): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}

/**
 * The first argument that is neither an option nor an option's value.
 *
 * `argv.find(arg => !arg.startsWith('--'))` reads
 * `--scorecard out/sc.json runs/foo` as a runs directory of `out/sc.json`,
 * which then has `runs` joined onto it and `rejudge.json` written inside it —
 * a documented invocation producing either nothing or ENOTDIR.
 */
export function runsDirArgument(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const takesValue = (VALUED_OPTIONS as readonly string[]).includes(name);
      const next = argv[index + 1];
      if (takesValue && next !== undefined && !next.startsWith('--')) {
        index += 1;
      }
      continue;
    }
    return arg;
  }
  return undefined;
}

/**
 * How many documents were comparable, and how many moved.
 *
 * Both counts require an original verdict, exactly as `pairs()` does. A run
 * whose stored judgement carried no `wouldShip` used to satisfy both
 * predicates at once — `undefined !== true` is a change — and print
 * "1 document(s) re-judged, unchanged since; 1 changed their wouldShip
 * answer" about one document.
 */
export function verdictCounts(runs: readonly RejudgedRun[]): {
  compared: number;
  changed: number;
} {
  const comparable = runs.filter(
    (run) => run.now !== undefined && typeof run.then.wouldShip === 'boolean'
  );
  return {
    compared: comparable.length,
    changed: comparable.filter(
      (run) => run.now!.wouldShip !== run.then.wouldShip
    ).length,
  };
}

export async function main(
  argv: readonly string[],
  line: (text: string) => void = console.log
): Promise<number> {
  const positional = runsDirArgument(argv);
  if (!positional) {
    line('usage: pnpm rejudge <runs-dir> [--scorecard <path>] [--briefs a,b]');
    return 1;
  }
  const runsDir = path.resolve(positional, 'runs');
  const scorecardPath =
    value(argv, 'scorecard') ?? path.resolve(positional, 'scorecard.json');

  const report = await rejudge({
    runsDir,
    scorecardPath,
    judgeModel: value(argv, 'judge') ?? 'claude-opus-5',
    useApiKey: argv.includes('--judge-api'),
    ...(value(argv, 'briefs') !== undefined && {
      briefs: value(argv, 'briefs') as string,
    }),
    onProgress: (message) => line(message),
  });

  const out = path.resolve(positional, 'rejudge.json');
  await fs.writeFile(out, JSON.stringify(report, null, 2));

  line('');
  const { compared, changed } = verdictCounts(report.runs);
  line(
    `${compared} document(s) re-judged, unchanged since; ` +
      `${changed} changed their wouldShip answer`
  );
  if (report.agreement) {
    const { wouldShip, level, genericness, levelMovedMoreThanOne } =
      report.agreement;
    const interval = wouldShip.interval
      ? ` (95% ${wouldShip.interval.low.toFixed(2)}..${wouldShip.interval.high.toFixed(2)})`
      : '';
    line(
      `wouldShip: ${(wouldShip.rawAgreement * 100).toFixed(0)}% agreement, ` +
        `kappa ${wouldShip.kappa.toFixed(2)}${interval}`
    );
    // A field nothing could be compared on is said to be absent rather than
    // printed as 0% and NaN, which read as measurements.
    line(
      level
        ? `level: ${(level.rawAgreement * 100).toFixed(0)}% exact, kappa ${level.kappa.toFixed(2)}, ` +
            `${levelMovedMoreThanOne} moved more than one step`
        : 'level: no stored verdict carried it, nothing to compare'
    );
    line(
      genericness
        ? `genericness: ${(genericness.rawAgreement * 100).toFixed(0)}% exact, kappa ${genericness.kappa.toFixed(2)}`
        : 'genericness: no stored verdict carried it, nothing to compare'
    );
    // The number the programme actually rests on, said plainly.
    if (wouldShip.kappa < 0.6) {
      line('');
      line(
        'WARNING: the judge does not reproduce its own shipping verdict. ' +
          'No phase delta measured with it means anything until this is fixed.'
      );
    }
  }
  line(out);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('rejudge-cli.ts')) {
  process.exitCode = await main(process.argv.slice(2));
}

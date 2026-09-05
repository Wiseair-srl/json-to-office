/** `pnpm rejudge <runs-dir> --scorecard <path>` — the judge against itself. */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { rejudge } from './rejudge.js';

function value(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith('--') ? next : undefined;
}

export async function main(
  argv: readonly string[],
  line: (text: string) => void = console.log
): Promise<number> {
  const positional = argv.find((arg) => !arg.startsWith('--'));
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
  const changed = report.runs.filter(
    (run) => run.now && run.now.wouldShip !== run.then.wouldShip
  );
  const compared = report.runs.filter((run) => run.now).length;
  line(
    `${compared} document(s) re-judged, unchanged since; ` +
      `${changed.length} changed their wouldShip answer`
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
    line(
      `level: ${(level.rawAgreement * 100).toFixed(0)}% exact, kappa ${level.kappa.toFixed(2)}, ` +
        `${levelMovedMoreThanOne} moved more than one step`
    );
    line(
      `genericness: ${(genericness.rawAgreement * 100).toFixed(0)}% exact, kappa ${genericness.kappa.toFixed(2)}`
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

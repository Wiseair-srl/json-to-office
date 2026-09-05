/** `pnpm pairwise <a-dir> <b-dir>` — which set answered the briefs better. */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { comparePairs } from './pairwise.js';

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
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const [aDir, bDir] = positional;
  if (!aDir || !bDir) {
    line(
      'usage: pnpm pairwise <a-dir> <b-dir> [--judge <model>] [--out <path>]'
    );
    return 1;
  }

  const report = await comparePairs({
    aDir: path.resolve(aDir),
    bDir: path.resolve(bDir),
    judgeModel: value(argv, 'judge') ?? 'claude-opus-5',
    useApiKey: argv.includes('--judge-api'),
    ...(value(argv, 'seed') !== undefined && {
      seed: Number(value(argv, 'seed')),
    }),
    ...(argv.includes('--single-order') && { singleOrder: true }),
    ...(value(argv, 'briefs') !== undefined && {
      briefs: value(argv, 'briefs') as string,
    }),
    onProgress: (message) => line(message),
  });

  const out = path.resolve(value(argv, 'out') ?? 'pairwise.json');
  await fs.writeFile(out, JSON.stringify(report, null, 2));

  const { a, b, tie, inconsistent, decided, pValue, secondShownWinRate } =
    report.tally;
  line('');
  line(`A ${path.basename(report.a)}   B ${path.basename(report.b)}`);
  line(
    `A wins ${a}, B wins ${b}, tie ${tie}, orders disagreed ${inconsistent}`
  );
  // The instrument's thumb, before any claim about the documents.
  line(
    `the document shown second won ${(secondShownWinRate * 100).toFixed(0)}% of showings` +
      (Math.abs(secondShownWinRate - 0.5) > 0.1
        ? ' — a position bias, which is why only pairs that survive both orders are counted'
        : '')
  );
  if (report.skipped.length > 0) {
    // Never silently: a comparison over 31 pairs is not one over 39.
    line(`${report.skipped.length} brief(s) not compared`);
  }
  if (decided === 0) {
    line('nothing was decided, so nothing is claimed');
  } else {
    line(
      `sign test over ${decided} decided comparison(s): p = ${pValue.toFixed(3)}`
    );
    line(
      pValue < 0.05
        ? `B is better than A on this corpus`
        : 'this is what a coin looks like; the difference is not established'
    );
  }
  line(out);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('pairwise-cli.ts')) {
  process.exitCode = await main(process.argv.slice(2));
}

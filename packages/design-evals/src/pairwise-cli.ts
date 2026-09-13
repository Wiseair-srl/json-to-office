/**
 * `pnpm pairwise <a-dir> <b-dir>` — which set answered the briefs better.
 *
 * `pnpm pairwise calibrate --human <file> --judge <file> --a <set> --b <set> --out <file>`
 * — the same comparisons, rated by Paolo in the review page, against the
 * judge's two-order verdicts (#409).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  calibrationReport,
  calibrationSheetFromReview,
  judgeIsCalibrated,
  type ReviewedPair,
} from './calibration.js';
import { runWithInkLines } from './cli-lines.js';
import { comparePairs, type PairwiseReport } from './pairwise.js';
import { formatKappa } from './statistics.js';

const OPTIONS = {
  judge: { type: 'string' },
  out: { type: 'string' },
  seed: { type: 'string' },
  briefs: { type: 'string' },
  'judge-api': { type: 'boolean' },
  'single-order': { type: 'boolean' },
} as const;

async function calibrate(
  argv: readonly string[],
  line: (text: string) => void
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      human: { type: 'string' },
      judge: { type: 'string' },
      a: { type: 'string' },
      b: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.human || !values.judge || !values.a || !values.b || !values.out) {
    line(
      'usage: pnpm pairwise calibrate --human <file> --judge <file> --a <set> --b <set> --out <file>'
    );
    return 1;
  }
  const human = JSON.parse(await fs.readFile(values.human, 'utf8')) as {
    pairs: ReviewedPair[];
  };
  const judged = JSON.parse(
    await fs.readFile(values.judge, 'utf8')
  ) as PairwiseReport;
  const dirs: Record<string, string> = {
    [values.a]: judged.a,
    [values.b]: judged.b,
  };
  const { sheet, judgeSkipped } = calibrationSheetFromReview({
    human: human.pairs,
    outcomes: judged.outcomes,
    sides: { a: values.a, b: values.b },
    sheetPath: (set, pair) =>
      path.join(dirs[set], 'runs', pair, 'contact-sheet.png'),
  });
  const report = calibrationReport(sheet);
  const out = path.resolve(values.out);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        human: path.basename(values.human),
        judge: path.basename(values.judge),
        judgeModel: judged.judgeModel,
        judgedAt: judged.judgedAt,
        judgeSkipped,
        report,
        calibrated: judgeIsCalibrated(report),
        sheet,
      },
      null,
      2
    )
  );
  const interval = report.interval
    ? ` (95% ${report.interval.low.toFixed(2)}..${report.interval.high.toFixed(2)})`
    : '';
  line(
    `${report.n} pair(s) rated by both: ${(report.rawAgreement * 100).toFixed(0)}% agreement, kappa ${formatKappa(report.kappa)}${interval}`
  );
  if (judgeSkipped.length > 0) {
    line(
      `the judge never compared ${judgeSkipped.length}: ${judgeSkipped.join(', ')}`
    );
  }
  if (report.unrated > 0) line(`${report.unrated} pair(s) left unrated`);
  line(
    judgeIsCalibrated(report)
      ? 'the judge agrees with Paolo at the programme threshold'
      : 'below the programme threshold: report the judge, rely on Paolo'
  );
  line(out);
  return 0;
}

export async function main(
  argv: readonly string[],
  line: (text: string) => void
): Promise<number> {
  if (argv[0] === 'calibrate') return calibrate(argv.slice(1), line);
  let parsed: ReturnType<typeof parseArguments>;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    line(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const {
    positionals: [aDir, bDir],
    values,
  } = parsed;
  if (!aDir || !bDir || parsed.positionals.length !== 2) {
    line(
      'usage: pnpm pairwise <a-dir> <b-dir> [--judge <model>] [--out <path>]'
    );
    return 1;
  }
  const seed = values.seed === undefined ? undefined : Number(values.seed);
  if (seed !== undefined && !Number.isSafeInteger(seed)) {
    line('--seed must be a safe integer');
    return 1;
  }

  const report = await comparePairs({
    aDir: path.resolve(aDir),
    bDir: path.resolve(bDir),
    judgeModel: values.judge ?? 'claude-opus-5',
    useApiKey: values['judge-api'] ?? false,
    ...(seed !== undefined && { seed }),
    ...(values['single-order'] && { singleOrder: true }),
    ...(values.briefs !== undefined && {
      briefs: values.briefs as string,
    }),
    onProgress: (message) => line(message),
  });

  const out = path.resolve(values.out ?? 'pairwise.json');
  await fs.mkdir(path.dirname(out), { recursive: true });
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
  if (values['single-order']) {
    line('single-order smoke run: no comparative conclusion');
  } else if (decided === 0) {
    line('nothing was decided, so nothing is claimed');
  } else {
    line(
      `sign test over ${decided} decided comparison(s): p = ${pValue.toFixed(3)}`
    );
    line(
      pValue < 0.05
        ? `${b > a ? 'B' : 'A'} is preferred on the ${decided} order-consistent comparisons`
        : 'this is what a coin looks like; the difference is not established'
    );
  }
  line(out);
  return 0;
}

function parseArguments(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: OPTIONS,
    allowPositionals: true,
  });
}

if (process.argv[1] && process.argv[1].endsWith('pairwise-cli.ts')) {
  process.exitCode = await runWithInkLines(main, process.argv.slice(2));
}

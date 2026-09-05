/** `pnpm pairwise <a-dir> <b-dir>` — which set answered the briefs better. */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { comparePairs } from './pairwise.js';

const OPTIONS = {
  judge: { type: 'string' },
  out: { type: 'string' },
  seed: { type: 'string' },
  briefs: { type: 'string' },
  'judge-api': { type: 'boolean' },
  'single-order': { type: 'boolean' },
} as const;

export async function main(
  argv: readonly string[],
  line: (text: string) => void
): Promise<number> {
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
  const { createElement } = await import('react');
  const { render, Static, Text } = await import('ink');
  const lines: { id: number; text: string }[] = [];
  const view = () =>
    createElement(Static<{ id: number; text: string }>, {
      items: [...lines],
      children: (item) => createElement(Text, { key: item.id }, item.text),
    });
  const app = render(view());
  try {
    process.exitCode = await main(process.argv.slice(2), (text) => {
      lines.push({ id: lines.length, text });
      app.rerender(view());
    });
  } finally {
    app.unmount();
  }
}

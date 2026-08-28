/**
 * Stops a callsite timeout from silently capping a test below the runner's own
 * budget.
 *
 * `vitest.base.ts` sets `testTimeout` per environment — strict locally, roomy
 * on the slow runners — and a per-test timeout overrides it in both directions.
 * That is the point when a test is genuinely slow, and a trap when the literal
 * merely happens to match whatever the default was on the day it was written.
 *
 * Forty-five callsites were pinned to `30_000` because that was the CI budget.
 * When Windows needed more, raising the default moved nothing for them: the
 * pins became a ceiling underneath it, and `native-visual` kept timing out at
 * exactly 30s. Nothing failed loudly; the raise simply did not apply.
 *
 * So the rule is not "no callsite timeouts". A pin at or above the budget is
 * fine: it buys headroom against the strict LOCAL default without taking any
 * away from CI. A pin below the budget is the trap, because on the slow runner
 * it can only subtract.
 *
 * Deleting the forty-seven and letting them inherit was tried and is wrong:
 * `pnpm test` runs twenty packages at once, and under that load a test taking
 * 1.4s alone will pass 5s. The pins are load headroom for the local run, and
 * the CI budget for the slow one. They just have to name a number that is not
 * smaller than what the runner already offers.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The largest `testTimeout` vitest.base.ts hands out, on the slow runners. */
const SLOW_RUNNER_BUDGET_MS = 60_000;

const TIMEOUT_CALL = /\}\s*,\s*(\d[\d_]*)\s*\)\s*;/g;

async function testFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') return [];
        return testFiles(full);
      }
      return /\.test\.tsx?$/.test(entry.name) ? [full] : [];
    })
  );
  return found.flat();
}

const offenders: string[] = [];

for (const file of await testFiles(path.join(root, 'packages'))) {
  const source = await readFile(file, 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    TIMEOUT_CALL.lastIndex = 0;
    const match = TIMEOUT_CALL.exec(line);
    if (!match) return;
    const value = Number(match[1].replace(/_/g, ''));
    // Equal to the budget is fine — that is a test buying local headroom
    // without asking CI for more. Below it is the trap: on the slow runner the
    // pin replaces a larger default with a smaller one.
    if (!Number.isFinite(value) || value >= SLOW_RUNNER_BUDGET_MS) return;
    offenders.push(
      `${path.relative(root, file)}:${index + 1}  ${value}ms caps this test below the ${SLOW_RUNNER_BUDGET_MS}ms slow-runner budget`
    );
  });
}

if (offenders.length > 0) {
  console.error(
    `A callsite timeout below the slow-runner budget replaces it with a smaller one.\nRaise it to at least ${SLOW_RUNNER_BUDGET_MS}, or delete it and inherit the default.\n\n${offenders.join('\n')}\n`
  );
  process.exit(1);
}

console.log(
  `Test timeout budgets enforced: no callsite timeout caps a test below ${SLOW_RUNNER_BUDGET_MS}ms.`
);

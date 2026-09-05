import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comparePairs, tally, type PairOutcome } from './pairwise.js';
import { main } from './pairwise-cli.js';

vi.mock('./pairwise.js', async (original) => ({
  ...(await original<typeof import('./pairwise.js')>()),
  comparePairs: vi.fn(),
}));
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});
async function run(winner: 'a' | 'b', extra: string[] = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pairwise-cli-'));
  dirs.push(dir);
  const outcomes: PairOutcome[] = Array.from({ length: 6 }, (_, i) => ({
    briefId: String(i),
    verdict: winner,
    judgements: [false, true].map((bShownFirst) => ({
      bShownFirst,
      winner,
      margin: 'clear',
      rationale: '',
    })),
  }));
  vi.mocked(comparePairs).mockResolvedValue({
    a: '/cold',
    b: '/assisted',
    judgeModel: 'test',
    judgedAt: '',
    outcomes,
    skipped: [],
    tally: tally(outcomes),
  });
  const lines: string[] = [];
  const output = path.join(dir, 'nested', 'result.json');
  const code = await main(
    [
      '--out',
      output,
      '--judge',
      'test',
      'cold',
      '--seed',
      '42',
      'assisted',
      ...extra,
    ],
    (text) => lines.push(text)
  );
  return { code, lines, output };
}
describe('pairwise CLI', () => {
  it.each(['a', 'b'] as const)(
    'reports the correct winner: %s',
    async (winner) => {
      const { code, lines, output } = await run(winner);
      expect(code).toBe(0);
      expect(lines).toContain(
        `${winner.toUpperCase()} is preferred on the 6 order-consistent comparisons`
      );
      expect(JSON.parse(await fs.readFile(output, 'utf8')).tally[winner]).toBe(
        6
      );
    }
  );
  it('keeps option values out of positional directories', async () => {
    await run('b');
    expect(comparePairs).toHaveBeenCalledWith(
      expect.objectContaining({
        aDir: path.resolve('cold'),
        bDir: path.resolve('assisted'),
        judgeModel: 'test',
        seed: 42,
      })
    );
  });
  it('does not claim a result for smoke runs', async () => {
    const { lines } = await run('b', ['--single-order']);
    expect(lines).toContain(
      'single-order smoke run: no comparative conclusion'
    );
    expect(lines.some((line) => line.includes('is preferred'))).toBe(false);
  });
  it.each([
    ['--out'],
    ['cold', 'assisted', '--seed', 'NaN'],
    ['cold', 'assisted', '--unknown'],
  ])('rejects invalid arguments before judging: %j', async (...args) => {
    expect(await main(args, () => {})).toBe(1);
    expect(comparePairs).not.toHaveBeenCalled();
  });
});

import { defineConfig } from 'vitest/config';

/**
 * Shared vitest defaults, picked up by each package's own
 * `vitest.config.ts` — the same arrangement as `tsconfig.base.json`.
 *
 * Vitest's 5s default assumes a warm module graph on a developer's machine.
 * A Windows CI runner is neither: it transforms this monorepo's graphs
 * roughly 35x slower than a local run (jto-cli's rasterizer-fonts suite is
 * ~600ms here and ~20s there), so a file's FIRST import — the one with
 * nothing yet warm — can eat most of a 5s budget before the test body even
 * starts. Nothing is wrong when that happens; the clock simply ran out in
 * the wrong place.
 *
 * That has gone red twice on the same file now (b65768e, 42f9ea2), patched
 * file-locally both times, and the second one cost a release: `release`
 * needs `test`, so one cold import held back the 0.35.0 publish.
 *
 * The asymmetry below is deliberate. Local stays strict, because that is
 * where fast feedback is worth something; the slow runners get room. It
 * also points the safe way — a test that creeps past 5s now fails for
 * whoever is writing it, instead of passing there and going red for someone
 * else on Windows a week later. Genuinely slow tests should still declare
 * their own timeout at the callsite, where the reason is visible.
 */
const SLOW_RUNNER = Boolean(process.env.CI) || process.platform === 'win32';
const TIMEOUT_MS = SLOW_RUNNER ? 30_000 : 5_000;

export default defineConfig({
  test: {
    testTimeout: TIMEOUT_MS,
    hookTimeout: TIMEOUT_MS,
  },
});

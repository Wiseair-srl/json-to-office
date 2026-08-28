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
 * That has gone red twice on the same file (b65768e, 42f9ea2), patched
 * file-locally both times, and the second one cost a release: `release`
 * needs `test`, so one cold import held back the 0.35.0 publish. 30s did not
 * end it either — two more files went red on Windows, and measuring them
 * showed why a per-test budget was never going to: the cost is not in the
 * bodies.
 *
 *   core-pptx svgRasterFallback  1.8s local ->  >30s Windows  (8 cheap tests)
 *   core-docx native-visual      fast local ->  >30s Windows
 *
 * Both import a whole generator graph and are billed for it on their first
 * test. A ~17x blowup on a body that does almost nothing is not something a
 * timeout chosen from local timings can predict, so the budget for slow
 * runners is what has to absorb it.
 *
 * The asymmetry below is deliberate. Local stays strict, because that is
 * where fast feedback is worth something; the slow runners get room. It
 * also points the safe way — a test that creeps past 5s now fails for
 * whoever is writing it, instead of passing there and going red for someone
 * else on Windows a week later. Genuinely slow tests — the ones whose bodies
 * really do the work, like jto-cli's Ajv compilations — should still declare
 * their own timeout at the callsite, where the reason is visible.
 */
const SLOW_RUNNER = Boolean(process.env.CI) || process.platform === 'win32';
const TIMEOUT_MS = SLOW_RUNNER ? 60_000 : 5_000;

export default defineConfig({
  test: {
    testTimeout: TIMEOUT_MS,
    hookTimeout: TIMEOUT_MS,
  },
});

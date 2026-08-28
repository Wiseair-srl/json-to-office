import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.base';

// Harness suites launch LibreOffice and take minutes — excluded from the
// default run, invoked explicitly via `pnpm test:ground-truth`
// (vitest.harness.config.ts). Timeouts and shared defaults come from the
// repo-root base config.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.harness.test.ts'],
    },
  })
);

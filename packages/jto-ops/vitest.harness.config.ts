import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.base';

// The ground-truth harness only: renders through LibreOffice, so it runs on
// demand (`pnpm test:ground-truth`), never in the default suite.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['src/**/*.harness.test.ts'],
    },
  })
);

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schemas/schema-utils.ts',
    'src/validation/unified/index.ts',
    'src/utils/semver.ts',
    'src/types/warnings.ts',
    'src/cache/index.ts',
  ],
  format: ['esm'],
  dts: {
    compilerOptions: {
      incremental: false,
      composite: false,
    },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['@sinclair/typebox', 'ajv', 'ajv-formats', 'events'],
});

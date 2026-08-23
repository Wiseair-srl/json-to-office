import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schemas/schema-utils.ts',
    'src/schemas/slide-content.ts',
    'src/validation/unified/index.ts',
    'src/utils/semver.ts',
    'src/types/warnings.ts',
    'src/plugin/index.ts',
    'src/fonts/node.ts',
    'src/rendering/index.ts',
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

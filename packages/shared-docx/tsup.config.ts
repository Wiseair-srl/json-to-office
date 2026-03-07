import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/schemas/*.ts', 'src/validation/unified/index.ts'],
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
  external: ['@sinclair/typebox', 'ajv', 'ajv-formats', 'docx', '@json-to-office/shared'],
});

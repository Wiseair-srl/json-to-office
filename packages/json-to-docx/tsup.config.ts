import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: [
    '@json-to-office/core-docx',
    '@json-to-office/shared',
    '@json-to-office/shared-docx',
    'docx',
    'highcharts-export-server',
  ],
});

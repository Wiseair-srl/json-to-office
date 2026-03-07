import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    '@json-to-office/shared',
    '@json-to-office/shared-docx',
    '@json-to-office/shared-pptx',
    '@json-to-office/core-docx',
    '@json-to-office/core-pptx',
  ],
});

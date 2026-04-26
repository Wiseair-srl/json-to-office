import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
);

const commonExternal = [
  '@json-to-office/shared',
  '@json-to-office/shared-docx',
  '@json-to-office/shared-pptx',
  '@json-to-office/core-docx',
  '@json-to-office/core-pptx',
  '@sinclair/typebox',
  'tsx',
  'tsx/esm/api',
  'prompts',
  'ajv',
  'ajv-formats',
  'cosmiconfig',
  'glob',
];

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: { compilerOptions: { incremental: false, composite: false } },
    splitting: false,
    sourcemap: true,
    clean: true,
    shims: true,
    minify: false,
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
    external: commonExternal,
    esbuildOptions(options) {
      options.platform = 'node';
      options.target = 'node18';
    },
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: { compilerOptions: { incremental: false, composite: false } },
    splitting: false,
    sourcemap: true,
    clean: false,
    shims: true,
    minify: false,
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
    external: commonExternal,
    esbuildOptions(options) {
      options.platform = 'node';
      options.target = 'node18';
    },
  },
]);

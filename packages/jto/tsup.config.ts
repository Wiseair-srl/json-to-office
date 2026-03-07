import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
);

export default defineConfig([
  // CLI entry with shebang
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    shims: true,
    minify: false,
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
    external: [
      '@json-to-office/shared',
      '@json-to-office/shared-docx',
      '@json-to-office/shared-pptx',
      '@json-to-office/core-docx',
      '@json-to-office/core-pptx',
      'tsx',
      'tsx/esm/api',
      'prompts',
      'ajv',
      'ajv-formats',
      'cosmiconfig',
      'glob',
    ],
    esbuildOptions(options) {
      options.platform = 'node';
      options.target = 'node18';
    },
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Library entry without shebang
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    shims: true,
    minify: false,
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
    external: [
      '@json-to-office/shared',
      '@json-to-office/shared-docx',
      '@json-to-office/shared-pptx',
      '@json-to-office/core-docx',
      '@json-to-office/core-pptx',
      'tsx',
      'tsx/esm/api',
      'prompts',
      'ajv',
      'ajv-formats',
      'cosmiconfig',
      'glob',
    ],
    esbuildOptions(options) {
      options.platform = 'node';
      options.target = 'node18';
    },
  },
]);

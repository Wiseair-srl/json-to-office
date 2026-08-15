import { defineConfig } from 'tsup';
import { cpSync, readFileSync } from 'fs';
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
  '@json-to-office/jto-cli',
  'tsx',
  'tsx/esm/api',
  'ajv',
  'ajv-formats',
  'cosmiconfig',
  'glob',
  // AI deps (server-only)
  'ai',
  'ai-sdk-provider-claude-code',
  // Server deps (externalized to reduce bundle size)
  'hono',
  '@hono/node-server',
  '@hono/node-server/serve-static',
  'vite',
  'lru-cache',
  'dotenv',
  'mime-types',
];

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
    // Cleaning is done once by the build script to avoid a race
    // between this config and the parallel library config wiping its output.
    clean: false,
    shims: true,
    minify: false,
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
    external: commonExternal,
    // Exclude client directory from server build
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
      // Standalone combined render server (highcharts proxy + pptx rasterizer)
      'render-server': 'src/render-server.ts',
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
    external: commonExternal,
    esbuildOptions(options) {
      options.platform = 'node';
      options.target = 'node18';
    },
    onSuccess: async () => {
      cpSync(join('src', 'server', 'prompts'), join('dist', 'prompts'), {
        recursive: true,
        force: true,
      });
    },
  },
]);

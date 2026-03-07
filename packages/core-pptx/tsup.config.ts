import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: false,
  minify: false,
  ignoreWatch: [
    '**/node_modules/**',
    '**/dist/**',
    '**/tmp/**',
    '**/.tmp/**',
    '**/temp/**',
    '**/.git/**',
  ],
  external: [
    'pptxgenjs',
  ],
});

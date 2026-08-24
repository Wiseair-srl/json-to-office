import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: { compilerOptions: { incremental: false, composite: false } },
  splitting: false,
  sourcemap: true,
  clean: true,
  // `format-adapter.ts` reaches for `require()` in a sync path that cannot
  // await a dynamic import; the shim supplies it in this ESM bundle.
  shims: true,
  minify: false,
  external: [
    '@json-to-office/shared',
    '@json-to-office/shared-docx',
    '@json-to-office/shared-pptx',
    '@json-to-office/core-docx',
    '@json-to-office/core-pptx',
    // Native (.node) FFI module, loaded lazily by the Windows font stager.
    // esbuild must never try to bundle it.
    'koffi',
  ],
  esbuildOptions(options) {
    options.platform = 'node';
    options.target = 'node18';
  },
});

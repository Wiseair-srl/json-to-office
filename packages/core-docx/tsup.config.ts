import { defineConfig } from 'tsup';
import { existsSync } from 'fs';
import { cp, mkdir } from 'fs/promises';

export default defineConfig({
  entry: ['src/index.ts', 'src/plugin/example/index.ts'],
  format: ['esm'],
  dts: false, // Disable tsup's type generation - we'll use tsc directly
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false, // Disable splitting to have cleaner output
  treeshake: false, // Keep all exports
  minify: false, // Don't minify for better debugging
  ignoreWatch: [
    '**/node_modules/**',
    '**/dist/**',
    '**/tmp/**',
    '**/.tmp/**',
    '**/temp/**',
    '**/.git/**',
  ],
  external: [
    '@json-to-office/shared',
    '@json-to-office/shared-docx',
    'docx',
    'fast-xml-parser',
    'sharp',
    'highcharts-export-server',
  ],
  onSuccess: async () => {
    console.log('📦 Copying static assets for core package...');

    // Define copy operations
    const copyOperations = [
      { from: 'src/templates/documents', to: 'dist/templates/documents' },
      { from: 'src/templates/themes', to: 'dist/templates/themes' },
      { from: 'src/plugin/example', to: 'dist/plugin/example' },
    ];

    for (const { from, to } of copyOperations) {
      if (existsSync(from)) {
        // Ensure target directory exists
        await mkdir(to, { recursive: true });

        // Copy JSON files
        await cp(from, to, {
          recursive: true,
          filter: (src: string) => {
            // Copy only JSON files
            return src.endsWith('.json') || !src.includes('.');
          },
        });
        console.log(`  ✓ Copied ${from} → ${to}`);
      }
    }

    console.log('✅ Static assets copied successfully');
  },
});

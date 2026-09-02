import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import * as esbuild from 'esbuild';

/**
 * The plugin sandbox runtime, as one self-contained script.
 *
 * Plugin code runs in a worker created from a blob: URL inside an
 * opaque-origin iframe (see lib/plugins/sandbox-frame.ts), where the only
 * policy that applies is the one that iframe carries. A worker built by
 * Vite's own pipeline would import its dependencies from the app's origin,
 * which that policy must forbid — so the runtime is bundled here with
 * esbuild into a single IIFE the page can hand over as text. Node built-ins
 * the shared packages reach for lazily are replaced by empty modules, the
 * same treatment Vite gives them in the browser build.
 */
const SANDBOX_RUNTIME_ID = 'virtual:jto-sandbox-runtime';
const RESOLVED_SANDBOX_RUNTIME_ID = '\0' + SANDBOX_RUNTIME_ID;

function sandboxRuntime(): Plugin {
  const entry = path.resolve(__dirname, 'lib/plugins/sandbox.worker.ts');
  const stub = path.resolve(__dirname, 'stubs/font-node-stubs.ts');
  const builtins = new Set(
    builtinModules.flatMap((name) => [name, `node:${name}`])
  );
  let cache: Promise<string> | null = null;

  const emptyNodeBuiltins: esbuild.Plugin = {
    name: 'node-builtins-empty',
    setup(build) {
      build.onResolve({ filter: /^(node:)?[a-z_/]+$/ }, (args) =>
        builtins.has(args.path)
          ? { path: args.path, namespace: 'node-empty' }
          : null
      );
      build.onLoad({ filter: /.*/, namespace: 'node-empty' }, () => ({
        contents: 'module.exports = {};',
        loader: 'js',
      }));
    },
  };

  const bundle = (): Promise<string> =>
    esbuild
      .build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        alias: {
          '@json-to-office/shared/fonts/cache/disk-cache': stub,
          '@json-to-office/shared/fonts/sources/file-loader': stub,
        },
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [emptyNodeBuiltins],
        logLevel: 'silent',
      })
      .then((result) => result.outputFiles[0].text);

  return {
    name: 'jto-sandbox-runtime',
    resolveId(id) {
      return id === SANDBOX_RUNTIME_ID
        ? RESOLVED_SANDBOX_RUNTIME_ID
        : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_SANDBOX_RUNTIME_ID) return undefined;
      this.addWatchFile(entry);
      cache ??= bundle().catch((error) => {
        cache = null;
        throw error;
      });
      return `export default ${JSON.stringify(await cache)};`;
    },
    handleHotUpdate({ file }) {
      // Anything under the plugin runtime's directory is part of the bundle.
      if (file.startsWith(path.dirname(entry))) cache = null;
    },
  };
}

/**
 * Type declarations the in-browser plugin editor hands to Monaco.
 *
 * A plugin written in the playground imports `@sinclair/typebox` and the
 * json-to-office plugin API, so the TypeScript language service needs their
 * `.d.ts` files to type-check it. They are read here, at build time, with
 * Node's own resolver — pnpm's symlinked layout makes a glob unreliable — and
 * emitted as one virtual module keyed by the path Monaco will see them at
 * (`node_modules/<pkg>/<file>`). The module is imported lazily, the first time
 * a plugin is compiled, so the main bundle never carries it.
 */
const TYPE_LIBS_ID = 'virtual:jto-plugin-type-libs';
const RESOLVED_TYPE_LIBS_ID = '\0' + TYPE_LIBS_ID;
const TYPE_LIB_PACKAGES: ReadonlyArray<{
  name: string;
  typesRoot: string;
  /** Export conditions to read `types` from, in order of preference. */
  conditions: readonly string[];
}> = [
  {
    name: '@sinclair/typebox',
    typesRoot: 'build/cjs',
    conditions: ['require', 'import', 'default'],
  },
  {
    name: '@json-to-office/shared',
    typesRoot: 'dist',
    conditions: ['import', 'default'],
  },
  {
    name: '@json-to-office/shared-docx',
    typesRoot: 'dist',
    conditions: ['import', 'default'],
  },
  {
    name: '@json-to-office/shared-pptx',
    typesRoot: 'dist',
    conditions: ['import', 'default'],
  },
];
const MAX_TYPE_LIB_FILE_BYTES = 1024 * 1024;

function packageRoot(name: string): string {
  const require = createRequire(import.meta.url);
  let dir = path.dirname(require.resolve(name));
  for (let i = 0; i < 12; i++) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) {
          return dir;
        }
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot locate package root for ${name}`);
}

/** `.d.ts` files under `dir`, as paths relative to `root` (posix separators). */
function collectDeclarationFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectDeclarationFiles(root, full));
    } else if (entry.name.endsWith('.d.ts')) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** The `types` target of one export entry under the preferred conditions. */
function typesOf(entry: unknown, conditions: readonly string[]): string | null {
  if (typeof entry === 'string') return entry.endsWith('.d.ts') ? entry : null;
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.types === 'string' && record.types.endsWith('.d.ts')) {
    return record.types;
  }
  for (const condition of conditions) {
    const nested = typesOf(record[condition], conditions);
    if (nested) return nested;
  }
  return null;
}

/**
 * A package.json reduced to what module resolution reads: name, version, the
 * `types` entry and an `exports` map that carries only `types` targets — the
 * runtime targets would point Monaco at JavaScript it does not have.
 */
function reducedManifest(
  manifest: Record<string, unknown>,
  conditions: readonly string[]
): Record<string, unknown> {
  const exportsMap = manifest.exports;
  const reducedExports: Record<string, { types: string }> = {};
  if (exportsMap && typeof exportsMap === 'object') {
    for (const [key, value] of Object.entries(
      exportsMap as Record<string, unknown>
    )) {
      const types = typesOf(value, conditions);
      if (types) reducedExports[key] = { types };
    }
  }
  const rootTypes =
    reducedExports['.']?.types ??
    (typeof manifest.types === 'string' ? manifest.types : undefined);
  return {
    name: manifest.name,
    version: manifest.version,
    ...(rootTypes ? { types: rootTypes } : {}),
    ...(Object.keys(reducedExports).length > 0
      ? { exports: reducedExports }
      : {}),
  };
}

function collectPluginTypeLibs(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const pkg of TYPE_LIB_PACKAGES) {
    const root = packageRoot(pkg.name);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    files[`node_modules/${pkg.name}/package.json`] = JSON.stringify(
      reducedManifest(manifest, pkg.conditions),
      null,
      2
    );
    for (const rel of collectDeclarationFiles(
      root,
      path.join(root, pkg.typesRoot)
    )) {
      const full = path.join(root, rel);
      if (fs.statSync(full).size > MAX_TYPE_LIB_FILE_BYTES) continue;
      files[`node_modules/${pkg.name}/${rel}`] = fs.readFileSync(full, 'utf8');
    }
  }
  return files;
}

function pluginTypeLibs(): Plugin {
  return {
    name: 'jto-plugin-type-libs',
    resolveId(id) {
      return id === TYPE_LIBS_ID ? RESOLVED_TYPE_LIBS_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_TYPE_LIBS_ID) return undefined;
      return `export default ${JSON.stringify(collectPluginTypeLibs())};`;
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, '.'),
  plugins: [react(), pluginTypeLibs(), sandboxRuntime()],
  define: {
    __AI_ENABLED__: JSON.stringify(process.env.VITE_AI_ENABLED !== 'false'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '/api/services': path.resolve(__dirname, './api/services'),
      // Node-only font modules — stubbed in the browser bundle. FontRegistry
      // only dynamic-imports these on the server side during generate.
      '@json-to-office/shared/fonts/cache/disk-cache': path.resolve(
        __dirname,
        './stubs/font-node-stubs.ts'
      ),
      '@json-to-office/shared/fonts/sources/file-loader': path.resolve(
        __dirname,
        './stubs/font-node-stubs.ts'
      ),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  server: {
    port: 3001,
    open: process.env.OPEN_BROWSER === 'true',
  },
  build: {
    outDir: '../../dist/client',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('monaco-editor')) return 'monaco-editor';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          )
            return 'react-vendor';
          if (
            id.includes('lucide-react') ||
            id.includes('clsx') ||
            id.includes('class-variance-authority')
          )
            return 'ui-vendor';
          if (id.includes('@tanstack/react-query') || id.includes('axios'))
            return 'query-vendor';
          if (id.includes('@radix-ui')) return 'radix-ui';
          if (id.includes('zustand')) return 'state-vendor';
        },
        chunkFileNames: () => 'assets/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 500,
  },
});

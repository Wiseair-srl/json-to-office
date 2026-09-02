import type { Monaco } from '@monaco-editor/react';
import { PLUGIN_TYPE_SHIMS } from './type-shims';

/**
 * Configure Monaco's TypeScript service for plugin sources, once.
 *
 * Plugins are emitted as CommonJS so the sandbox can hand them a `require`
 * that resolves only the allowlisted modules. Module resolution is TypeScript's
 * `Bundler` mode (value 100 — Monaco's enum predates it) so the `exports` maps
 * in the virtual package.json files route `@json-to-office/shared/plugin` and
 * friends to their `.d.ts`. The declaration files themselves come from the
 * `virtual:jto-plugin-type-libs` module built by vite.config.ts and are
 * imported lazily: they are large and only a plugin editor needs them.
 */
let configured: Promise<void> | null = null;

export function ensurePluginTypeScript(monaco: Monaco): Promise<void> {
  if (!configured) {
    configured = configure(monaco)
      .then(markReady)
      .catch((error) => {
        configured = null;
        throw error;
      });
  }
  return configured;
}

async function configure(monaco: Monaco): Promise<void> {
  const ts = monaco.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    // ModuleResolutionKind.Bundler; see the module comment.
    moduleResolution: 100 as unknown as typeof ts.ModuleResolutionKind.NodeJs,
    lib: ['es2020', 'dom'],
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowNonTsExtensions: true,
    skipLibCheck: true,
    noEmitOnError: false,
    resolveJsonModule: false,
    typeRoots: [],
    types: [],
  });
  // Until the declarations are in, every import is "Cannot find module":
  // semantic checking stays off so an editor that opened first does not
  // flash red for the second the download takes.
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
  });
  ts.typescriptDefaults.setEagerModelSync(true);

  const libs = (await import('virtual:jto-plugin-type-libs')).default;
  const files: Record<string, string> = { ...libs, ...PLUGIN_TYPE_SHIMS };
  for (const [path, content] of Object.entries(files)) {
    ts.typescriptDefaults.addExtraLib(content, `file:///${path}`);
  }
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
  });
}

/** True once the declarations are registered; the editor strip reads it. */
export function pluginTypeScriptReady(): boolean {
  return ready;
}

let ready = false;
const readyListeners = new Set<() => void>();

/** Notified once when the declarations finish loading. */
export function onPluginTypeScriptReady(listener: () => void): () => void {
  if (ready) {
    listener();
    return () => {};
  }
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function markReady(): void {
  ready = true;
  for (const listener of readyListeners) listener();
  readyListeners.clear();
}

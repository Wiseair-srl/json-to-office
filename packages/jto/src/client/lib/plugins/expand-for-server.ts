import { FORMAT } from '../env';
import {
  selectActivePlugins,
  useBrowserPluginsStore,
} from '../../store/browser-plugins-store';
import { getBuiltinThemes } from './builtin-themes';
import {
  expandDocument,
  PluginExpansionError,
  referencedPluginNames,
  remapExpandedPointer,
  type ExpandablePlugin,
  type ExpandPathMap,
  type ExpandWarning,
} from './expand';
import { pluginHost } from './host';
import { resolvePluginThemeDetailed } from './theme-resolution';
import type { BrowserPluginRecord } from './types';

/**
 * The one door every document leaves through.
 *
 * Whatever the server is about to receive — a build, a validation, a preview,
 * a copy of the standard tree, one side of a diff — passes here first so a
 * browser plugin the document names is expanded into standard components.
 * When no active plugin is referenced the text is returned untouched, so the
 * cost for every other document is a parse.
 */

export interface ExpandForServerResult {
  text: string;
  warnings: ExpandWarning[];
  /** True when the document was changed by expansion. */
  expanded: boolean;
  /**
   * Point a server-reported JSON pointer (into the text that was sent) back
   * at the authored document. Identity when nothing was expanded.
   */
  remap: (pointer: string) => { path: string; insidePlugin: boolean };
}

export interface ExpandForServerOptions {
  /** Valid custom themes keyed by theme name, as sent to the server. */
  customThemes?: Record<string, unknown>;
  signal?: AbortSignal;
}

const identityRemap = (pointer: string) => ({
  path: pointer,
  insidePlugin: false,
});

/** Why a plugin the document names is not taking part, in the author's words. */
function inactiveReason(record: BrowserPluginRecord): string {
  if (!record.enabled)
    return 'is turned off — enable it in the plugin header or the sidebar';
  if (record.status === 'compiling' || record.status === 'idle') {
    return 'is still compiling — try again in a moment';
  }
  const errors = record.diagnostics.filter((d) => d.severity === 'error');
  return errors.length > 0
    ? `has ${errors.length} error${errors.length === 1 ? '' : 's'} — open ${record.docName} to fix ${errors.length === 1 ? 'it' : 'them'}`
    : `failed to load — open ${record.docName}`;
}

export async function expandForServer(
  text: string,
  options: ExpandForServerOptions = {}
): Promise<ExpandForServerResult> {
  const state = useBrowserPluginsStore.getState();
  const active = selectActivePlugins(state);
  const known = Object.values(state.records).filter((r) => r.metadata);
  if (known.length === 0) {
    return { text, warnings: [], expanded: false, remap: identityRemap };
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    // Not JSON yet; the server will report that, not this pass.
    return { text, warnings: [], expanded: false, remap: identityRemap };
  }

  // A plugin the document names that cannot take part is the author's
  // problem to hear about here, by name — the server would only say
  // "unknown component" against the node.
  const activeNames = new Set(active.map((plugin) => plugin.metadata.name));
  const inactive = new Map<string, BrowserPluginRecord>();
  for (const record of known) {
    const name = record.metadata!.name;
    if (!activeNames.has(name) && !inactive.has(name))
      inactive.set(name, record);
  }
  const usedInactive = referencedPluginNames(
    document,
    new Set(inactive.keys())
  );
  if (usedInactive.size > 0) {
    const [name] = usedInactive;
    const record = inactive.get(name)!;
    throw new PluginExpansionError(
      `"${name}" is a browser plugin that ${inactiveReason(record)}.`,
      name
    );
  }

  const used = referencedPluginNames(document, activeNames);
  if (used.size === 0) {
    return { text, warnings: [], expanded: false, remap: identityRemap };
  }

  const plugins = new Map<string, ExpandablePlugin>();
  const docNameByComponent = new Map<string, string>();
  for (const plugin of active) {
    plugins.set(plugin.metadata.name, {
      name: plugin.metadata.name,
      versions: plugin.metadata.versions.map((v) => v.version),
    });
    docNameByComponent.set(plugin.metadata.name, plugin.docName);
  }

  let builtinThemes: Record<string, unknown> = {};
  try {
    builtinThemes = await getBuiltinThemes();
  } catch {
    // Custom themes still resolve; a built-in name falls back to `{}` and the
    // plugin sees an empty theme rather than the expansion failing outright.
  }
  const resolved = resolvePluginThemeDetailed(document, {
    format: FORMAT,
    customThemes: options.customThemes ?? {},
    builtinThemes,
  });

  const result = await expandDocument(document, {
    plugins,
    theme: resolved.theme,
    signal: options.signal,
    render: (request, signal) =>
      pluginHost.render(docNameByComponent.get(request.name)!, request, signal),
  });

  const warnings: ExpandWarning[] = resolved.warning
    ? [
        {
          component: 'theme',
          message: resolved.warning.message,
          severity: 'warning',
          context: resolved.warning.context,
        },
        ...result.warnings,
      ]
    : result.warnings;
  const pathMap: ExpandPathMap = result.pathMap;

  return {
    text: JSON.stringify(result.document, null, 2),
    warnings,
    expanded: true,
    remap: (pointer) => remapExpandedPointer(pointer, pathMap),
  };
}

import { latestVersion } from '@json-to-office/shared';
import type {
  BrowserPluginMetadata,
  PluginExample,
  PluginFormat,
  PluginVersionMetadata,
} from './types';

/**
 * Run a plugin's compiled CommonJS and find the component it exports.
 *
 * Pure functions with no browser dependency, so the loading rules can be
 * tested in Node against real emitted code. `require` resolves only the
 * module map it is given — the sandbox passes the allowlisted packages — and
 * names anything else clearly rather than failing with a bare undefined.
 */

export type ModuleMap = Readonly<Record<string, unknown>>;

export function evaluateCommonJs(
  js: string,
  modules: ModuleMap
): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    throw new Error(
      `Module "${id}" is not available in the playground sandbox. Available modules: ${Object.keys(
        modules
      ).join(', ')}`
    );
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('require', 'module', 'exports', js) as (
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>
  ) => void;
  factory(require, module, module.exports);
  return module.exports;
}

export interface ComponentLike {
  name: string;
  versions: Record<
    string,
    {
      propsSchema: unknown;
      render: (context: unknown) => unknown;
      hasChildren?: boolean;
      description?: string;
    }
  >;
}

/** The same test disk discovery applies (`PluginLoader.isValidComponent`). */
export function isValidComponent(value: unknown): value is ComponentLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; versions?: unknown };
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    return false;
  }
  if (!candidate.versions || typeof candidate.versions !== 'object') {
    return false;
  }
  const entries = Object.values(candidate.versions as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.some(
      (entry) =>
        !!entry &&
        typeof entry === 'object' &&
        !!(entry as { propsSchema?: unknown }).propsSchema &&
        typeof (entry as { propsSchema?: unknown }).propsSchema === 'object' &&
        typeof (entry as { render?: unknown }).render === 'function'
    )
  );
}

/**
 * The exported component, found the way `PluginLoader.extractComponent`
 * finds it: the default export, then exports named `*Component` /
 * `*Module`, then any export that qualifies.
 */
export function extractComponent(
  exports: Record<string, unknown>
): ComponentLike | null {
  if (isValidComponent(exports.default)) return exports.default;
  const preferred = Object.entries(exports).filter(
    ([key]) =>
      key.endsWith('Component') ||
      key.endsWith('component') ||
      key.endsWith('Module') ||
      key.endsWith('module')
  );
  for (const [, value] of preferred) {
    if (isValidComponent(value)) return value;
  }
  for (const value of Object.values(exports)) {
    if (isValidComponent(value)) return value;
  }
  return null;
}

/** Semver keys, or the reason a key is not one. */
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Metadata for the page: every version with its props schema as plain JSON
 * (the TypeBox object survives `postMessage` only as JSON anyway), the latest
 * version, and the examples parsed from the source.
 */
export function describeComponent(
  component: ComponentLike,
  format: PluginFormat,
  examples: PluginExample[]
): BrowserPluginMetadata {
  const versions: PluginVersionMetadata[] = [];
  for (const [version, entry] of Object.entries(component.versions)) {
    if (!SEMVER.test(version)) {
      throw new Error(
        `Component "${component.name}": invalid semver key "${version}". Expected format: major.minor.patch`
      );
    }
    if (!entry || typeof entry !== 'object' || !entry.propsSchema) {
      throw new Error(
        `Component "${component.name}" version "${version}" requires a propsSchema`
      );
    }
    if (typeof entry.render !== 'function') {
      throw new Error(
        `Component "${component.name}" version "${version}" requires a render function`
      );
    }
    let propsSchema: Record<string, unknown>;
    try {
      propsSchema = JSON.parse(JSON.stringify(entry.propsSchema));
    } catch (error) {
      throw new Error(
        `Component "${component.name}" version "${version}": propsSchema is not serializable (${
          error instanceof Error ? error.message : String(error)
        })`
      );
    }
    versions.push({
      version,
      propsSchema,
      hasChildren: entry.hasChildren === true,
      ...(typeof entry.description === 'string'
        ? { description: entry.description }
        : {}),
    });
  }
  if (versions.length === 0) {
    throw new Error(
      `Component "${component.name}" must have at least one version`
    );
  }
  return {
    name: component.name,
    format,
    versions,
    latest: latestVersion(versions.map((v) => v.version)),
    examples,
  };
}

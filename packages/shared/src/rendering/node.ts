/**
 * Which version of a renderer backend is installed, for an adapter that loads
 * one at run time and was built against one release of it.
 *
 * Node-only: it reads the backend's manifest from disk.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `Error.name` marking a renderer whose backend is installed at a version the
 * adapter was not built for. A name rather than a subclass, for the reason
 * `RENDERER_DEPENDENCY_MISSING` gives.
 */
export const RENDERER_BACKEND_VERSION_MISMATCH = 'RendererBackendVersionError';

/** The version in `dir/package.json` if that manifest is `name`'s. */
function manifestVersion(dir: string, name: string): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8')
    ) as { name?: string; version?: string };
    return manifest.name === name ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The installed version of `name`, as the module at `from` resolves it.
 *
 * `resolved` is the entry URL the caller's own `import.meta.resolve(name)`
 * gave: resolution has to happen in the caller's module, since `name` is that
 * package's dependency and not this one's. The manifest is then the nearest
 * `package.json` above the entry that names the package. `require.resolve`
 * cannot stand in: a package that exports only an `import` condition, as
 * `@office-open/*` do, refuses it for both its entry and its `package.json`
 * (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Without `resolved` — a runtime or test
 * transform lacking `import.meta.resolve` — the directories `require` would
 * search from `from` are read directly instead.
 */
export function installedPackageVersion(
  name: string,
  from: string,
  resolved?: string
): string | undefined {
  if (resolved?.startsWith('file:')) {
    let dir = dirname(fileURLToPath(resolved));
    for (;;) {
      const version = manifestVersion(dir, name);
      if (version !== undefined) return version;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const base of createRequire(from).resolve.paths(name) ?? []) {
    const version = manifestVersion(join(base, name), name);
    if (version !== undefined) return version;
  }
  return undefined;
}

/**
 * Refuse a backend installed at any version but the one the adapter was built
 * and verified against.
 *
 * An adapter that builds the backend's options as data only learns of a
 * renamed or restructured option when a document comes out with content
 * missing: the move from `@office-open` 0.11 to 0.14 renamed most of the
 * vocabulary, and a document rendered on the wrong one lost its lists, its
 * margins or its charts' colours without an error. So a mismatch — or a
 * version that cannot be read — fails before any document is rendered.
 */
export function assertBackendVersion(
  name: string,
  expected: string,
  installed: string | undefined
): void {
  if (installed === expected) return;
  const error = new Error(
    `${name} ${installed ?? '(version unreadable)'} is installed, but this ` +
      `renderer was built and verified against ${name}@${expected}. Its ` +
      'options change shape between releases with nothing to say so, and a ' +
      'document rendered on another version can come out with content ' +
      `missing. Install ${name}@${expected}.`
  ) as Error & {
    packageName: string;
    expectedVersion: string;
    installedVersion?: string;
  };
  error.name = RENDERER_BACKEND_VERSION_MISMATCH;
  error.packageName = name;
  error.expectedVersion = expected;
  if (installed !== undefined) error.installedVersion = installed;
  throw error;
}

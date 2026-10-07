/**
 * A `docx` subpath entry — `docx/charts`, `docx/shapes`, `docx/layout` — loaded
 * when a render first asks for it.
 *
 * Dynamic rather than static on purpose. `docx` is a peer dependency and those
 * entries exist from 9.8.0 on (`docx/layout` from 9.9.0): a static import would make the whole package
 * fail to load (`ERR_PACKAGE_PATH_NOT_EXPORTED`) for a consumer on an older
 * docx, including one that never draws a chart or a drawing group. tsup keeps
 * `import('docx/…')` external (`external: ['docx']`), so nothing is inlined
 * either way; what changes is when the module is evaluated.
 *
 * `load()` never rejects. A failed import is kept, and `get()` reports it —
 * naming the component that needed the entry — only when a document actually
 * needs it, so a document without one renders on any docx the peer range
 * allows.
 *
 * The importer must be a literal `() => import('docx/…')` at the call site:
 * that is what tsup keeps external and what `vi.mock('docx/…')` intercepts.
 */
export interface DocxSubpath<T> {
  /** The entry, e.g. `docx/charts`. */
  readonly specifier: string;
  /** Start the import (once per process) and wait for it. Never rejects. */
  load(): Promise<void>;
  /** Whether the entry loaded. */
  loaded(): boolean;
  /**
   * The loaded module. Throws a named error when `load()` was never awaited
   * or the import failed.
   */
  get(): T;
}

export function docxSubpath<T>(
  specifier: `docx/${string}`,
  component: string,
  importer: () => Promise<T>,
  since = '9.8.0'
): DocxSubpath<T> {
  let module: T | undefined;
  let failure: { reason: unknown } | undefined;
  let loading: Promise<void> | undefined;

  return {
    specifier,
    load() {
      loading ??= importer().then(
        (loadedModule) => {
          module = loadedModule;
        },
        (reason: unknown) => {
          failure = { reason };
        }
      );
      return loading;
    },
    loaded: () => module !== undefined,
    get() {
      if (module !== undefined) return module;
      if (failure !== undefined) {
        const { reason } = failure;
        const detail =
          reason instanceof Error ? reason.message : String(reason);
        throw new Error(
          `The docx \`${component}\` component needs docx ${since} or later: ` +
            `the \`${specifier}\` entry could not be loaded (${detail})`
        );
      }
      throw new Error(
        `${specifier} is not loaded: await its load() before buildDocument() ` +
          `(render() does)`
      );
    },
  };
}

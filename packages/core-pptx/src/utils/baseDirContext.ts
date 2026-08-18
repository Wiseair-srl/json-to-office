import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute, resolve } from 'node:path';

const baseDirStorage = new AsyncLocalStorage<string>();

/**
 * Scope the document base directory for a generation run, so relative asset
 * paths (`image.props.path`, slide background images) resolve against the
 * document's own location rather than `process.cwd()` (#142). No baseDir →
 * plain callback, preserving the historical cwd-relative behavior. Mirrors
 * core-docx/src/utils/generationContext.ts.
 */
export function runWithBaseDir<T>(
  baseDir: string | undefined,
  callback: () => T
): T {
  return baseDir === undefined
    ? callback()
    : baseDirStorage.run(resolve(baseDir), callback);
}

/** The active document base directory, if a generation scope set one. */
export function getBaseDir(): string | undefined {
  return baseDirStorage.getStore();
}

/**
 * Resolve a relative file path against the active base directory. Absolute
 * paths pass through; with no active baseDir the path is returned as-is,
 * which pptxgenjs / `fs` resolve against cwd — the legacy behavior. The
 * rewrite must happen eagerly at render time: pptxgenjs reads `path` entries
 * later, during `write()`, outside any generation scope.
 */
export function resolveFromBaseDir(filePath: string): string {
  const base = baseDirStorage.getStore();
  if (!base || isAbsolute(filePath)) return filePath;
  return resolve(base, filePath);
}

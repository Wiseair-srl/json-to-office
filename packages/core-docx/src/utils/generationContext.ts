import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute, resolve } from 'node:path';
import type { GenerationWarning } from '@json-to-office/shared';

const generationDateStorage = new AsyncLocalStorage<Date>();

/** Scope render-time values without leaking them across concurrent documents. */
export function runWithGenerationDate<T>(date: Date, callback: () => T): T {
  return generationDateStorage.run(date, callback);
}

/** Current document date, falling back to the wall clock outside generation. */
export function getGenerationDate(): Date {
  return generationDateStorage.getStore() ?? new Date();
}

const baseDirStorage = new AsyncLocalStorage<string>();

/**
 * Scope the document base directory for a generation run, so relative asset
 * paths (`image.props.path` et al.) resolve against the document's own
 * location rather than `process.cwd()` (#142). No baseDir → plain callback,
 * preserving the historical cwd-relative behavior.
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
 * which downstream `fs` calls resolve against cwd — the legacy behavior.
 */
export function resolveFromBaseDir(filePath: string): string {
  const base = baseDirStorage.getStore();
  if (!base || isAbsolute(filePath)) return filePath;
  return resolve(base, filePath);
}

const warningsStorage = new AsyncLocalStorage<GenerationWarning[]>();

/**
 * Scope a warning collector for a render, so leaf utilities can report
 * without every intermediate signature carrying a sink. No collector → plain
 * callback, and `reportWarning` falls back to `console.warn` as before.
 */
export function runWithWarnings<T>(
  warnings: GenerationWarning[] | undefined,
  callback: () => T
): T {
  return warnings === undefined
    ? callback()
    : warningsStorage.run(warnings, callback);
}

/** Record a render-time warning against the active collector, if any. */
export function reportWarning(
  component: string,
  code: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const warnings = warningsStorage.getStore();
  if (warnings) {
    warnings.push({
      component,
      message,
      severity: 'warning',
      context: { code, ...context },
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(`[json-to-docx] [${code}] ${message}`);
}

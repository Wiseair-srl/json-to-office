/**
 * Make resolved fonts visible to the LibreOffice child process for the
 * duration of one PDF conversion, then clean up.
 *
 * Linux/macOS:  fontconfig + FONTCONFIG_FILE env var.
 * Windows:      GDI session registration via koffi (AddFontResourceW).
 *
 * The converter calls `stage(fonts, tempDir)` before spawning soffice, merges
 * `envOverrides` into the child process env, waits for conversion, then
 * awaits `cleanup()` regardless of success or failure.
 */

import type { ResolvedFont } from '@json-to-office/shared';

export interface FontStageHandle {
  /** Merged into the child process env. Empty object if nothing to stage. */
  envOverrides: Record<string, string>;
  /** Always call in a finally block. Safe to call multiple times (idempotent). */
  cleanup(): Promise<void>;
}

export interface FontStager {
  stage(fonts: ResolvedFont[], tempDir: string): Promise<FontStageHandle>;
}

/** Per-process monotonic counter to disambiguate concurrent conversions. */
let counter = 0;
export function nextStagingId(): string {
  counter += 1;
  return `${process.pid}-${counter}`;
}

/** Sanitize a font family for use in a filename. */
export function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
}

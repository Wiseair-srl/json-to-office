/**
 * Make resolved fonts visible to the LibreOffice child process for the
 * duration of one PDF conversion, then clean up.
 *
 * Linux/macOS:  fontconfig + FONTCONFIG_FILE env var.
 * Windows:      GDI session registration via koffi (AddFontResourceW).
 *
 * The caller calls `stage(fonts, tempDir)` before spawning soffice, merges
 * `envOverrides` into the child process env, waits for conversion, then
 * awaits `cleanup()` regardless of success or failure.
 *
 * Two consumers today: the playground's LibreOffice PDF-preview converter
 * (`@json-to-office/jto`) and the pptx rasterizer that backs docx `visual`
 * components (`./pptx-rasterizer.ts`). This module lives in `jto-cli`
 * because `@json-to-office/jto` depends on `@json-to-office/jto-cli` and
 * never the reverse — the rasterizer could not otherwise reach it.
 */

import type { ResolvedFont } from '@json-to-office/shared';

export interface FontStageHandle {
  /** Merged into the child process env. Empty object if nothing to stage. */
  envOverrides: Record<string, string>;
  /** Always call in a finally block. Safe to call multiple times (idempotent). */
  cleanup(): Promise<void>;
}

export interface FontStageOptions {
  /**
   * UserInstallation profile directories the soffice launch(es) will use.
   * The macOS stager seeds its OnStartApp Python macro into EACH of them —
   * a launch with an unseeded profile registers no fonts and silently falls
   * back to system faces. Absent → `<tempDir>/user-profile`, the
   * LibreOfficeConverterService convention.
   */
  profileDirs?: string[];
}

export interface FontStager {
  stage(
    fonts: ResolvedFont[],
    tempDir: string,
    options?: FontStageOptions
  ): Promise<FontStageHandle>;
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

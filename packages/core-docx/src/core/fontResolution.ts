/**
 * Shared font-resolution helper used by BOTH entry paths into renderDocument:
 *
 * - generator.ts → generateDocumentWithCustomThemes (non-plugin)
 * - plugin/createDocumentGenerator.ts → generate (plugin-aware)
 *
 * Keeping it in one place ensures the two paths behave identically around
 * validation, SAFE_FONTS awareness, Google Fonts materialization, and the
 * `onResolved` side-channel consumed by the LibreOffice preview font stager.
 */

import type {
  FontRuntimeOpts,
  ResolvedFont,
  GenerationWarning,
} from '@json-to-office/shared';
import {
  collectFontNamesFromDocx,
  validateFontReferences,
  FontRegistry,
} from '@json-to-office/shared';
import {
  loadFileFontSource,
  FontDiskCache,
} from '@json-to-office/shared/fonts/node';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition } from '../types';

export async function resolveDocumentFonts(
  document: ReportComponentDefinition,
  theme: ThemeConfig,
  fonts?: FontRuntimeOpts,
  warnings?: GenerationWarning[]
): Promise<ResolvedFont[]> {
  const emit = (code: string, message: string) => {
    if (warnings) {
      warnings.push({
        component: 'fontRegistry',
        message,
        severity: 'warning',
        context: { code },
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[json-to-docx] ${code}: ${message}`);
    }
  };

  // Walk document + theme. The document typically names fonts only indirectly
  // via `theme: "my-theme"`, so fonts declared in the theme JSON would be
  // invisible without this second pass.
  const names = new Set<string>();
  for (const n of collectFontNamesFromDocx(document)) names.add(n);
  for (const n of collectFontNamesFromDocx(theme as unknown)) names.add(n);
  if (names.size === 0) return [];

  const validation = validateFontReferences({
    referencedNames: names,
    registeredEntries: fonts?.extraEntries,
  });
  if (validation.warnings.length > 0) {
    if (fonts?.strict) {
      throw new Error(
        `Unresolved font references (strict mode):\n` +
          validation.warnings.map((w) => `  - ${w.message}`).join('\n')
      );
    }
    for (const w of validation.warnings) {
      emit(w.code, w.message);
    }
  }

  const registry = new FontRegistry({
    opts: fonts,
    fileLoader: loadFileFontSource,
    diskCache: fonts?.googleFonts?.cacheDir
      ? new FontDiskCache(fonts.googleFonts.cacheDir)
      : undefined,
  });
  const resolved = await registry.resolveMany(names);
  for (const r of resolved) {
    for (const msg of r.warnings) {
      emit('FONT_UNRESOLVED', msg);
    }
  }
  fonts?.onResolved?.(resolved);
  return resolved;
}

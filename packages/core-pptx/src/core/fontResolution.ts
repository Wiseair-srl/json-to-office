/**
 * Shared font-resolution helper used by BOTH entry paths into renderPresentation:
 *
 * - core/generator.ts → generateBufferWithWarnings (non-plugin)
 * - plugin/createPresentationGenerator.ts → generate (plugin-aware)
 *
 * Keeping it in one place ensures both paths validate, materialize, and fire
 * the `onResolved` side-channel consumed by the LibreOffice preview stager.
 */

import type { FontRuntimeOpts, ResolvedFont } from '@json-to-office/shared';
import {
  collectFontNamesFromPptx,
  validateFontReferences,
  FontRegistry,
} from '@json-to-office/shared';
import {
  loadFileFontSource,
  FontDiskCache,
} from '@json-to-office/shared/fonts/node';
import type {
  PipelineWarning,
  PresentationComponentDefinition,
} from '../types';
import type { PptxThemeConfig } from '../types';
import { warn, W } from '../utils/warn';

export async function resolveDocumentFonts(
  document: PresentationComponentDefinition,
  theme: PptxThemeConfig,
  warnings: PipelineWarning[],
  fonts?: FontRuntimeOpts
): Promise<ResolvedFont[]> {
  const names = new Set<string>();
  for (const n of collectFontNamesFromPptx(document)) names.add(n);
  for (const n of collectFontNamesFromPptx(theme as unknown)) names.add(n);
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
      warn(warnings, W.FONT_UNRESOLVED, w.message, {
        component: 'fontRegistry',
      });
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
      warn(warnings, W.FONT_UNRESOLVED, msg, {
        component: 'fontRegistry',
      });
    }
  }
  fonts?.onResolved?.(resolved);
  return resolved;
}

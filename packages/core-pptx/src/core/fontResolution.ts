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
  fetchVariableFontSource,
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

  // Validate unconditionally — strict mode must fire even when no consumer
  // is listening via onResolved (CLI / library callers that just want
  // build-time validation of font references).
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

  // Registry resolution (Google/URL/file fetches) only runs when a consumer
  // is listening via onResolved — typically the LibreOffice preview stager.
  // Office output never embeds bytes, so skipping fetches when nobody cares
  // keeps library callers from paying network cost.
  if (!fonts?.onResolved) return [];

  const registry = new FontRegistry({
    opts: fonts,
    fileLoader: loadFileFontSource,
    variableLoader: fetchVariableFontSource,
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
  // Fire the side-channel here so callers never have to remember. The
  // short-circuit above guarantees we only reach this point when a
  // listener is registered.
  fonts.onResolved(resolved);
  return resolved;
}

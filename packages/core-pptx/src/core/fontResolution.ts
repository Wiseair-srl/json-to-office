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
  documentFontRegistry,
  themeFontRegistry,
  mergeFontRegistries,
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
  fonts?: FontRuntimeOpts,
  /**
   * Materialize font bytes even when no `onResolved` listener is registered.
   * Set when the deck carries a `highcharts`, whose PNG is drawn by an
   * export server's browser that needs the actual font files to set the chart
   * in a registered face. Matches the DOCX helper.
   */
  forceMaterialize = false
): Promise<ResolvedFont[]> {
  const names = new Set<string>();
  for (const n of collectFontNamesFromPptx(document)) names.add(n);
  for (const n of collectFontNamesFromPptx(theme as unknown)) names.add(n);
  if (names.size === 0) return [];

  // Merge the declared registries with runtime overrides. Precedence:
  // theme < document < fonts.extraEntries (see registry.ts's resolution
  // rules). This MUST run before validation, not after the `onResolved`
  // short-circuit below: a presentation with a valid registry and no preview
  // listener would otherwise still report every registered family as
  // FONT_UNRESOLVED.
  const registryEntries = mergeFontRegistries(
    themeFontRegistry(theme),
    documentFontRegistry(document),
    fonts?.extraEntries
  );

  // Validate unconditionally — strict mode must fire even when no consumer
  // is listening via onResolved (CLI / library callers that just want
  // build-time validation of font references).
  const validation = validateFontReferences({
    referencedNames: names,
    registeredEntries: registryEntries,
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

  // Registry resolution (Google/URL/file fetches) runs when a consumer is
  // listening via onResolved — typically the LibreOffice preview stager — or
  // when the caller forces materialization for a chart. Office output never
  // embeds bytes, so skipping fetches when neither applies keeps library
  // callers from paying network cost.
  if (!fonts?.onResolved && !forceMaterialize) return [];

  const registry = new FontRegistry({
    // Spread keeps baseDir/googleFonts/mode/substitution intact for
    // materializeSource; extraEntries carries the merged registry.
    opts: { ...fonts, extraEntries: registryEntries },
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
  // Fire the side-channel here so callers never have to remember. On the
  // force-materialize path there may be no listener at all — the resolved
  // fonts still flow back through the return value.
  fonts?.onResolved?.(resolved);
  return resolved;
}

/**
 * Shared font-resolution helper used by BOTH entry paths into renderDocument:
 *
 * - generator.ts → generateDocumentWithCustomThemes (non-plugin)
 * - plugin/createDocumentGenerator.ts → generate (plugin-aware)
 *
 * Keeping it in one place ensures the two paths behave identically around
 * validation, SAFE_FONTS awareness, Google Fonts materialization, and the
 * `onResolved` side-channel consumed by the LibreOffice preview font stager.
 *
 * Materialization has two triggers: an `onResolved` listener, or the
 * caller's `forceMaterialize` flag (set when the document contains a
 * `visual`, whose PNG is produced by an out-of-process LibreOffice that
 * needs real font files). Both entry paths return the resolved fonts so the
 * caller can forward them to the rasterizer.
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
  documentFontRegistry,
  themeFontRegistry,
  mergeFontRegistries,
} from '@json-to-office/shared';
import {
  loadFileFontSource,
  FontDiskCache,
  fetchVariableFontSource,
} from '@json-to-office/shared/fonts/node';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition } from '../types';

export async function resolveDocumentFonts(
  document: ReportComponentDefinition,
  theme: ThemeConfig,
  fonts?: FontRuntimeOpts,
  warnings?: GenerationWarning[],
  /**
   * Materialize font bytes even when no `onResolved` listener is registered.
   * Set by the callers when the document contains at least one `visual`,
   * whose PNG is rendered by an out-of-process LibreOffice that needs the
   * actual font files — there is no listener on the plain CLI path, so
   * without this a visual-bearing build silently renders with fallbacks.
   */
  forceMaterialize = false
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

  // Merge the declared registries with runtime overrides. Precedence:
  // theme < document < fonts.extraEntries (see registry.ts's resolution
  // rules). This MUST run before validation, not after the `onResolved`
  // short-circuit below: a document with a valid registry and no preview
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
      emit(w.code, w.message);
    }
  }

  // Registry resolution (Google/URL/file fetches) runs when a consumer is
  // listening via onResolved — typically the LibreOffice preview stager —
  // or when the caller forces materialization because the document has a
  // `visual` to rasterize. Office output never embeds bytes, so skipping
  // fetches when neither applies keeps library callers off the network.
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
      emit('FONT_UNRESOLVED', msg);
    }
  }
  // Fire the side-channel here so callers never have to remember. On the
  // force-materialize path there may be no listener at all — the resolved
  // fonts still flow back through the return value.
  fonts?.onResolved?.(resolved);
  return resolved;
}

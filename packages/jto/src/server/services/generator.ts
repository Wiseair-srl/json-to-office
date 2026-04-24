import type { FormatAdapter } from '../../format-adapter.js';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { cacheEvents } from '../../services/cache-events.js';
import { PluginRegistry } from '../../services/plugin-registry.js';
import {
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  POPULAR_GOOGLE_FONTS,
  getUpstreamOverride,
  isSafeFont,
  type FontRegistryEntry,
  type ResolvedFont,
} from '@json-to-office/shared';

/**
 * Playground-only convenience: scan the document for font names that match
 * a POPULAR_GOOGLE_FONTS family and auto-build `fonts.extraEntries` so the
 * LibreOffice preview stager can materialise the bytes for PDF conversion.
 * The final .docx/.pptx does not embed them — substitution is the default
 * export mode.
 */
export function collectReferencedNames(
  config: unknown,
  customThemes: Record<string, unknown> | undefined,
  adapterName: 'docx' | 'pptx'
): Set<string> {
  const collect =
    adapterName === 'docx'
      ? collectFontNamesFromDocx
      : collectFontNamesFromPptx;
  // Walk the doc AND every supplied custom theme — themes defined in a
  // separate .theme.json file contain font references the doc only names
  // indirectly (via `theme: "myTheme"`).
  const names = new Set<string>();
  for (const n of collect(config)) names.add(n);
  for (const theme of Object.values(customThemes ?? {})) {
    for (const n of collect(theme)) names.add(n);
  }
  return names;
}

/**
 * Walk the doc tree + custom themes for `fontWeight` numeric values. Used
 * to narrow `autoGoogleFontEntries` so cold-cache runs fetch only the
 * weights the doc actually needs instead of 18 faces per Google family.
 */
export function collectReferencedWeights(
  config: unknown,
  customThemes: Record<string, unknown> | undefined
): Set<number> {
  const weights = new Set<number>();
  const visit = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (
          k === 'fontWeight' &&
          typeof v === 'number' &&
          v >= 100 &&
          v <= 900
        ) {
          weights.add(v);
        } else {
          visit(v);
        }
      }
    }
  };
  visit(config);
  for (const theme of Object.values(customThemes ?? {})) visit(theme);
  return weights;
}

/**
 * Walk the doc tree + themes for any `italic: true`. Lets the override
 * variant filter drop italic faces entirely when the doc never uses them
 * (Inter's override is 18 variants — dropping italic halves the instancer
 * cost for upright-only docs).
 */
export function collectReferencedItalic(
  config: unknown,
  customThemes: Record<string, unknown> | undefined
): boolean {
  let found = false;
  const visit = (node: unknown): void => {
    if (found || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'italic' && v === true) {
          found = true;
          return;
        }
        visit(v);
      }
    }
  };
  visit(config);
  if (!found) {
    for (const theme of Object.values(customThemes ?? {})) {
      visit(theme);
      if (found) break;
    }
  }
  return found;
}

export function autoGoogleFontEntries(
  names: Set<string>,
  skipFamilies: Set<string>,
  referencedWeights?: Set<number>,
  referencedItalic?: boolean,
  warnings?: string[]
): FontRegistryEntry[] {
  const googleByLower = new Map(
    POPULAR_GOOGLE_FONTS.map((f) => [f.family.toLowerCase(), f])
  );
  const entries: FontRegistryEntry[] = [];
  for (const name of names) {
    if (isSafeFont(name)) continue;
    if (skipFamilies.has(name.toLowerCase())) continue;
    const match = googleByLower.get(name.toLowerCase());
    if (!match) continue;
    // Prefer an upstream override when one exists — bypasses Google's
    // redistribution for families with known metadata defects (Inter today).
    // Falls back to the Google Fonts CSS endpoint otherwise.
    // Narrow the fetched weight set to what the doc actually references.
    // Cold-cache fetches 1 file per (weight × italic) serially — Inter has
    // 18 faces advertised — so docs that only use 400/700 shouldn't pay
    // for all nine. When the doc references no explicit weights, fall
    // back to 400/700 (Regular + Bold). When it does, fetch those
    // weights (intersected with what the family advertises).
    const wanted = (() => {
      if (!referencedWeights || referencedWeights.size === 0) {
        const filtered = match.weights.filter((w) => w === 400 || w === 700);
        // Pathological catalog entries that advertise neither 400 nor
        // 700 would otherwise return []; fall back to the family's
        // lightest advertised weight (deterministic regardless of
        // catalog ordering) so the Google fetcher gets something
        // reproducible to work with.
        if (filtered.length > 0) return filtered;
        return match.weights.length > 0 ? [Math.min(...match.weights)] : [400];
      }
      const want = new Set<number>([400, ...referencedWeights]);
      const filtered = match.weights.filter((w) => want.has(w));
      return filtered.length > 0 ? filtered : [400];
    })();
    const override = getUpstreamOverride(match.family);
    if (override) {
      // Each override variant is already schema-shaped (kind: 'url' | 'variable'
      // with the right field set). Forward them straight through — the
      // registry's materializeSource switch handles both. Filter by the
      // narrowed weight set so instancing/fetching cost scales with doc
      // usage, not the full 9-weight catalog.
      //
      // The override is the source of truth for which weights exist, NOT
      // the catalog. Rebuild the wanted set from doc-referenced weights
      // directly so a narrow catalog (e.g. advertising only {400,700})
      // doesn't prune out valid override variants (e.g. weight 300).
      const overrideWantedSet = (() => {
        if (!referencedWeights || referencedWeights.size === 0) {
          return new Set<number>([400, 700]);
        }
        return new Set<number>([400, ...referencedWeights]);
      })();
      // Drop italic variants when the doc never requests italic. Halves the
      // instancer/fetch cost for upright-only docs (Inter's override ships 9
      // upright + 9 italic variants).
      const keepItalic = referencedItalic !== false;
      const variants = override.variants.filter(
        (v) => overrideWantedSet.has(v.weight) && (keepItalic || !v.italic)
      );
      let selected = variants;
      if (selected.length === 0) {
        // Referenced weights are all outside this override's advertised
        // variants. Fetching every variant is the legacy fallback; warn
        // so a typo (e.g. `fontWeight: 250`) surfaces instead of silently
        // inflating cold-cache cost.
        const missing = [...overrideWantedSet]
          .filter((w) => !override.variants.some((v) => v.weight === w))
          .sort((a, b) => a - b);
        warnings?.push(
          `FONT_WEIGHT_NOT_IN_OVERRIDE: family "${match.family}" — referenced weight(s) ${missing.join(', ')} not in upstream override (has ${override.variants
            .map((v) => v.weight)
            .filter((w, i, a) => a.indexOf(w) === i)
            .sort((a, b) => a - b)
            .join(', ')}). Fetching all override variants as a fallback.`
        );
        selected = override.variants;
      }
      entries.push({
        id: match.family,
        family: match.family,
        sources: selected.map((v) =>
          v.kind === 'variable'
            ? {
                kind: 'variable' as const,
                url: v.url,
                weight: v.weight,
                italic: v.italic ?? false,
                ...(v.axes ? { axes: v.axes } : {}),
              }
            : {
                kind: 'url' as const,
                url: v.url,
                weight: v.weight,
                italic: v.italic ?? false,
              }
        ),
      });
      continue;
    }
    entries.push({
      id: match.family,
      family: match.family,
      sources: [
        {
          kind: 'google',
          family: match.family,
          weights: wanted,
          // Only request italics when the catalog advertises them. Requesting
          // italics for a family without italic variants (e.g. Inter) makes
          // Google return 404s that surface as `FONT_WEIGHT_UNAVAILABLE`
          // warnings and confuse diagnostics.
          italics: match.hasItalic,
        },
      ],
    });
  }
  return entries;
}

export class GeneratorService {
  private adapter: FormatAdapter;
  private cacheService: CacheService;
  private cacheInvalidationHandler: (() => void) | null = null;

  constructor(adapter: FormatAdapter, cacheService: CacheService) {
    this.adapter = adapter;
    this.cacheService = cacheService;

    this.cacheInvalidationHandler = () => this.cacheService.clear();
    cacheEvents.on('generator:invalidate', this.cacheInvalidationHandler);
  }

  async generate(request: {
    jsonDefinition: any;
    customThemes?: Record<string, any>;
    options?: Record<string, unknown>;
  }): Promise<{
    filename: string;
    fileId?: string;
    buffer: Buffer;
    cached?: boolean;
    warnings?: any[] | null;
    resolvedFonts?: ResolvedFont[];
  }> {
    const { jsonDefinition, customThemes, options } = request;
    const config =
      typeof jsonDefinition === 'string'
        ? JSON.parse(jsonDefinition)
        : jsonDefinition;

    const referencedNames = collectReferencedNames(
      config,
      customThemes,
      this.adapter.name as 'docx' | 'pptx'
    );
    const referencedWeights = collectReferencedWeights(config, customThemes);
    const referencedItalic = collectReferencedItalic(config, customThemes);
    // Caller-supplied extraEntries (e.g. playground user uploads) win over the
    // auto-Google path. Build a skip-set of their family names so
    // `autoGoogleFontEntries` doesn't queue a parallel Google fetch for the
    // same family — which would race the local registration and, in the worst
    // case, override the caller's chosen bytes.
    const callerFonts = (options as { fonts?: Record<string, unknown> })?.fonts;
    const callerExtraEntriesRaw = (callerFonts as { extraEntries?: unknown })
      ?.extraEntries;
    const callerExtraEntries: FontRegistryEntry[] = Array.isArray(
      callerExtraEntriesRaw
    )
      ? (callerExtraEntriesRaw as FontRegistryEntry[])
      : [];
    const callerStrict =
      typeof (callerFonts as { strict?: unknown })?.strict === 'boolean'
        ? (callerFonts as { strict: boolean }).strict
        : undefined;
    const rawMode = callerFonts?.mode;
    const fontMode: 'substitute' | 'custom' | undefined =
      rawMode === 'substitute' || rawMode === 'custom' ? rawMode : undefined;
    const rawSub = callerFonts?.substitution;
    const fontSubstitution =
      rawSub && typeof rawSub === 'object' && !Array.isArray(rawSub)
        ? (rawSub as Record<string, string>)
        : undefined;
    const callerFamilies = new Set(
      callerExtraEntries.map((e) => e.family.toLowerCase())
    );
    // In substitute mode the doc's non-safe families are rewritten to safe
    // equivalents before font resolution runs, so an auto-Google fetch for
    // them is wasted work and — via `bypassCache` below — would disable the
    // server buffer cache for no benefit. Skip it.
    const overrideWarnings: string[] = [];
    const autoEntries =
      fontMode === 'substitute'
        ? []
        : autoGoogleFontEntries(
            referencedNames,
            callerFamilies,
            referencedWeights,
            referencedItalic,
            overrideWarnings
          );
    const extraEntries = [...callerExtraEntries, ...autoEntries];
    // Surface the override so the caller can see their local file won vs a
    // would-be Google fetch. Collected later into the `warnings` array.
    if (callerExtraEntries.length > 0) {
      const googleFamiliesLower = new Set(
        POPULAR_GOOGLE_FONTS.map((f) => f.family.toLowerCase())
      );
      for (const e of callerExtraEntries) {
        const lower = e.family.toLowerCase();
        if (googleFamiliesLower.has(lower) && referencedNames.has(e.family)) {
          overrideWarnings.push(
            `[FONT_OVERRIDE_LOCAL] ${e.family}: caller-supplied source used; Google Fonts auto-fetch skipped for this family.`
          );
        }
      }
    }
    // Font resolution produces a side-channel (`resolvedFonts`) consumed by the
    // LibreOffice preview stager. The byte-cache can't round-trip that, so skip
    // the cache when auto-font resolution is needed — otherwise a cached buffer
    // returns without the TTFs the previewer needs.
    const bypassCache =
      options?.bypassCache === true || extraEntries.length > 0;
    // Include font runtime selectors in the cache key so substitute vs
    // custom runs (same config+themes) don't collide on a single buffer
    // slot. `extraEntries` already forces bypassCache, so only need
    // mode/substitution/strict in the key for the non-bypass path.
    const cacheKeyData = {
      config,
      customThemes:
        customThemes && Object.keys(customThemes).length > 0
          ? customThemes
          : null,
      fontMode: fontMode ?? null,
      fontSubstitution: fontSubstitution ?? null,
      fontStrict: callerStrict ?? null,
    };
    const cacheKey = this.cacheService.generateCacheKey(cacheKeyData);
    const hasDynamicContent = this.cacheService.hasDynamicContent(config);

    // Try cache
    if (!bypassCache && !hasDynamicContent) {
      const cachedBuffer = this.cacheService.get(cacheKey);
      if (cachedBuffer) {
        logger.info('Served from cache', { title: config.metadata?.title });
        return {
          filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
          fileId: Date.now().toString(),
          buffer: cachedBuffer,
          cached: true,
          warnings: null,
        };
      }
    }

    // Generate — use plugin-aware generator when plugins are loaded
    logger.info(`Generating ${this.adapter.label}`, {
      title: config.metadata?.title,
    });
    const registry = PluginRegistry.getInstance();
    let buffer: Buffer;

    const resolvedFonts: ResolvedFont[] = [];
    // Forward fonts.mode + fonts.substitution + fonts.strict from the
    // request body so API consumers can opt into substitution, custom
    // (as-is), or strict-validation behaviour. Embedding is no longer
    // supported. `extraEntries` is authoritative in this flow:
    // caller-supplied entries were merged with auto-Google entries above
    // and are passed down unified here.
    const needsFontOpts =
      extraEntries.length > 0 ||
      fontMode !== undefined ||
      fontSubstitution !== undefined ||
      callerStrict !== undefined;
    const fontOpts = needsFontOpts
      ? {
          ...(extraEntries.length > 0 && { extraEntries }),
          ...(fontMode && { mode: fontMode }),
          ...(fontSubstitution && { substitution: fontSubstitution }),
          ...(callerStrict !== undefined && { strict: callerStrict }),
          onResolved: (r: ResolvedFont[]) => {
            resolvedFonts.push(...r);
          },
        }
      : undefined;

    if (registry.hasPlugins()) {
      const plugins = registry.getPlugins();
      const generator = await this.adapter.createGenerator(plugins, {
        customThemes,
        fonts: fontOpts,
      });
      buffer = await generator.generateBuffer(config);
    } else {
      buffer = await this.adapter.generateBuffer(config, {
        customThemes,
        fonts: fontOpts,
      });
    }

    // Store in cache
    this.cacheService.set(cacheKey, buffer, config, {
      bypassCache: bypassCache || hasDynamicContent,
    });

    // Surface non-canonical fontWeight values (e.g. 450, 550) — the render
    // path silently coerces these to Regular/Bold via a bold-fallback, so
    // without a warning an author writing `fontWeight: 450` has no way to
    // know their intermediate weight was rounded away.
    const CANONICAL_WEIGHTS = new Set([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ]);
    const nonCanonical = [...referencedWeights].filter(
      (w) => !CANONICAL_WEIGHTS.has(w)
    );
    const extraWarnings = overrideWarnings.map((message) => ({
      component: 'fontRegistry',
      message,
      severity: 'info' as const,
      context: { code: 'FONT_OVERRIDE_LOCAL' },
    }));
    for (const w of nonCanonical) {
      extraWarnings.push({
        component: 'fontRegistry',
        message: `[FONT_NONCANONICAL_WEIGHT] fontWeight ${w} is not one of 100/200/.../900; render path rounds to Regular or Bold via bold-only fallback.`,
        severity: 'info' as const,
        context: { code: 'FONT_NONCANONICAL_WEIGHT' },
      });
    }

    return {
      filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
      fileId: Date.now().toString(),
      buffer,
      cached: false,
      warnings: extraWarnings.length > 0 ? extraWarnings : null,
      resolvedFonts,
    };
  }

  async validate(
    jsonDefinition: any
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const config =
      typeof jsonDefinition === 'string'
        ? JSON.parse(jsonDefinition)
        : jsonDefinition;

    return this.adapter.validateDocument(config);
  }

  destroy(): void {
    if (this.cacheInvalidationHandler) {
      cacheEvents.off('generator:invalidate', this.cacheInvalidationHandler);
      this.cacheInvalidationHandler = null;
    }
    this.cacheService.clear();
  }
}

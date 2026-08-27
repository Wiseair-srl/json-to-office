import {
  type FormatAdapter,
  type GeneratorOptions,
  cacheEvents,
  PluginRegistry,
} from '@json-to-office/jto-cli';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import {
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  POPULAR_GOOGLE_FONTS,
  getUpstreamOverride,
  isSafeFont,
  documentFontRegistry,
  themeFontRegistry,
  type FontRegistryEntry,
  type ResolvedFont,
  type GenerationWarning,
} from '@json-to-office/shared';
import {
  QualityGateError,
  type QualityAnalysis,
  type QualityDiagnostic,
} from '@json-to-office/quality';

function toQualityWarnings(
  diagnostics: readonly QualityDiagnostic[]
): GenerationWarning[] {
  return diagnostics.map((finding) => ({
    component: 'quality',
    message: `[${finding.code}] ${finding.message}`,
    severity: finding.severity === 'info' ? 'info' : 'warning',
    context: {
      ...(finding.context ?? {}),
      code: finding.code,
      path: finding.path,
      originalSeverity: finding.severity,
      ...(finding.ruleId && { ruleId: finding.ruleId }),
      ...(finding.category && { category: finding.category }),
      ...(finding.certainty && { certainty: finding.certainty }),
      blocking: finding.blocking,
      ...(finding.suggestion && { suggestion: finding.suggestion }),
      ...(finding.relatedPaths && { relatedPaths: finding.relatedPaths }),
      ...(finding.evidence && { evidence: finding.evidence }),
      ...(finding.fixes && { fixes: finding.fixes }),
    },
  }));
}

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

/**
 * A service-local warning carrying its OWN code. This used to be a bare
 * string and the code was hardcoded at the mapping site, so every message in
 * the array — including `FONT_WEIGHT_NOT_IN_OVERRIDE` — was published to
 * clients as `context.code === 'FONT_OVERRIDE_LOCAL'`, and any client
 * filtering on the code misclassified it.
 */
export interface SupplementalFontWarning {
  code: string;
  message: string;
}

/**
 * Turn service-local font warnings into the client-facing shape, preserving
 * each entry's own code. Informational: unlike core's `FONT_UNRESOLVED`,
 * none of these mean the document failed to resolve something.
 */
export function toSupplementalWarnings(
  warnings: readonly SupplementalFontWarning[]
): GenerationWarning[] {
  return warnings.map(({ code, message }) => ({
    component: 'fontRegistry',
    message,
    severity: 'info' as const,
    context: { code },
  }));
}

export function autoGoogleFontEntries(
  names: Set<string>,
  skipFamilies: Set<string>,
  referencedWeights?: Set<number>,
  referencedItalic?: boolean,
  warnings?: SupplementalFontWarning[]
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
        warnings?.push({
          code: 'FONT_WEIGHT_NOT_IN_OVERRIDE',
          message: `FONT_WEIGHT_NOT_IN_OVERRIDE: family "${match.family}" — referenced weight(s) ${missing.join(', ')} not in upstream override (has ${override.variants
            .map((v) => v.weight)
            .filter((w, i, a) => a.indexOf(w) === i)
            .sort((a, b) => a - b)
            .join(', ')}). Fetching all override variants as a fallback.`,
        });
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
    warnings?: GenerationWarning[] | null;
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
    // Families already declared by the caller, the document, or a theme. Any
    // of them outranks an auto-Google fetch, and `extraEntries` — where the
    // auto entries land — is the HIGHEST precedence group in the merge, so
    // omitting the document/theme families here would let Google's bytes
    // silently replace the ones the document ships with.
    const declaredFamilies = [
      ...callerExtraEntries,
      ...documentFontRegistry(config),
      ...Object.values(customThemes ?? {}).flatMap((t) => themeFontRegistry(t)),
    ];
    const callerFamilies = new Set(
      declaredFamilies.map((e) => e.family.toLowerCase())
    );
    // In substitute mode the doc's non-safe families are rewritten to safe
    // equivalents before font resolution runs, so an auto-Google fetch for
    // them is wasted work and — via `bypassCache` below — would disable the
    // server buffer cache for no benefit. Skip it.
    const overrideWarnings: SupplementalFontWarning[] = [];
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
          overrideWarnings.push({
            code: 'FONT_OVERRIDE_LOCAL',
            message: `[FONT_OVERRIDE_LOCAL] ${e.family}: caller-supplied source used; Google Fonts auto-fetch skipped for this family.`,
          });
        }
      }
    }
    // A document- or theme-declared registry is the third thing that makes
    // font resolution meaningful, alongside caller entries and the export-mode
    // selectors. Computed here rather than next to `fontOpts` because
    // `bypassCache` below has to see it.
    const declaresRegistry =
      documentFontRegistry(config).length > 0 ||
      Object.values(customThemes ?? {}).some(
        (t) => themeFontRegistry(t).length > 0
      );
    // Font resolution produces a side-channel (`resolvedFonts`) consumed by the
    // LibreOffice preview stager. The byte-cache can't round-trip that, so skip
    // the cache when auto-font resolution is needed — otherwise a cached buffer
    // returns without the TTFs the previewer needs. A declared registry counts:
    // its bytes are exactly what the stager would otherwise be missing.
    const bypassCache =
      options?.bypassCache === true ||
      extraEntries.length > 0 ||
      declaresRegistry;
    // Include font runtime selectors in the cache key so substitute vs
    // custom runs (same config+themes) don't collide on a single buffer
    // slot. `extraEntries` already forces bypassCache, so only need
    // mode/substitution/strict in the key for the non-bypass path.
    const baseDir =
      typeof (options as { baseDir?: unknown } | undefined)?.baseDir ===
      'string'
        ? (options as { baseDir: string }).baseDir
        : undefined;
    // The backend is chosen per request, not per server: the playground's
    // point is comparing two of them on the same document.
    const renderer =
      typeof (options as { renderer?: unknown } | undefined)?.renderer ===
      'string'
        ? (options as { renderer: string }).renderer
        : undefined;
    const resolvedFonts: ResolvedFont[] = [];
    const coreWarnings: GenerationWarning[] = [];
    const needsFontOpts =
      extraEntries.length > 0 ||
      declaresRegistry ||
      fontMode !== undefined ||
      fontSubstitution !== undefined ||
      callerStrict !== undefined;
    const fontOpts = needsFontOpts
      ? {
          ...(extraEntries.length > 0 && { extraEntries }),
          ...(fontMode && { mode: fontMode }),
          ...(fontSubstitution && { substitution: fontSubstitution }),
          ...(callerStrict !== undefined && { strict: callerStrict }),
          onResolved: (resolved: ResolvedFont[]) => {
            resolvedFonts.push(...resolved);
          },
        }
      : undefined;
    const registry = PluginRegistry.getInstance();
    const quality = (options as { quality?: GeneratorOptions['quality'] })
      ?.quality;
    const prepared =
      !registry.hasPlugins() &&
      this.adapter.prepareDocument &&
      this.adapter.validateDocument(config).valid
        ? await this.adapter.prepareDocument(config, {
            customThemes,
            fonts: fontOpts,
            baseDir,
            renderer,
            warnings: coreWarnings,
          })
        : undefined;
    const qualityOptions: GeneratorOptions = {
      customThemes,
      fonts: fontOpts,
      baseDir,
      renderer,
      quality,
      prepared,
    };
    let qualityWarnings: GenerationWarning[] = [];
    try {
      if (this.adapter.analyzeQuality) {
        const analysis = await this.adapter.analyzeQuality(
          config,
          qualityOptions
        );
        if (analysis.blocked) throw new QualityGateError(analysis);
        qualityWarnings = toQualityWarnings(analysis.diagnostics);
      }
    } catch (error) {
      const errorCode = (error as { code?: unknown } | undefined)?.code;
      if (
        errorCode === 'QUALITY_GATE_FAILED' ||
        errorCode === 'QUALITY_PROFILE_INCOMPATIBLE' ||
        // An unusable policy is the caller's configuration, not a hiccup.
        errorCode === 'QUALITY_POLICY_INVALID' ||
        quality?.policy?.onRuleError === 'throw' ||
        // A caller who asked for a gate must not receive an ungated document:
        // if the analysis failed, the gate never ran. Only the advisory case
        // (no gate requested) degrades to a warning.
        (quality?.policy?.gate && quality.policy.gate !== 'none')
      ) {
        throw error;
      }
      logger.warn('Quality analysis failed', { error });
    }
    const cacheKeyData = {
      config,
      customThemes:
        customThemes && Object.keys(customThemes).length > 0
          ? customThemes
          : null,
      fontMode: fontMode ?? null,
      fontSubstitution: fontSubstitution ?? null,
      fontStrict: callerStrict ?? null,
      // Same definition, different source directory → different local assets.
      baseDir: baseDir ?? null,
      // Same document, different backend → different bytes. Without this,
      // switching backends would serve the other one's cached buffer.
      renderer: renderer ?? null,
    };
    const cacheKey = this.cacheService.generateCacheKey(cacheKeyData);
    const hasDynamicContent = this.cacheService.hasDynamicContent(config);

    // Try cache
    if (!bypassCache && !hasDynamicContent) {
      const cached = this.cacheService.get(cacheKey);
      if (cached) {
        logger.info('Served from cache', { title: config.metadata?.title });
        return {
          filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
          fileId: Date.now().toString(),
          buffer: cached.buffer,
          // Render warnings ride with bytes. Quality is request policy, so it
          // is recomputed and merged even when the rendered artifact is cached.
          cached: true,
          warnings:
            cached.warnings || qualityWarnings.length > 0
              ? [...(cached.warnings ?? []), ...qualityWarnings]
              : null,
        };
      }
    }

    // Generate — use plugin-aware generator when plugins are loaded
    logger.info(`Generating ${this.adapter.label}`, {
      title: config.metadata?.title,
    });
    let buffer: Buffer;

    if (registry.hasPlugins()) {
      const plugins = registry.getPlugins();
      const generator = await this.adapter.createGenerator(plugins, {
        customThemes,
        fonts: fontOpts,
        baseDir,
        renderer,
        warnings: coreWarnings,
        quality,
      });
      buffer = await generator.generateBuffer(config);
    } else {
      buffer = await this.adapter.generateBuffer(config, {
        customThemes,
        fonts: fontOpts,
        baseDir,
        renderer,
        warnings: coreWarnings,
        quality,
        prepared,
      });
    }

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
    // Each entry keeps its own code: this array mixes FONT_OVERRIDE_LOCAL and
    // FONT_WEIGHT_NOT_IN_OVERRIDE, and clients filter on `context.code`.
    const extraWarnings: GenerationWarning[] =
      toSupplementalWarnings(overrideWarnings);
    for (const w of nonCanonical) {
      extraWarnings.push({
        component: 'fontRegistry',
        message: `[FONT_NONCANONICAL_WEIGHT] fontWeight ${w} is not one of 100/200/.../900; render path rounds to Regular or Bold via bold-only fallback.`,
        severity: 'info' as const,
        context: { code: 'FONT_NONCANONICAL_WEIGHT' },
      });
    }

    // Core first: FONT_UNRESOLVED is actionable and should read above the
    // informational FONT_OVERRIDE_LOCAL / FONT_NONCANONICAL_WEIGHT entries.
    const renderWarnings = [...coreWarnings, ...extraWarnings];
    const allWarnings = [...renderWarnings, ...qualityWarnings];

    // Cache renderer output only. Quality depends on request policy/profile
    // and is recomputed before every HIT. `resolvedFonts` stays out: it is a
    // TTF byte side-channel whose consumer passes `bypassCache: true`.
    this.cacheService.set(
      cacheKey,
      {
        buffer,
        warnings: renderWarnings.length > 0 ? renderWarnings : null,
      },
      config,
      { bypassCache: bypassCache || hasDynamicContent }
    );

    return {
      filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
      fileId: Date.now().toString(),
      buffer,
      cached: false,
      warnings: allWarnings.length > 0 ? allWarnings : null,
      resolvedFonts,
    };
  }

  async validate(
    jsonDefinition: any,
    options: GeneratorOptions = {}
  ): Promise<{
    valid: boolean;
    errors?: any[];
    qualityAnalysis?: QualityAnalysis;
  }> {
    const config =
      typeof jsonDefinition === 'string'
        ? JSON.parse(jsonDefinition)
        : jsonDefinition;

    const result = this.adapter.validateDocument(config);
    if (!result.valid) return result;
    if (this.adapter.analyzeQuality) {
      try {
        const prepared = this.adapter.prepareDocument
          ? await this.adapter.prepareDocument(config, options)
          : undefined;
        const qualityAnalysis = await this.adapter.analyzeQuality(
          config,
          prepared ? { ...options, prepared } : options
        );
        return {
          ...result,
          valid: result.valid && !qualityAnalysis.blocked,
          qualityAnalysis,
        };
      } catch (error) {
        const errorCode = (error as { code?: unknown } | undefined)?.code;
        if (
          errorCode === 'QUALITY_GATE_FAILED' ||
          errorCode === 'QUALITY_PROFILE_INCOMPATIBLE' ||
          errorCode === 'QUALITY_POLICY_INVALID'
        ) {
          throw error;
        }
        // Reporting a malformed document is what this endpoint is for: a
        // preparation that chokes on it must degrade to "no quality
        // analysis", not bury the schema errors under a 500.
        logger.warn('Quality analysis failed', { error });
      }
    }
    return result;
  }

  destroy(): void {
    if (this.cacheInvalidationHandler) {
      cacheEvents.off('generator:invalidate', this.cacheInvalidationHandler);
      this.cacheInvalidationHandler = null;
    }
    this.cacheService.clear();
  }
}

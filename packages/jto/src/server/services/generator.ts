import type { FormatAdapter } from '../../format-adapter.js';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { cacheEvents } from '../../services/cache-events.js';
import { PluginRegistry } from '../../services/plugin-registry.js';
import {
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  POPULAR_GOOGLE_FONTS,
  isSafeFont,
  type FontRegistryEntry,
  type ResolvedFont,
} from '@json-to-office/shared';

/**
 * Shape of each entry sent by the playground's Upload tab on every generate.
 * The client reads these from IndexedDB and base64-encodes the bytes; the
 * server only embeds those whose family is actually referenced by the doc.
 */
export interface UserFontPayload {
  family: string;
  weight: number;
  italic: boolean;
  format: 'ttf' | 'otf';
  /** Base64-encoded font bytes. */
  data: string;
}

/**
 * Playground-only convenience: scan the document for font names that match
 * a POPULAR_GOOGLE_FONTS family and auto-build `fonts.extraEntries` so the
 * preview embeds them without the user writing registration code.
 *
 * Production consumers call the generator library directly and must register
 * their own fonts via `options.fonts.extraEntries`.
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

export function autoGoogleFontEntries(
  names: Set<string>,
  skipFamilies: Set<string>
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
    entries.push({
      id: match.family,
      family: match.family,
      sources: [
        {
          kind: 'google',
          family: match.family,
          weights: [400, 700].filter((w) => match.weights.includes(w)),
          // Fetch italic faces so italic runs don't render faux-italic in
          // the LibreOffice preview PDF.
          italics: true,
        },
      ],
    });
  }
  return entries;
}

/**
 * Build FontRegistryEntry[] from the playground's Upload tab payloads,
 * restricted to families the doc actually references. Each variant becomes
 * a `kind: 'data'` source pointing at a base64 data URL the font resolver
 * materialises into bytes.
 */
export function userFontEntries(
  userFonts: UserFontPayload[] | undefined,
  referencedNames: Set<string>
): FontRegistryEntry[] {
  if (!userFonts || userFonts.length === 0) return [];
  const referencedLower = new Set(
    [...referencedNames].map((n) => n.toLowerCase())
  );
  const byFamily = new Map<string, FontRegistryEntry>();
  for (const uf of userFonts) {
    if (!referencedLower.has(uf.family.toLowerCase())) continue;
    const source = {
      kind: 'data' as const,
      data: `data:font/${uf.format};base64,${uf.data}`,
      weight: uf.weight,
      italic: uf.italic,
    };
    const existing = byFamily.get(uf.family);
    if (existing) {
      existing.sources.push(source);
    } else {
      byFamily.set(uf.family, {
        id: uf.family,
        family: uf.family,
        sources: [source],
      });
    }
  }
  return [...byFamily.values()];
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
    userFonts?: UserFontPayload[];
    options?: Record<string, unknown>;
  }): Promise<{
    filename: string;
    fileId?: string;
    buffer: Buffer;
    cached?: boolean;
    warnings?: any[] | null;
    resolvedFonts?: ResolvedFont[];
  }> {
    const { jsonDefinition, customThemes, userFonts, options } = request;
    const config =
      typeof jsonDefinition === 'string'
        ? JSON.parse(jsonDefinition)
        : jsonDefinition;

    const referencedNames = collectReferencedNames(
      config,
      customThemes,
      this.adapter.name as 'docx' | 'pptx'
    );
    // User-uploaded fonts take precedence over auto-google lookup: if a user
    // uploaded "Inter", we embed their bytes rather than fetching from Google.
    const userEntries = userFontEntries(userFonts, referencedNames);
    const userFamiliesLower = new Set(
      userEntries.map((e) => e.family.toLowerCase())
    );
    const googleEntries = autoGoogleFontEntries(
      referencedNames,
      userFamiliesLower
    );
    const extraEntries = [...userEntries, ...googleEntries];
    // Font resolution produces a side-channel (`resolvedFonts`) consumed by the
    // LibreOffice preview stager. The byte-cache can't round-trip that, so skip
    // the cache when auto-font resolution is needed — otherwise a cached buffer
    // returns without the TTFs the previewer needs.
    const bypassCache =
      options?.bypassCache === true || extraEntries.length > 0;
    const cacheKeyData = {
      config,
      customThemes:
        customThemes && Object.keys(customThemes).length > 0
          ? customThemes
          : null,
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
    const fontOpts =
      extraEntries.length > 0
        ? {
            extraEntries,
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

    return {
      filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
      fileId: Date.now().toString(),
      buffer,
      cached: false,
      warnings: null,
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

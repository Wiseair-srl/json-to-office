/**
 * FontRegistry — merges catalog + document registry + runtime entries
 * and materializes referenced fonts into ResolvedFont records.
 *
 * Resolution rules, in order per referenced name:
 * 1. Registry match (by family or id, case-insensitive). Runtime entries win
 *    on collision with document entries. Materialize each source:
 *       - safe   → { willEmbed: false } (no data loaded)
 *       - file   → read Buffer from disk
 *       - data   → decode base64
 *       - google → skipped at P2; warning emitted until P4 fetcher ships
 * 2. SAFE_FONTS membership → { willEmbed: false }
 * 3. Otherwise → { willEmbed: false } with FONT_UNRESOLVED warning
 */

import { isSafeFont } from '../schemas/font-catalog';
import type { FontRegistryEntry, FontSource } from '../schemas/font-catalog';
import type {
  FontRuntimeOpts,
  ResolvedFont,
  ResolvedFontSource,
} from './types';
import { loadDataFontSource } from './sources/data-loader';
import { fetchGoogleFontSources } from './sources/google-fetcher';
import { FontMemoryCache } from './cache/memory-cache';

/**
 * Minimal interface the registry needs from a disk cache. The concrete
 * implementation ships in `./cache/disk-cache` but is Node-only (uses fs/crypto).
 * Callers on Node inject an instance; browser callers pass nothing.
 */
export interface FontDiskCacheLike {
  get(key: string): Promise<Buffer | undefined>;
  set(key: string, value: Buffer): Promise<void>;
}

/**
 * Minimal interface for a file-loader. Same reasoning as FontDiskCacheLike:
 * concrete impl is Node-only, callers inject when on Node.
 */
export type FontFileLoader = (input: {
  path: string;
  weight?: number;
  italic?: boolean;
  baseDir?: string;
}) => Promise<ResolvedFontSource>;

export interface FontRegistryInput {
  /** Runtime options — entries come from opts.extraEntries. */
  opts?: FontRuntimeOpts;
  /** Optional disk cache (Node only). Pass an instance of FontDiskCache. */
  diskCache?: FontDiskCacheLike;
  /**
   * Optional `kind: "file"` loader (Node only). Inject `loadFileFontSource`
   * from `@json-to-office/shared/fonts/sources/file-loader` on Node. Browser
   * callers pass nothing; `kind: "file"` sources then warn and skip.
   */
  fileLoader?: FontFileLoader;
}

export class FontRegistry {
  private readonly index: Map<string, FontRegistryEntry>;
  private readonly cache: Map<string, ResolvedFont>;
  private readonly opts: FontRuntimeOpts;
  private readonly memoryCache: FontMemoryCache;
  private readonly diskCache: FontDiskCacheLike | undefined;
  private readonly fileLoader: FontFileLoader | undefined;

  constructor(input: FontRegistryInput = {}) {
    this.opts = input.opts ?? {};
    this.index = new Map();
    this.cache = new Map();
    this.memoryCache = new FontMemoryCache();
    this.diskCache = input.diskCache;
    this.fileLoader = input.fileLoader;

    for (const e of this.opts.extraEntries ?? []) this.addEntry(e);
  }

  private addEntry(entry: FontRegistryEntry): void {
    this.index.set(entry.family.toLowerCase(), entry);
    this.index.set(entry.id.toLowerCase(), entry);
  }

  /** Resolve every referenced name in one pass. Order preserved. */
  async resolveMany(names: Iterable<string>): Promise<ResolvedFont[]> {
    const out: ResolvedFont[] = [];
    for (const n of names) out.push(await this.resolve(n));
    return out;
  }

  async resolve(name: string): Promise<ResolvedFont> {
    const key = name.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const entry = this.index.get(key);
    let result: ResolvedFont;

    if (entry) {
      result = await this.materializeEntry(entry);
    } else if (isSafeFont(name)) {
      result = { family: name, willEmbed: false, sources: [], warnings: [] };
    } else {
      result = {
        family: name,
        willEmbed: false,
        sources: [],
        warnings: [
          `Font "${name}" is not registered and not in SAFE_FONTS; will rely on host fallback.`,
        ],
      };
    }
    this.cache.set(key, result);
    return result;
  }

  private async materializeEntry(
    entry: FontRegistryEntry
  ): Promise<ResolvedFont> {
    const sources: ResolvedFontSource[] = [];
    const warnings: string[] = [];

    for (const source of entry.sources) {
      try {
        const materialized = await this.materializeSource(source, warnings);
        sources.push(...materialized);
      } catch (err) {
        warnings.push(
          `Font "${entry.family}" source (${source.kind}) failed: ${
            (err as Error).message
          }`
        );
      }
    }

    // If nothing materialized but a fallback is defined, degrade gracefully.
    if (sources.length === 0 && entry.fallback) {
      warnings.push(
        `Font "${entry.family}" has no resolvable sources; using fallback "${entry.fallback}".`
      );
    }

    return {
      family: entry.family,
      willEmbed: sources.length > 0,
      sources,
      warnings,
    };
  }

  private async materializeSource(
    source: FontSource,
    warnings: string[]
  ): Promise<ResolvedFontSource[]> {
    switch (source.kind) {
      case 'safe':
        // System-installed; no embedding data.
        return [];
      case 'file': {
        if (!this.fileLoader) {
          warnings.push(
            `kind:"file" source for "${source.path}" requires a fileLoader (Node-only); skipping.`
          );
          return [];
        }
        return [
          await this.fileLoader({
            path: source.path,
            weight: source.weight,
            italic: source.italic,
            baseDir: this.opts.baseDir,
          }),
        ];
      }
      case 'data':
        return [
          loadDataFontSource({
            data: source.data,
            weight: source.weight,
            italic: source.italic,
          }),
        ];
      case 'google': {
        const gf = this.opts.googleFonts;
        if (gf?.enabled === false) {
          warnings.push(
            `Google Fonts fetch disabled — skipping "${source.family}".`
          );
          return [];
        }
        const { sources: fetched, warnings: fetchWarnings } =
          await fetchGoogleFontSources({
            family: source.family,
            weights: source.weights ?? [400, 700],
            italics: source.italics ?? false,
            memoryCache: this.memoryCache,
            diskCache: this.diskCache,
            fetchTimeoutMs: gf?.fetchTimeoutMs,
          });
        warnings.push(...fetchWarnings);
        return fetched;
      }
      default:
        // Exhaustiveness guard — new kind added to schema without handler
        throw new Error(
          `Unknown font source kind: ${(source as { kind: string }).kind}`
        );
    }
  }
}

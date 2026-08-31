/**
 * FontRegistry — merges catalog + document registry + runtime entries
 * and materializes referenced fonts into ResolvedFont records.
 *
 * Resolution rules, per referenced name:
 * 1. Registry match (by family or id, case-insensitive). Runtime entries win
 *    on collision with document entries. Materialize each source.
 * 2. SAFE_FONTS membership → empty sources.
 * 3. Otherwise → empty sources with FONT_UNRESOLVED warning.
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
import { fetchUrlFontSource } from './sources/url-fetcher';
import { validateFontMetadata } from './sources/ttf-validate';
import { validateFontStructure } from './sources/ttf-structure';
import {
  readFontFamilyNames,
  rewriteFontFamilyName,
  standardSubfamilyNames,
} from './sources/ttf-name';
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

/**
 * Minimal interface for the variable-font fetcher. `subset-font` (the
 * harfbuzz-wasm wrapper we use for axis pinning) reaches for `fs` at
 * init time, which crashes in the browser. Injection keeps that import
 * behind the Node-only subpath; browser bundles never pull it in, and
 * browser callers simply won't see `kind: 'variable'` fonts resolved
 * (the registry warns and skips instead).
 */
export type FontVariableLoader = (input: {
  url: string;
  weight: number;
  italic: boolean;
  axes?: Record<string, number>;
  fetchTimeoutMs?: number;
  memoryCache?: {
    get(key: string): Buffer | undefined;
    set(key: string, value: Buffer): void;
  };
  diskCache?: {
    get(key: string): Promise<Buffer | undefined>;
    set(key: string, value: Buffer): Promise<void>;
  };
}) => Promise<{ source?: ResolvedFontSource; warnings?: string[] }>;

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
  /**
   * Optional `kind: "variable"` loader (Node only). Inject
   * `fetchVariableFontSource` from `@json-to-office/shared/fonts/node` on
   * Node. Browser callers pass nothing; `kind: "variable"` sources then
   * warn and skip. Keeping this injected avoids dragging subset-font (and
   * its `fs.promises.readFile` bootstrap) into client bundles.
   */
  variableLoader?: FontVariableLoader;
}

/**
 * Make the bytes declare the family they were resolved as.
 *
 * `ResolvedFont.family` is a claim about the bytes that every consumer
 * relies on and that nothing used to enforce. A host — Core Text,
 * fontconfig, GDI — finds a face by the family in its `name` table, never
 * by the registry entry or the filename, so a source whose name table says
 * something else is unreachable from the runs that reference it. It fails
 * silently: on a machine that happens to have the real family installed the
 * reference lands there instead, and only a host without it (a container,
 * a colleague's laptop) shows the fallback.
 *
 * The case that forced this: Inter resolves through an upstream override
 * that instances `InterVariable.ttf` per weight, and harfbuzz keeps the
 * master's name table — so every instance called itself "Inter Variable".
 * The weighted faces were saved by the preview stager renaming them to
 * "Inter Medium" / "Inter SemiBold" on the way out; weights 400 and 700
 * kept the family name unchanged (they ride the run's bold/italic toggles
 * instead), so those alone were staged under a name no run asks for.
 *
 * Matching on ANY declared name (family or typographic family) keeps a
 * legitimately-named static untouched: LifeSans-Medium.ttf registered as
 * "Life Sans" already answers to it via nameID 16, even though nameID 1
 * says "Life Sans Medium". Only bytes that answer to nothing get rewritten.
 */
function stampResolvedFamily(
  source: ResolvedFontSource,
  family: string
): ResolvedFontSource {
  if (source.format !== 'ttf' && source.format !== 'otf') return source;
  const declared = readFontFamilyNames(source.data);
  // Nothing declared: no claim to contradict, and nothing to repair against.
  if (declared.length === 0 || declared.includes(family)) return source;
  // The style this face occupies within `family`. The family IDs become
  // `family` for all four RIBBI faces, so full/PostScript names have to
  // carry the style or roman and italic collide on both.
  const subfamily = standardSubfamilyNames(
    source.weight,
    source.italic
  )?.legacy;
  return {
    ...source,
    data: rewriteFontFamilyName(source.data, family, subfamily),
  };
}

export class FontRegistry {
  private readonly index: Map<string, FontRegistryEntry>;
  private readonly cache: Map<string, ResolvedFont>;
  private readonly opts: FontRuntimeOpts;
  private readonly memoryCache: FontMemoryCache;
  private readonly diskCache: FontDiskCacheLike | undefined;
  private readonly fileLoader: FontFileLoader | undefined;
  private readonly variableLoader: FontVariableLoader | undefined;

  constructor(input: FontRegistryInput = {}) {
    this.opts = input.opts ?? {};
    this.index = new Map();
    this.cache = new Map();
    this.memoryCache = new FontMemoryCache();
    this.diskCache = input.diskCache;
    this.fileLoader = input.fileLoader;
    this.variableLoader = input.variableLoader;

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
      result = { family: name, sources: [], warnings: [] };
    } else {
      result = {
        family: name,
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
        for (const raw of materialized) {
          const sfnt = raw.format === 'ttf' || raw.format === 'otf';
          // Can a font system load these bytes at all? Asked first, and on
          // failure asked instead of everything below: the stamp has no name
          // table to write into and the metadata checks no records to read,
          // so both would quietly do nothing and report nothing. The source
          // is still returned — this diagnoses the file, it doesn't decide
          // for the caller whether to ship it.
          const broken = sfnt
            ? validateFontStructure(
                raw.data,
                raw.weight,
                raw.italic,
                entry.family
              )
            : null;
          if (broken) {
            warnings.push(`[${broken.code}] ${broken.message}`);
            sources.push(raw);
            continue;
          }
          const s = stampResolvedFamily(raw, entry.family);
          if (sfnt) {
            for (const d of validateFontMetadata(
              s.data,
              s.weight,
              s.italic,
              entry.family
            )) {
              warnings.push(`[FONT_METADATA_DEFECT:${d.code}] ${d.message}`);
            }
          }
          sources.push(s);
        }
      } catch (err) {
        warnings.push(
          `Font "${entry.family}" source (${source.kind}) failed: ${
            (err as Error).message
          }`
        );
      }
    }

    return {
      family: entry.family,
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
      case 'url': {
        const gf = this.opts.googleFonts;
        const { source: fetched, warnings: fetchWarnings } =
          await fetchUrlFontSource({
            url: source.url,
            weight: source.weight ?? 400,
            italic: source.italic ?? false,
            memoryCache: this.memoryCache,
            diskCache: this.diskCache,
            fetchTimeoutMs: gf?.fetchTimeoutMs,
          });
        if (fetchWarnings) warnings.push(...fetchWarnings);
        return fetched ? [fetched] : [];
      }
      case 'variable': {
        // Variable-font instancing: fetch the variable TTF once (disk-
        // cached), then harfbuzz-pin the `wght` axis to produce a clean
        // static for this weight. Requires a Node-injected loader because
        // `subset-font` pulls in `fs` at init; without it, browser
        // bundles would break. Callers on Node pass `fetchVariableFontSource`
        // from `@json-to-office/shared/fonts/node`.
        if (!this.variableLoader) {
          warnings.push(
            `kind:"variable" source for "${source.url}" requires a variableLoader (Node-only); skipping.`
          );
          return [];
        }
        const gf = this.opts.googleFonts;
        const { source: fetched, warnings: fetchWarnings } =
          await this.variableLoader({
            url: source.url,
            weight: source.weight,
            italic: source.italic ?? false,
            axes: source.axes,
            memoryCache: this.memoryCache,
            diskCache: this.diskCache,
            fetchTimeoutMs: gf?.fetchTimeoutMs,
          });
        if (fetchWarnings) warnings.push(...fetchWarnings);
        return fetched ? [fetched] : [];
      }
      default:
        // Exhaustiveness guard — new kind added to schema without handler
        throw new Error(
          `Unknown font source kind: ${(source as { kind: string }).kind}`
        );
    }
  }
}

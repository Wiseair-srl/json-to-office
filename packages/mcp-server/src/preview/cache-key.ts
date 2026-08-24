/**
 * What makes two previews the same preview.
 *
 * A LibreOffice run costs seconds; the JSON that caused it costs nothing to
 * hash. So every page is filed on disk under a digest of everything that could
 * change its pixels, and an unchanged document re-previewed answers from disk
 * without launching anything.
 *
 * That only holds if the key is complete. A key that omits the DPI serves a
 * 96-DPI page to a caller who asked for 300; one that omits the asset a
 * `image` component points at serves yesterday's logo after the file on disk
 * changed. The material below is therefore the full list — document, renderer,
 * theme, assets, fonts, DPI, selection, converters — and `PREVIEW_CACHE_VERSION`
 * covers the one input it cannot see: this pipeline itself.
 *
 * Two keys come out, and the split is the point. The RUN key identifies a whole
 * request, page selection included, which is the identity the cache contract is
 * stated in. The PAGE key drops the selection and names one page of one
 * document, which is the identity the PNGs are actually filed under — so
 * previewing `"1-3"` and then `"2-5"` re-renders pages 4 and 5 and reads 2 and
 * 3 off disk.
 */

import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ResolvedFont } from '@json-to-office/shared';

import type { FormatName } from '../lib/adapters.js';
import type { RenderOptionsInput } from '../lib/schema.js';

/**
 * Bump when a change to this pipeline would render the same inputs
 * differently — new soffice flags, a different filter, another pdftoppm
 * option. Cached PNGs from older pipelines then simply stop matching.
 */
export const PREVIEW_CACHE_VERSION = 1;

/**
 * Stable JSON: object keys sorted at every depth.
 *
 * `JSON.stringify` preserves insertion order, so the same document sent with
 * its keys in a different order would hash differently and miss a cache it
 * should hit. Arrays keep their order — there, order is meaning.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = canonicalize(source[key]);
    // Match JSON.stringify: an undefined property is absent, not null.
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Identity of the font faces a render will actually use.
 *
 * Content-addressed over the decoded bytes and order-insensitive, mirroring
 * `jto-ops`' `fontsDigest`: the same faces resolved twice must key the same,
 * and a document that resolves a family to different bytes must not.
 */
export function digestFonts(fonts: readonly ResolvedFont[]): string {
  const parts: string[] = [];
  for (const font of fonts) {
    for (const source of font.sources) {
      parts.push(
        `${font.family}|${source.weight}|${source.italic ? 'i' : 'r'}|` +
          crypto.createHash('sha256').update(source.data).digest('hex')
      );
    }
  }
  if (parts.length === 0) return 'none';
  return sha256(parts.sort().join('\n'));
}

/** File extensions worth treating as an on-disk render input. */
const ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg',
  '.avif',
  '.ico',
  '.emf',
  '.wmf',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
]);

/**
 * Identity of the local files a document points at.
 *
 * Size and mtime rather than content: a preview may reference a 20MB image and
 * hashing it would cost more than the render being avoided. The pair changes
 * whenever a normal edit-and-save does, which is the case that matters.
 *
 * Remote and inline sources are deliberately skipped — a `data:` URI is
 * already inside the document JSON and therefore already in the key, and an
 * `http(s)` URL cannot be identified without fetching it, so the URL string
 * (also in the document JSON) is all the identity available.
 */
export async function digestAssets(
  document: unknown,
  baseDir?: string
): Promise<string> {
  const references = new Set<string>();
  collectAssetReferences(document, references);
  if (references.size === 0) return 'none';

  const root = baseDir ?? process.cwd();
  const entries: string[] = [];
  await Promise.all(
    [...references].map(async (reference) => {
      const resolved = path.resolve(root, reference);
      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) return;
        entries.push(`${resolved}|${stat.size}|${stat.mtimeMs}`);
      } catch {
        // Missing file: generation will complain about it, and its absence is
        // already part of the document JSON in the key.
      }
    })
  );
  if (entries.length === 0) return 'none';
  return sha256(entries.sort().join('\n'));
}

function collectAssetReferences(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.length === 0 || value.length > 4096) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return; // data:, http:, file:, …
    if (ASSET_EXTENSIONS.has(path.extname(value).toLowerCase())) {
      into.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectAssetReferences(entry, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectAssetReferences(entry, into);
    }
  }
}

/** Identity of a theme file, when one was named. */
export async function digestThemeFile(
  themePath: string | undefined
): Promise<string> {
  if (!themePath) return 'none';
  try {
    const stat = await fs.stat(themePath);
    return `${path.resolve(themePath)}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return `${path.resolve(themePath)}|missing`;
  }
}

/** Everything that decides what a preview looks like. */
export interface PreviewCacheMaterial {
  format: FormatName;
  document: unknown;
  render: RenderOptionsInput;
  /** From `digestThemeFile`. */
  themeDigest: string;
  /** From `digestAssets`. */
  assetsDigest: string;
  /** From `digestFonts`. */
  fontsDigest: string;
  dpi: number;
  /** Canonical selection from `formatPageSelection`, e.g. `"1-3,7"`. */
  pageSelection: string;
  /** Version identities of soffice and pdftoppm. */
  converters: Record<string, string>;
}

export interface PreviewCacheKeys {
  /** Document + options + assets + fonts + DPI + converters. Selection-free. */
  documentKey: string;
  /** `documentKey` plus the page selection: the identity of one whole request. */
  runKey: string;
  /** Where one page's PNG is filed. */
  pageKey(page: number): string;
}

export function derivePreviewCacheKeys(
  material: PreviewCacheMaterial
): PreviewCacheKeys {
  const documentKey = sha256(
    canonicalJson({
      v: PREVIEW_CACHE_VERSION,
      format: material.format,
      document: material.document,
      renderer: material.render.renderer ?? null,
      theme: material.render.theme ?? null,
      themePath: material.render.themePath ?? null,
      themeDigest: material.themeDigest,
      deterministic: material.render.deterministic ?? false,
      generatedAt: material.render.generatedAt ?? null,
      baseDir: material.render.baseDir ?? null,
      assets: material.assetsDigest,
      fonts: material.fontsDigest,
      dpi: material.dpi,
      converters: material.converters,
    })
  );

  return {
    documentKey,
    runKey: sha256(`${documentKey}|pages=${material.pageSelection}`),
    pageKey: (page: number) => sha256(`${documentKey}|page=${page}`),
  };
}

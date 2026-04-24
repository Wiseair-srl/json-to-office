/**
 * Variable-font instancer. Fetches a variable TTF once (disk-cached), then
 * pins its `wght` axis (plus any additional axes) to produce a clean static
 * TTF per requested weight. Uses harfbuzz via `subset-font` — pure JS + WASM,
 * no native toolchain.
 *
 * Why this exists. Google Fonts serves pre-instanced static TTFs for many
 * families, but the instancing step is lossy: Inter Thin (100) and
 * ExtraLight (200) both ship with `OS/2.usWeightClass=250` and near-
 * identical glyph outlines (xAvgCharWidth differs by 1.8%, glyf table
 * differs by 83 bytes out of 135 KB). Pinning the upstream variable TTF's
 * `wght` axis at exactly 100 vs 200 produces properly distinct instances.
 *
 * Cache strategy:
 *   1. Raw variable TTF cached at key `varsrc|<url>` — one download per URL
 *      per process (+ optional disk layer).
 *   2. Instanced static TTF cached at `variable|<url>|<weight>|<italic>` —
 *      avoids re-running harfbuzz for weights we've already produced.
 *
 * Full-glyph retention. subset-font's `text` parameter drives which
 * codepoints' glyphs survive. We pass every BMP codepoint so the output
 * is effectively a full-glyph static (not a subset) for any Latin /
 * Cyrillic / Greek / Vietnamese-covering family — which includes every
 * entry in our POPULAR_GOOGLE_FONTS catalog. Supplementary-plane glyphs
 * (emoji) would be dropped, but those aren't in the variable families we
 * target. `preserveNameIds` keeps the human-readable name records our
 * downstream normalization expects.
 */

import type { ResolvedFontSource } from '../types';
import { detectFontFormat } from './format';
import { isAllowedFontUrl } from './url-allowlist';

// `subset-font` carries a harfbuzz WASM payload and is Node-only. Lazy-load
// so a browser bundler that chases the generic `sources/` tree doesn't pull
// it in. Cached across calls so the WASM heap is created once per process.
let subsetFontPromise: Promise<typeof import('subset-font').default> | null =
  null;
function loadSubsetFont(): Promise<typeof import('subset-font').default> {
  if (!subsetFontPromise) {
    subsetFontPromise = import('subset-font').then((m) => m.default);
  }
  return subsetFontPromise;
}

export interface VariableFetchOptions {
  url: string;
  weight: number;
  italic: boolean;
  /** Extra axis pins merged on top of the derived `wght` pin (e.g. `ital`,
   *  `opsz`, `slnt`). Rare — the `weight`/`italic` pair is usually enough. */
  axes?: Record<string, number>;
  /** Family label used in error messages and diagnostics. */
  familyLabel?: string;
  fetchTimeoutMs?: number;
  fetcher?: typeof fetch;
  memoryCache?: {
    get(key: string): Buffer | undefined;
    set(key: string, value: Buffer): void;
  };
  diskCache?: {
    get(key: string): Promise<Buffer | undefined>;
    set(key: string, value: Buffer): Promise<void>;
  };
}

function rawCacheKey(url: string): string {
  return `varsrc|${url}`;
}

function instanceCacheKey(
  url: string,
  weight: number,
  italic: boolean,
  axes?: Record<string, number>
): string {
  // Axes go into the key deterministically so different axis pins don't
  // collide. Sorted so `{a:1,b:2}` and `{b:2,a:1}` hash the same.
  const axisPart = axes
    ? '|' +
      Object.entries(axes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
    : '';
  return `variable|${url}|${weight}|${italic ? 'i' : 'r'}${axisPart}`;
}

/**
 * String covering every assigned BMP codepoint (0x20-0xFFFF minus surrogate
 * range). Built lazily on first use — ~127 KiB of UTF-16 memory (0xFFFF
 * codepoints × 2 bytes per UTF-16 code unit, minus the surrogate range)
 * held for the lifetime of the process, which is negligible next to the
 * WASM heap harfbuzz already carries.
 */
let cachedBmpCharset: string | null = null;
function bmpCharset(): string {
  if (cachedBmpCharset) return cachedBmpCharset;
  let s = '';
  for (let cp = 0x20; cp <= 0xffff; cp++) {
    // Surrogate range is structurally invalid as standalone codepoints —
    // harfbuzz rejects them. Skip.
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    s += String.fromCodePoint(cp);
  }
  cachedBmpCharset = s;
  return s;
}

type FetchResult = { buf: Buffer } | { error: string };

async function fetchVariableSource(
  opts: VariableFetchOptions
): Promise<FetchResult> {
  if (!isAllowedFontUrl(opts.url)) {
    return { error: 'host not in allowlist or non-HTTPS' };
  }
  const key = rawCacheKey(opts.url);
  const mem = opts.memoryCache?.get(key);
  if (mem) return { buf: mem };
  const disk = await opts.diskCache?.get(key);
  if (disk) {
    opts.memoryCache?.set(key, disk);
    return { buf: disk };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.fetchTimeoutMs ?? 10000);
  try {
    const f = opts.fetcher ?? fetch;
    // redirect: 'manual' so the allowlist can't be bypassed via Location.
    let res = await f(opts.url, { signal: ctrl.signal, redirect: 'manual' });
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const next = res.headers.get('location');
      if (!next) return { error: `${res.status} with no Location` };
      const resolved = new URL(next, opts.url).toString();
      if (!isAllowedFontUrl(resolved)) {
        return { error: `redirect to disallowed host: ${resolved}` };
      }
      if (++hops > 3) return { error: 'too many redirects' };
      res = await f(resolved, { signal: ctrl.signal, redirect: 'manual' });
    }
    if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` };
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    // Sanity-check: reject sub-1KB or non-TTF responses up front. The
    // instancer would fail loudly on garbage, but a clear "wrong URL"
    // signal here shortens the debug cycle.
    if (buf.length < 1024)
      return { error: `response too small (${buf.length}B)` };
    const format = detectFontFormat(buf);
    if (format !== 'ttf' && format !== 'otf') {
      return { error: `unexpected font format: ${format}` };
    }
    opts.memoryCache?.set(key, buf);
    await opts.diskCache?.set(key, buf);
    return { buf };
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchVariableFontSource(
  opts: VariableFetchOptions
): Promise<{ source?: ResolvedFontSource; warnings?: string[] }> {
  const key = instanceCacheKey(opts.url, opts.weight, opts.italic, opts.axes);
  const mem = opts.memoryCache?.get(key);
  if (mem) {
    return {
      source: {
        data: mem,
        weight: opts.weight,
        italic: opts.italic,
        format: detectFontFormat(mem),
      },
      warnings: [],
    };
  }
  const disk = await opts.diskCache?.get(key);
  if (disk) {
    opts.memoryCache?.set(key, disk);
    return {
      source: {
        data: disk,
        weight: opts.weight,
        italic: opts.italic,
        format: detectFontFormat(disk),
      },
      warnings: [],
    };
  }

  const fetched = await fetchVariableSource(opts);
  if ('error' in fetched) {
    return {
      warnings: [
        `Variable font fetch "${opts.url}" for "${opts.familyLabel ?? opts.url}" weight ${opts.weight}: ${fetched.error}; falling back to host defaults.`,
      ],
    };
  }
  const raw = fetched.buf;

  // Harfbuzz refuses to emit WOFF2 for subset-font's default SFNT target,
  // but we need plain SFNT anyway — Office embeds TTFs, not compressed
  // formats. Pin the weight (and any extra axes) and preserve the name
  // records that our downstream `normalizeNameTable` depends on.
  //
  // Note: italic is encoded by URL (separate italic master), not by axis pin.
  // The `ital` axis exists on some fonts but not others (Inter ships a
  // separate InterVariable-Italic.ttf instead). Callers that want to force
  // an axis pin can pass `axes: { ital: 1 }` explicitly.
  const variationAxes: Record<string, number> = {
    wght: opts.weight,
    ...(opts.axes ?? {}),
  };

  let instanced: Buffer;
  try {
    const subsetFont = await loadSubsetFont();
    instanced = await subsetFont(raw, bmpCharset(), {
      targetFormat: 'sfnt',
      variationAxes,
      // Keep every common name record. harfbuzz drops the ones not in
      // this list; our downstream rewrites need 1/2/4/6/16/17 intact.
      preserveNameIds: [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25,
      ],
    });
  } catch (err) {
    return {
      warnings: [
        `Variable font instancing for "${opts.familyLabel ?? opts.url}" weight ${opts.weight}: ${(err as Error).message}`,
      ],
    };
  }

  opts.memoryCache?.set(key, instanced);
  await opts.diskCache?.set(key, instanced);
  return {
    source: {
      data: instanced,
      weight: opts.weight,
      italic: opts.italic,
      format: detectFontFormat(instanced),
    },
    warnings: [],
  };
}

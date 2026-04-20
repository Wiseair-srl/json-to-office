/**
 * Google Fonts fetcher.
 *
 * Hits the CSS API v2 with an older User-Agent that returns TTF (default UA
 * gets WOFF2, which Office cannot embed as-is). Parses the `src: url(...)` line
 * and downloads the binary.
 *
 * Uses memory + optional disk cache keyed by `${family}|${weight}|${italic}`.
 */

import type { ResolvedFontSource } from '../types';
import { FontMemoryCache } from '../cache/memory-cache';
import { detectFontFormat } from './format';

interface FontDiskCacheLike {
  get(key: string): Promise<Buffer | undefined>;
  set(key: string, value: Buffer): Promise<void>;
}

export interface GoogleFetchOptions {
  family: string;
  weights: number[];
  italics?: boolean;
  memoryCache?: FontMemoryCache;
  diskCache?: FontDiskCacheLike;
  fetchTimeoutMs?: number;
  /** Override for tests. */
  fetcher?: typeof fetch;
}

export interface GoogleFetchResult {
  sources: ResolvedFontSource[];
  warnings: string[];
}

const TTF_UA = 'Mozilla/4.0';

async function fetchWithTimeout(
  url: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    fetcher?: typeof fetch;
  }
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const f = opts.fetcher ?? fetch;
    return await f(url, { headers: opts.headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildCssUrl(
  family: string,
  weights: number[],
  italics: boolean
): string {
  // URL-encode then restore spaces as `+` (Google's CSS2 API convention).
  const famPart = encodeURIComponent(family).replace(/%20/g, '+');
  const sortedWeights = [...weights].sort((a, b) => a - b);
  if (italics) {
    const axis = sortedWeights.flatMap((w) => [`0,${w}`, `1,${w}`]).join(';');
    return `https://fonts.googleapis.com/css2?family=${famPart}:ital,wght@${axis}&display=swap`;
  }
  const wghtPart = sortedWeights.join(';');
  return `https://fonts.googleapis.com/css2?family=${famPart}:wght@${wghtPart}&display=swap`;
}

/**
 * Parse Google Fonts CSS response into { weight, italic, ttfUrl } tuples.
 * Each @font-face block contains the src + font-weight + font-style we need.
 */
function parseCssFaces(
  css: string
): { weight: number; italic: boolean; ttfUrl: string }[] {
  const out: { weight: number; italic: boolean; ttfUrl: string }[] = [];
  const faceRe = /@font-face\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = faceRe.exec(css)) !== null) {
    const block = m[1];
    const urlM = block.match(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/);
    if (!urlM) continue;
    const weightM = block.match(/font-weight:\s*(\d+)/);
    const italicM = block.match(/font-style:\s*italic/);
    out.push({
      weight: weightM ? parseInt(weightM[1], 10) : 400,
      italic: Boolean(italicM),
      ttfUrl: urlM[1],
    });
  }
  return out;
}

function cacheKey(family: string, weight: number, italic: boolean): string {
  return `google|${family}|${weight}|${italic ? 'i' : 'r'}`;
}

export async function fetchGoogleFontSources(
  opts: GoogleFetchOptions
): Promise<GoogleFetchResult> {
  const weights = opts.weights?.length ? opts.weights : [400, 700];
  const italics = opts.italics ?? false;
  const warnings: string[] = [];
  const sources: ResolvedFontSource[] = [];

  // Try every (weight, italic) combo — first against caches, then via fetch.
  const wanted: { weight: number; italic: boolean }[] = [];
  for (const w of weights) {
    wanted.push({ weight: w, italic: false });
    if (italics) wanted.push({ weight: w, italic: true });
  }

  // Resolve any cache hits first.
  const pending: { weight: number; italic: boolean }[] = [];
  for (const w of wanted) {
    const key = cacheKey(opts.family, w.weight, w.italic);
    const mem = opts.memoryCache?.get(key);
    if (mem) {
      sources.push({
        data: mem,
        weight: w.weight,
        italic: w.italic,
        format: detectFontFormat(mem),
      });
      continue;
    }
    const disk = await opts.diskCache?.get(key);
    if (disk) {
      opts.memoryCache?.set(key, disk);
      sources.push({
        data: disk,
        weight: w.weight,
        italic: w.italic,
        format: detectFontFormat(disk),
      });
      continue;
    }
    pending.push(w);
  }

  if (pending.length === 0) {
    return { sources, warnings };
  }

  // Single CSS request covers all pending variants.
  const needItalics = pending.some((p) => p.italic);
  const cssUrl = buildCssUrl(
    opts.family,
    Array.from(new Set(pending.map((p) => p.weight))),
    needItalics
  );
  let faces: { weight: number; italic: boolean; ttfUrl: string }[];
  try {
    const cssRes = await fetchWithTimeout(cssUrl, {
      headers: { 'User-Agent': TTF_UA },
      timeoutMs: opts.fetchTimeoutMs,
      fetcher: opts.fetcher,
    });
    if (!cssRes.ok) {
      warnings.push(
        `Google Fonts CSS fetch for "${opts.family}" returned ${cssRes.status}`
      );
      return { sources, warnings };
    }
    const css = await cssRes.text();
    faces = parseCssFaces(css);
  } catch (err) {
    warnings.push(
      `Google Fonts CSS fetch for "${opts.family}" failed: ${
        (err as Error).message
      }`
    );
    return { sources, warnings };
  }

  for (const need of pending) {
    const match = faces.find(
      (f) => f.weight === need.weight && f.italic === need.italic
    );
    if (!match) {
      warnings.push(
        `Google Fonts "${opts.family}" missing weight ${need.weight}${
          need.italic ? ' italic' : ''
        }`
      );
      continue;
    }
    try {
      const res = await fetchWithTimeout(match.ttfUrl, {
        timeoutMs: opts.fetchTimeoutMs,
        fetcher: opts.fetcher,
      });
      if (!res.ok) {
        warnings.push(
          `Google Fonts TTF fetch for "${opts.family}" ${need.weight} returned ${res.status}`
        );
        continue;
      }
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      const key = cacheKey(opts.family, need.weight, need.italic);
      opts.memoryCache?.set(key, buf);
      await opts.diskCache?.set(key, buf);
      sources.push({
        data: buf,
        weight: need.weight,
        italic: need.italic,
        format: detectFontFormat(buf),
      });
    } catch (err) {
      warnings.push(
        `Google Fonts TTF fetch for "${opts.family}" ${need.weight} failed: ${
          (err as Error).message
        }`
      );
    }
  }

  return { sources, warnings };
}

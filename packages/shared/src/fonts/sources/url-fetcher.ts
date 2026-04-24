/**
 * Direct-URL font fetcher. Downloads a single TTF/OTF from an HTTPS URL and
 * returns it as a `ResolvedFontSource`. Cache-keyed the same way as the
 * Google Fonts fetcher so fetches are deduplicated across generations.
 *
 * Used as an escape hatch for families whose Google Fonts redistribution has
 * known defects (e.g. Inter's static Thin/ExtraLight shipping with a broken
 * `OS/2.usWeightClass`). The `UPSTREAM_OVERRIDES` catalog points affected
 * families at clean upstream sources like rsms/inter via jsDelivr.
 */

import type { ResolvedFontSource } from '../types';
import { detectFontFormat } from './format';
import { isAllowedFontUrl } from './url-allowlist';

export interface UrlFetchOptions {
  url: string;
  weight: number;
  italic: boolean;
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

function cacheKey(url: string, weight: number, italic: boolean): string {
  return `url|${url}|${weight}|${italic ? 'i' : 'r'}`;
}

export async function fetchUrlFontSource(
  opts: UrlFetchOptions
): Promise<{ source?: ResolvedFontSource; warnings?: string[] }> {
  if (!isAllowedFontUrl(opts.url)) {
    return {
      warnings: [
        `URL font fetch rejected (host not in allowlist or non-HTTPS): ${opts.url}`,
      ],
    };
  }
  const key = cacheKey(opts.url, opts.weight, opts.italic);
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.fetchTimeoutMs ?? 10000);
  try {
    const f = opts.fetcher ?? fetch;
    // redirect: 'manual' prevents the allowlist from being bypassed via
    // a 3xx Location pointing at an off-list host. We re-validate the
    // Location header against the allowlist before following.
    let res = await f(opts.url, { signal: ctrl.signal, redirect: 'manual' });
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const next = res.headers.get('location');
      if (!next) {
        return {
          warnings: [
            `URL font fetch "${opts.url}" ${res.status} with no Location header`,
          ],
        };
      }
      const resolved = new URL(next, opts.url).toString();
      if (!isAllowedFontUrl(resolved)) {
        return {
          warnings: [
            `URL font fetch "${opts.url}" redirected to disallowed host: ${resolved}`,
          ],
        };
      }
      if (++hops > 3) {
        return {
          warnings: [`URL font fetch "${opts.url}" too many redirects`],
        };
      }
      res = await f(resolved, { signal: ctrl.signal, redirect: 'manual' });
    }
    if (!res.ok) {
      return {
        warnings: [`URL font fetch "${opts.url}" returned ${res.status}`],
      };
    }
    const ab = await res.arrayBuffer();
    const raw = Buffer.from(ab);
    // Reject obvious non-font responses — e.g. jsDelivr 404 HTML, 200 OK
    // redirect pages, or aliased directory listings. Without this check the
    // bytes would sail through to the embed step and corrupt the output.
    const format = detectFontFormat(raw);
    if (format === 'unknown' || raw.length < 512) {
      return {
        warnings: [
          `URL font fetch "${opts.url}" returned ${raw.length} bytes of ${format} — not a TTF/OTF. Skipping.`,
        ],
      };
    }
    // WOFF/WOFF2 flow through: Office output never embeds bytes; the
    // LibreOffice preview stager handles them via fontconfig.
    // Metadata validation runs centrally in FontRegistry.materializeEntry.
    const buf = raw;
    opts.memoryCache?.set(key, buf);
    await opts.diskCache?.set(key, buf);
    return {
      source: {
        data: buf,
        weight: opts.weight,
        italic: opts.italic,
        format,
      },
      warnings: [],
    };
  } catch (err) {
    return {
      warnings: [
        `URL font fetch "${opts.url}" failed: ${(err as Error).message}`,
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}

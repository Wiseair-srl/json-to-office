import { describe, it, expect, vi } from 'vitest';
import { fetchGoogleFontSources } from '../sources/google-fetcher';
import { FontMemoryCache } from '../cache/memory-cache';

const TTF_HEADER = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(64),
]);

function mockCss(
  variants: { weight: number; italic: boolean; url: string }[]
): string {
  return variants
    .map(
      (v) => `
@font-face {
  font-family: 'Inter';
  font-style: ${v.italic ? 'italic' : 'normal'};
  font-weight: ${v.weight};
  src: url(${v.url}) format('truetype');
}`
    )
    .join('\n');
}

describe('fetchGoogleFontSources', () => {
  it('fetches regular weight TTF and returns a ResolvedFontSource', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://fonts.googleapis.com/css2')) {
        return new Response(
          mockCss([
            {
              weight: 400,
              italic: false,
              url: 'https://fonts.gstatic.com/inter-400.ttf',
            },
          ]),
          { status: 200 }
        );
      }
      if (url === 'https://fonts.gstatic.com/inter-400.ttf') {
        return new Response(TTF_HEADER, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const out = await fetchGoogleFontSources({
      family: 'Inter',
      weights: [400],
      fetcher: mockFetch as unknown as typeof fetch,
    });
    expect(out.warnings).toEqual([]);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].weight).toBe(400);
    expect(out.sources[0].italic).toBe(false);
    expect(out.sources[0].format).toBe('ttf');
  });

  it('fetches multiple weights and italic variants in one CSS request', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://fonts.googleapis.com/css2')) {
        return new Response(
          mockCss([
            {
              weight: 400,
              italic: false,
              url: 'https://fonts.gstatic.com/400.ttf',
            },
            {
              weight: 400,
              italic: true,
              url: 'https://fonts.gstatic.com/400i.ttf',
            },
            {
              weight: 700,
              italic: false,
              url: 'https://fonts.gstatic.com/700.ttf',
            },
            {
              weight: 700,
              italic: true,
              url: 'https://fonts.gstatic.com/700i.ttf',
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(TTF_HEADER, { status: 200 });
    });

    const out = await fetchGoogleFontSources({
      family: 'Inter',
      weights: [400, 700],
      italics: true,
      fetcher: mockFetch as unknown as typeof fetch,
    });
    expect(out.warnings).toEqual([]);
    expect(out.sources).toHaveLength(4);
    // one CSS + four TTF fetches
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('reuses cached bytes on repeat fetch', async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(async (url: string) => {
      fetchCount++;
      if (url.startsWith('https://fonts.googleapis.com/css2')) {
        return new Response(
          mockCss([
            {
              weight: 400,
              italic: false,
              url: 'https://fonts.gstatic.com/400.ttf',
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(TTF_HEADER, { status: 200 });
    });
    const memoryCache = new FontMemoryCache();

    await fetchGoogleFontSources({
      family: 'Inter',
      weights: [400],
      memoryCache,
      fetcher: mockFetch as unknown as typeof fetch,
    });
    const firstFetchCount = fetchCount;

    await fetchGoogleFontSources({
      family: 'Inter',
      weights: [400],
      memoryCache,
      fetcher: mockFetch as unknown as typeof fetch,
    });
    // Second call should hit cache — zero extra fetches.
    expect(fetchCount).toBe(firstFetchCount);
  });

  it('warns on non-2xx CSS response', async () => {
    const mockFetch = vi.fn(async () => new Response('', { status: 404 }));
    const out = await fetchGoogleFontSources({
      family: 'NoSuchFont',
      weights: [400],
      fetcher: mockFetch as unknown as typeof fetch,
    });
    expect(out.sources).toEqual([]);
    expect(out.warnings.some((w) => w.includes('404'))).toBe(true);
  });

  it('skips non-gstatic URLs in the CSS body (MitM/hijacked response defense)', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://fonts.googleapis.com/css2')) {
        // CSS points at an attacker-controlled host — must be rejected even
        // though the CSS itself arrived over HTTPS from googleapis.
        return new Response(
          mockCss([
            {
              weight: 400,
              italic: false,
              url: 'https://evil.example.com/inter-400.ttf',
            },
          ]),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const out = await fetchGoogleFontSources({
      family: 'Inter',
      weights: [400],
      fetcher: mockFetch as unknown as typeof fetch,
    });
    expect(out.sources).toEqual([]);
    // No TTF fetch attempted (only the CSS request happened).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Surface a "missing weight" warning — the regex simply didn't match.
    expect(out.warnings.some((w) => w.includes('missing weight 400'))).toBe(
      true
    );
  });
});

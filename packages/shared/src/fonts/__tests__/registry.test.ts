import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FontRegistry } from '../registry';
import type { FontRegistryEntry } from '../../schemas/font-catalog';
import { detectFontFormat } from '../sources/format';
import {
  readFontFamilyNames,
  readNameRecords,
  rewriteFontFamilyName,
} from '../sources/ttf-name';

// A small valid TTF header (0x00010000) padded — enough for format detection.
const MINIMAL_TTF_BUF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(64),
]);
const MINIMAL_TTF_B64 = MINIMAL_TTF_BUF.toString('base64');

describe('FontRegistry', () => {
  it('resolves a SAFE_FONTS name with sources: []', async () => {
    const r = new FontRegistry();
    const out = await r.resolve('Arial');
    expect(out.sources).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it('emits a warning for unknown unregistered fonts', async () => {
    const r = new FontRegistry();
    const out = await r.resolve('TotallyMadeUp');
    expect(out.sources).toEqual([]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('TotallyMadeUp');
  });

  it('materializes a kind:"data" source into a ResolvedFontSource', async () => {
    const entry: FontRegistryEntry = {
      id: 'MyFont',
      family: 'MyFont',
      sources: [
        { kind: 'data', data: MINIMAL_TTF_B64, weight: 400, italic: false },
      ],
    };
    const r = new FontRegistry({ opts: { extraEntries: [entry] } });
    const out = await r.resolve('MyFont');
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].format).toBe('ttf');
    expect(out.sources[0].weight).toBe(400);
    expect(out.sources[0].italic).toBe(false);
    expect(out.sources[0].data.length).toBeGreaterThan(0);
  });

  it('accepts data: URLs for kind:"data"', async () => {
    const entry: FontRegistryEntry = {
      id: 'UrlFont',
      family: 'UrlFont',
      sources: [
        {
          kind: 'data',
          data: `data:font/ttf;base64,${MINIMAL_TTF_B64}`,
        },
      ],
    };
    const r = new FontRegistry({ opts: { extraEntries: [entry] } });
    const out = await r.resolve('UrlFont');
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources).toHaveLength(1);
  });

  it('skips kind:"google" with a warning when googleFonts.enabled is false', async () => {
    const entry: FontRegistryEntry = {
      id: 'Inter',
      family: 'Inter',
      sources: [{ kind: 'google', family: 'Inter' }],
    };
    const r = new FontRegistry({
      opts: { extraEntries: [entry], googleFonts: { enabled: false } },
    });
    const out = await r.resolve('Inter');
    expect(out.sources).toEqual([]);
    expect(out.warnings.some((w) => w.includes('Google Fonts'))).toBe(true);
  });

  it('later extraEntries overwrite earlier ones on id collision', async () => {
    const r = new FontRegistry({
      opts: {
        extraEntries: [
          {
            id: 'X',
            family: 'X',
            sources: [{ kind: 'safe', family: 'Arial' }],
          },
          {
            id: 'X',
            family: 'X',
            sources: [{ kind: 'data', data: MINIMAL_TTF_B64 }],
          },
        ],
      },
    });
    const out = await r.resolve('X');
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources).toHaveLength(1);
  });

  it('caches resolutions by lowercased name', async () => {
    const r = new FontRegistry();
    const a = await r.resolve('Arial');
    const b = await r.resolve('arial');
    expect(a).toBe(b);
  });

  it('warns and skips kind:"file" when no fileLoader is injected', async () => {
    const entry: FontRegistryEntry = {
      id: 'F',
      family: 'F',
      sources: [{ kind: 'file', path: '/tmp/does-not-matter.ttf' }],
    };
    // No fileLoader => Node-only path is unavailable (e.g. browser bundle).
    const r = new FontRegistry({ opts: { extraEntries: [entry] } });
    const out = await r.resolve('F');
    expect(out.sources).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('warns and skips kind:"variable" when no variableLoader is injected', async () => {
    const entry: FontRegistryEntry = {
      id: 'V',
      family: 'V',
      sources: [
        {
          kind: 'variable',
          url: 'https://cdn.jsdelivr.net/example.ttf',
          weight: 400,
          italic: false,
        },
      ],
    };
    const r = new FontRegistry({ opts: { extraEntries: [entry] } });
    const out = await r.resolve('V');
    expect(out.sources).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('handles kind:"url" happy path (global fetch stub)', async () => {
    const entry: FontRegistryEntry = {
      id: 'U',
      family: 'U',
      sources: [
        {
          kind: 'url',
          url: 'https://fonts.gstatic.com/some-font.ttf',
          weight: 400,
          italic: false,
        },
      ],
    };
    // url-fetcher rejects sub-512-byte responses as likely-not-a-font,
    // so pad the TTF header with enough zeroes to clear that threshold.
    const paddedTtf = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00]),
      Buffer.alloc(1024),
    ]);
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(paddedTtf, { status: 200 }));
    try {
      const r = new FontRegistry({ opts: { extraEntries: [entry] } });
      const out = await r.resolve('U');
      expect(out.sources).toHaveLength(1);
      expect(out.sources[0].format).toBe('ttf');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects kind:"url" bytes that fail format detection', async () => {
    const entry: FontRegistryEntry = {
      id: 'Bad',
      family: 'Bad',
      // 600+ bytes of HTML passes the size check but detectFontFormat
      // returns 'unknown', so the fetcher rejects it with a warning.
      sources: [
        {
          kind: 'url',
          url: 'https://fonts.gstatic.com/not-a-font.html',
          weight: 400,
          italic: false,
        },
      ],
    };
    const html = Buffer.from('<!doctype html>' + 'x'.repeat(1024));
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(html, { status: 200 }));
    try {
      const r = new FontRegistry({ opts: { extraEntries: [entry] } });
      const out = await r.resolve('Bad');
      expect(out.sources).toEqual([]);
      expect(out.warnings.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects kind:"url" sources whose hostname is not in the allowlist', async () => {
    const entry: FontRegistryEntry = {
      id: 'Evil',
      family: 'Evil',
      sources: [
        {
          kind: 'url',
          url: 'https://evil.example.com/x.ttf',
          weight: 400,
          italic: false,
        },
      ],
    };
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const r = new FontRegistry({ opts: { extraEntries: [entry] } });
      const out = await r.resolve('Evil');
      expect(out.sources).toEqual([]);
      expect(out.warnings.some((w) => w.includes('allowlist'))).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('detectFontFormat', () => {
  it('detects TTF via SFNT magic', () => {
    expect(detectFontFormat(MINIMAL_TTF_BUF)).toBe('ttf');
  });
  it('detects OTF via OTTO magic', () => {
    const otf = Buffer.from([0x4f, 0x54, 0x54, 0x4f, 0x00, 0x00]);
    expect(detectFontFormat(otf)).toBe('otf');
  });
  it('detects WOFF', () => {
    const woff = Buffer.from([0x77, 0x4f, 0x46, 0x46, 0x00]);
    expect(detectFontFormat(woff)).toBe('woff');
  });
  it('returns "unknown" for random bytes', () => {
    expect(detectFontFormat(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe(
      'unknown'
    );
  });
});

/**
 * Resolved bytes must declare the family they were resolved as — nothing
 * downstream can find them otherwise. A host matches a run's `rFonts
 * w:ascii="Inter"` against the font's own name table, never against the
 * registry entry, so bytes calling themselves something else are invisible
 * to every reference — silently, on any machine that happens to have the
 * real family installed.
 */
describe('FontRegistry family stamping', () => {
  const REAL_TTF = readFileSync(
    path.resolve(
      __dirname,
      '../../../../core-docx/src/styles/fonts/life-sans/LifeSans-Medium.ttf'
    )
  );

  /** A font that calls itself `declared`, registered under `family`. */
  const registerAs = (
    family: string,
    declared: string,
    sources: Array<{ weight: number; italic: boolean }>
  ): FontRegistry => {
    const entry: FontRegistryEntry = {
      id: family,
      family,
      sources: sources.map((s) => ({
        kind: 'data' as const,
        data: rewriteFontFamilyName(REAL_TTF, declared).toString('base64'),
        weight: s.weight,
        italic: s.italic,
      })),
    };
    return new FontRegistry({ opts: { extraEntries: [entry] } });
  };

  it('rewrites bytes that declare a different family (the InterVariable case)', async () => {
    // Weight 400 is the case that broke: the preview stager only renames a
    // face when the weight synthesizes a distinct family ("Inter Medium"),
    // so Regular and Bold reach the host under whatever the file says.
    const out = await registerAs('Inter', 'Inter Variable', [
      { weight: 400, italic: false },
    ]).resolve('Inter');

    expect(readFontFamilyNames(out.sources[0].data)).toEqual(['Inter']);
    // Repaired before validation runs, so it must not also warn. Matched on
    // the bracketed code — "FAMILY_MISMATCH" is a substring of
    // "SUBFAMILY_MISMATCH", which the fixture legitimately trips.
    expect(
      out.warnings.some((w) =>
        w.includes('[FONT_METADATA_DEFECT:FAMILY_MISMATCH]')
      )
    ).toBe(false);
  });

  it('keeps the faces of one family individually addressable', async () => {
    // All four RIBBI faces share the family name, so PostScript names have
    // to differ — two fonts with the same PostScript name is malformed, and
    // Core Text may refuse to register the second one.
    const out = await registerAs('Inter', 'Inter Variable', [
      { weight: 400, italic: false },
      { weight: 400, italic: true },
      { weight: 700, italic: false },
      { weight: 700, italic: true },
    ]).resolve('Inter');

    const psNames = out.sources.map(
      (s) => readNameRecords(s.data, new Set([6]))[0]?.value
    );
    expect(psNames).toEqual([
      'Inter',
      'Inter-Italic',
      'Inter-Bold',
      'Inter-BoldItalic',
    ]);
    expect(new Set(psNames).size).toBe(psNames.length);
  });

  it('leaves bytes that already answer to the family untouched', async () => {
    // Costs a name-table rebuild, and a legitimately-named static has
    // nothing to gain from one.
    const out = await registerAs('Life Sans', 'Life Sans', [
      { weight: 500, italic: false },
    ]).resolve('Life Sans');

    expect(
      out.sources[0].data.equals(rewriteFontFamilyName(REAL_TTF, 'Life Sans'))
    ).toBe(true);
  });

  it('accepts a match on the typographic family without rewriting', async () => {
    // The fixture ships nameID 1 "Life Sans Medium" / nameID 16 "Life Sans".
    // Registered as "Life Sans" it already resolves — rewriting would clobber
    // a legitimate nameID 1.
    const entry: FontRegistryEntry = {
      id: 'Life Sans',
      family: 'Life Sans',
      sources: [
        {
          kind: 'data',
          data: REAL_TTF.toString('base64'),
          weight: 500,
          italic: false,
        },
      ],
    };
    const out = await new FontRegistry({
      opts: { extraEntries: [entry] },
    }).resolve('Life Sans');

    expect(readFontFamilyNames(out.sources[0].data)).toContain(
      'Life Sans Medium'
    );
    expect(out.sources[0].data.equals(REAL_TTF)).toBe(true);
  });
});

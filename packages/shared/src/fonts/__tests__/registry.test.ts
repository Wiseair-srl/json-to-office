import { describe, it, expect } from 'vitest';
import { FontRegistry } from '../registry';
import type { FontRegistryEntry } from '../../schemas/font-catalog';
import { detectFontFormat } from '../sources/format';

// A small valid TTF header (0x00010000) padded — enough for format detection.
const MINIMAL_TTF_BUF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(64),
]);
const MINIMAL_TTF_B64 = MINIMAL_TTF_BUF.toString('base64');

describe('FontRegistry', () => {
  it('resolves a SAFE_FONTS name with willEmbed: false', async () => {
    const r = new FontRegistry();
    const out = await r.resolve('Arial');
    expect(out.willEmbed).toBe(false);
    expect(out.sources).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it('emits a warning for unknown unregistered fonts', async () => {
    const r = new FontRegistry();
    const out = await r.resolve('TotallyMadeUp');
    expect(out.willEmbed).toBe(false);
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
    expect(out.willEmbed).toBe(true);
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
    expect(out.willEmbed).toBe(true);
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
    expect(out.willEmbed).toBe(false);
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
    expect(out.willEmbed).toBe(true);
    expect(out.sources).toHaveLength(1);
  });

  it('caches resolutions by lowercased name', async () => {
    const r = new FontRegistry();
    const a = await r.resolve('Arial');
    const b = await r.resolve('arial');
    expect(a).toBe(b);
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

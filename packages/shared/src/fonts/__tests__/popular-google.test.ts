import { describe, it, expect } from 'vitest';
import {
  POPULAR_GOOGLE_FONTS,
  type PopularGoogleFont,
} from '../catalog/popular-google';

function entry(family: string): PopularGoogleFont {
  const matches = POPULAR_GOOGLE_FONTS.filter((f) => f.family === family);
  expect(matches, `${family} should appear exactly once`).toHaveLength(1);
  return matches[0];
}

const FULL_RANGE = [100, 200, 300, 400, 500, 600, 700, 800, 900];

describe('POPULAR_GOOGLE_FONTS', () => {
  it('has no duplicate families (case-insensitive)', () => {
    const seen = new Set<string>();
    for (const f of POPULAR_GOOGLE_FONTS) {
      const key = f.family.toLowerCase();
      expect(seen.has(key), `duplicate entry for ${f.family}`).toBe(false);
      seen.add(key);
    }
  });

  it('catalogues Geist across the full 100–900 range with italics', () => {
    const geist = entry('Geist');
    expect(geist.category).toBe('sans');
    expect(geist.weights).toEqual(FULL_RANGE);
    expect(geist.hasItalic).toBe(true);
  });

  it('catalogues Geist Mono as a mono family', () => {
    const mono = entry('Geist Mono');
    expect(mono.category).toBe('mono');
    expect(mono.weights).toEqual(FULL_RANGE);
    expect(mono.hasItalic).toBe(true);
  });

  it('catalogues Archivo across the full 100–900 range with italics', () => {
    const archivo = entry('Archivo');
    expect(archivo.category).toBe('sans');
    expect(archivo.weights).toEqual(FULL_RANGE);
    expect(archivo.hasItalic).toBe(true);
  });

  it('catalogues Space Grotesk at 300–700 with NO italics', () => {
    // Upstream really does ship only these five weights and has no ital axis:
    // `css2?family=Space+Grotesk:ital,wght@1,400` is an HTTP 400. Widening this
    // to 100–900 or flipping hasItalic would make autoGoogleFontEntries request
    // faces that do not exist.
    const sg = entry('Space Grotesk');
    expect(sg.category).toBe('sans');
    expect(sg.weights).toEqual([300, 400, 500, 600, 700]);
    expect(sg.hasItalic).toBe(false);
    // The bundled data-report deck asks for Medium; if 500 were pruned the
    // weight intersection in autoGoogleFontEntries would fall back to [400].
    expect(sg.weights).toContain(500);
  });

  it('keeps Archivo and Archivo Black as distinct entries', () => {
    // "Archivo Black" is a real display family that looks exactly like a
    // synthesized "<Archivo> <Black>" sub-family name. Both must exist.
    expect(entry('Archivo Black').category).toBe('display');
    expect(entry('Archivo').category).toBe('sans');
  });
});

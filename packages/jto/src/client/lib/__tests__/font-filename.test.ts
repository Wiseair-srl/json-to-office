import { describe, it, expect } from 'vitest';
import { parseFontFilename } from '../font-filename';

describe('parseFontFilename (browser-safe)', () => {
  it('parses family + numeric weight', () => {
    expect(parseFontFilename('Inter-500.ttf')).toEqual({
      family: 'Inter',
      weight: 500,
      italic: false,
    });
  });

  it('parses family + named weight', () => {
    expect(parseFontFilename('Inter-Bold.ttf')).toEqual({
      family: 'Inter',
      weight: 700,
      italic: false,
    });
  });

  it('parses italic-only suffix as regular italic', () => {
    expect(parseFontFilename('Inter-Italic.otf')).toEqual({
      family: 'Inter',
      weight: 400,
      italic: true,
    });
  });

  it('parses combined weight + italic suffix', () => {
    expect(parseFontFilename('Inter-BoldItalic.ttf')).toEqual({
      family: 'Inter',
      weight: 700,
      italic: true,
    });
  });

  it('treats unrecognized suffix as part of the family name', () => {
    expect(parseFontFilename('BrandPro.ttf')).toEqual({
      family: 'BrandPro',
      weight: 400,
      italic: false,
    });
  });

  it('handles multi-word families separated by spaces', () => {
    expect(parseFontFilename('Roboto Condensed-Bold.ttf')).toEqual({
      family: 'Roboto Condensed',
      weight: 700,
      italic: false,
    });
  });

  it('strips directory components from a path-style filename', () => {
    expect(parseFontFilename('/fonts/Inter-Regular.ttf')).toEqual({
      family: 'Inter',
      weight: 400,
      italic: false,
    });
  });

  it('accepts underscore separators', () => {
    expect(parseFontFilename('Roboto_500.otf')).toEqual({
      family: 'Roboto',
      weight: 500,
      italic: false,
    });
  });
});

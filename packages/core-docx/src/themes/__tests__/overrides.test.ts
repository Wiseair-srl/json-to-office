import { describe, it, expect } from 'vitest';
import { applyThemeOverrides } from '../overrides';

const theme = {
  name: 'minimal',
  displayName: 'Minimal',
  description: '',
  version: '1',
  colors: { primary: '#000000', background: '#FFFFFF' },
  fonts: {
    heading: { family: 'Arial', size: 20 },
    body: { family: 'Arial', size: 11 },
  },
  styles: { normal: { size: 11, color: '#000000' } },
} as any;

describe('applyThemeOverrides', () => {
  it('returns the theme untouched without overrides', () => {
    expect(applyThemeOverrides(theme, undefined)).toBe(theme);
  });

  it('replaces color tokens and keeps the rest', () => {
    const merged = applyThemeOverrides(theme, {
      colors: { primary: '#231F20', accent: '#E6E620' } as any,
    });
    expect(merged.colors.primary).toBe('#231F20');
    expect((merged.colors as any).accent).toBe('#E6E620');
    expect(merged.colors.background).toBe('#FFFFFF');
    expect(theme.colors.primary).toBe('#000000');
  });

  it('merges font roles field-wise', () => {
    const merged = applyThemeOverrides(theme, {
      fonts: { heading: { family: 'Geist' } } as any,
    });
    expect(merged.fonts.heading).toEqual({ family: 'Geist', size: 20 });
    expect(merged.fonts.body).toEqual({ family: 'Arial', size: 11 });
  });

  it('merges styles one level deep', () => {
    const merged = applyThemeOverrides(theme, {
      styles: { normal: { color: '#111111' }, hero: { size: 80 } } as any,
    });
    expect((merged.styles as any).normal).toEqual({
      size: 11,
      color: '#111111',
    });
    expect((merged.styles as any).hero).toEqual({ size: 80 });
  });
});

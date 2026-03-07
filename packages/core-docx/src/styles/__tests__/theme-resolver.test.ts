import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../theme-resolver';
import type { ThemeConfig } from '../index';

describe('styles/theme-resolver', () => {
  describe('resolveTheme', () => {
    it('should resolve theme by name', () => {
      const theme = resolveTheme('minimal');
      expect(theme).toBeDefined();
      expect(theme).toHaveProperty('colors');
    });

    it('should return minimal theme for unknown name', () => {
      const theme = resolveTheme('non-existent');
      expect(theme).toBeDefined();
      expect(theme).toHaveProperty('colors');
    });

    it('should handle undefined theme name', () => {
      const theme = resolveTheme(undefined);
      expect(theme).toBeDefined();
      expect(theme).toHaveProperty('colors');
    });

    it('should return theme object as-is', () => {
      const customTheme: ThemeConfig = {
        colors: {
          primary: '#FF0000',
          secondary: '#00FF00',
          text: '#000000',
          background: '#FFFFFF',
        },
        fonts: {
          heading: 'Arial',
          body: 'Calibri',
        },
      };

      const resolved = resolveTheme(customTheme);
      expect(resolved).toEqual(customTheme);
    });

    it('should handle partial theme objects', () => {
      const partialTheme: ThemeConfig = {
        colors: {
          primary: '#123456',
        },
      };

      const resolved = resolveTheme(partialTheme);
      expect(resolved.colors?.primary).toBe('#123456');
    });
  });
});

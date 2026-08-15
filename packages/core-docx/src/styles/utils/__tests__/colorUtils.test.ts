import { describe, it, expect } from 'vitest';
import {
  resolveColor,
  isValidColorName,
  getAvailableColorNames,
} from '../colorUtils';
import type { ThemeConfig } from '../../index';
import { corporateTheme } from '../../../templates/themes';

// A JS-object theme (customThemes / inline props.theme) can carry an optional
// slot that is present but undefined; schema validation never sees it.
const themeWithUndefinedAccent4 = {
  ...corporateTheme,
  colors: { ...corporateTheme.colors, accent4: undefined },
} as ThemeConfig;

// Same theme without the key at all.
const themeWithoutAccent4 = corporateTheme as ThemeConfig;

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned');
}

describe('styles/utils/colorUtils', () => {
  describe('resolveColor', () => {
    it('should resolve a hex color', () => {
      expect(resolveColor('#1a365d', themeWithoutAccent4)).toBe('1A365D');
    });

    it('should resolve a theme color name', () => {
      expect(resolveColor('primary', themeWithoutAccent4)).toBe('1A365D');
    });

    it('should throw a clean error for a present-but-undefined color slot', () => {
      expect(themeWithUndefinedAccent4.colors).toHaveProperty('accent4');

      const error = captureError(() =>
        resolveColor('accent4', themeWithUndefinedAccent4)
      );

      expect(error).not.toBeInstanceOf(TypeError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        'Invalid color value: "accent4"'
      );
    });

    it('should throw the same error for an absent color slot', () => {
      expect(themeWithoutAccent4.colors).not.toHaveProperty('accent4');

      const error = captureError(() =>
        resolveColor('accent4', themeWithoutAccent4)
      );

      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain(
        'Invalid color value: "accent4"'
      );
    });

    it('should throw a clean error when a default slot is explicitly undefined', () => {
      const theme = {
        ...corporateTheme,
        colors: { ...corporateTheme.colors, secondary: undefined },
      } as unknown as ThemeConfig;

      const error = captureError(() => resolveColor('secondary', theme));

      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain(
        'Invalid color value: "secondary"'
      );
    });

    it('should throw for an invalid hex color', () => {
      expect(() => resolveColor('#12345', themeWithoutAccent4)).toThrow(
        'Invalid hex color'
      );
    });
  });

  describe('isValidColorName', () => {
    it('should accept a set color name', () => {
      expect(isValidColorName('primary', themeWithoutAccent4)).toBe(true);
    });

    it('should reject a present-but-undefined color slot', () => {
      expect(isValidColorName('accent4', themeWithUndefinedAccent4)).toBe(
        false
      );
    });

    it('should reject an absent color name', () => {
      expect(isValidColorName('accent4', themeWithoutAccent4)).toBe(false);
    });

    it('should agree with resolveColor on every candidate name', () => {
      const candidates = ['primary', 'accent', 'accent4', 'accent5', 'nope'];

      for (const name of candidates) {
        let resolves = true;
        try {
          resolveColor(name, themeWithUndefinedAccent4);
        } catch {
          resolves = false;
        }
        expect(isValidColorName(name, themeWithUndefinedAccent4)).toBe(
          resolves
        );
      }
    });
  });

  describe('getAvailableColorNames', () => {
    it('should list set color names', () => {
      expect(getAvailableColorNames(themeWithoutAccent4)).toContain('primary');
    });

    it('should omit a present-but-undefined color slot', () => {
      expect(getAvailableColorNames(themeWithUndefinedAccent4)).not.toContain(
        'accent4'
      );
    });

    it('should list only names resolveColor accepts', () => {
      for (const name of getAvailableColorNames(themeWithUndefinedAccent4)) {
        expect(() =>
          resolveColor(name, themeWithUndefinedAccent4)
        ).not.toThrow();
      }
    });
  });
});

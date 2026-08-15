import { describe, it, expect } from 'vitest';
import type { GenerationWarning } from '@json-to-office/shared';
import { resolveBuiltInTheme } from '../theme-resolver';

describe('styles/theme-resolver', () => {
  describe('resolveBuiltInTheme', () => {
    it('resolves a built-in theme by name without warning', () => {
      const warnings: GenerationWarning[] = [];
      const theme = resolveBuiltInTheme('minimal', { warnings });

      expect(theme.name).toBe('minimal');
      expect(warnings).toEqual([]);
    });

    it('warns when the name does not resolve, and still falls back', () => {
      const warnings: GenerationWarning[] = [];
      const theme = resolveBuiltInTheme('non-existent', { warnings });

      // The fallback stays — a bad name must not fail an otherwise valid render.
      expect(theme.name).toBe('minimal');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        component: 'theme',
        severity: 'warning',
        context: { code: 'theme_not_found', requested: 'non-existent' },
      });
      expect(warnings[0].message).toContain('non-existent');
      expect(warnings[0].message).toContain('minimal');
    });

    it('lists custom theme names as available in the warning', () => {
      const warnings: GenerationWarning[] = [];
      resolveBuiltInTheme('typo', {
        customThemes: { 'house-style': {} as never },
        warnings,
      });

      expect(warnings[0].context?.available).toContain('house-style');
    });

    it('does not require a warnings sink', () => {
      expect(() => resolveBuiltInTheme('non-existent')).not.toThrow();
    });
  });
});

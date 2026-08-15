import type { ThemeConfig } from './index';
import { validateTheme as validateThemeUnified } from '@json-to-office/shared-docx/validation/unified';
import { hasTheme, getThemeNames } from '../templates/themes';

/**
 * Validate a theme configuration
 * Now uses unified validation from shared package
 */
export function validateTheme(
  theme?: ThemeConfig | string
): ThemeConfig | undefined {
  if (!theme) {
    return undefined;
  }

  if (typeof theme === 'string') {
    // Theme name: resolved later, but check it exists now. Casting an
    // unregistered name straight through is what let a typo reach the
    // renderer and silently come back as `minimal`.
    if (!hasTheme(theme)) {
      throw new Error(
        `Unknown theme "${theme}". Available themes: ${getThemeNames().sort().join(', ')}.`
      );
    }
    return theme as unknown as ThemeConfig;
  }

  // Use unified validation
  const result = validateThemeUnified(theme);

  if (!result.valid) {
    const errorSummary =
      result.errors?.map((e: any) => e.message).join(', ') || 'Invalid theme';
    throw new Error(`Invalid theme: ${errorSummary}`);
  }

  return result.data as ThemeConfig;
}

import type { ThemeConfig } from './index';
import { validateTheme as validateThemeUnified } from '@json-to-office/shared-docx/validation/unified';

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
    // Theme name - will be resolved later
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

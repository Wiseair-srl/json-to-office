import type { ThemeConfig } from './index';
import { getTheme } from '../templates/themes';

/**
 * Resolve a theme by merging with defaults
 */
export function resolveTheme(theme?: ThemeConfig | string): ThemeConfig {
  if (typeof theme === 'string') {
    const resolvedTheme = getTheme(theme);
    if (resolvedTheme) {
      return resolvedTheme as ThemeConfig;
    }
    // Fallback to minimal theme if default doesn't exist
    return getTheme('minimal') as ThemeConfig;
  }

  if (theme) {
    // Return theme as-is, assuming it's complete
    return theme;
  }

  // Return minimal theme as default
  return getTheme('minimal') as ThemeConfig;
}

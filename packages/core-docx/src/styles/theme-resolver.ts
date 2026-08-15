import type { GenerationWarning } from '@json-to-office/shared';
import type { ThemeConfig } from './index';
import {
  getThemeNames,
  getThemeWithFallback,
  hasTheme,
} from '../templates/themes';

/**
 * Resolve a built-in theme by name, reporting a miss instead of swallowing it.
 *
 * `getThemeWithFallback` renders an unknown name as `minimal`, which used to be
 * invisible: a typo, or a `--theme-path` file whose internal `name` differs
 * from its filename, produced a plausible-looking document styled by the wrong
 * theme. The fallback is kept — a bad name should not fail a render — but it
 * now surfaces as a warning naming what was asked for and what is available.
 */
export function resolveBuiltInTheme(
  themeName: string,
  options: {
    customThemes?: { [key: string]: ThemeConfig };
    warnings?: GenerationWarning[];
  } = {}
): ThemeConfig {
  if (!hasTheme(themeName)) {
    const available = [
      ...getThemeNames(),
      ...Object.keys(options.customThemes ?? {}),
    ].sort();
    options.warnings?.push({
      component: 'theme',
      message: `Theme "${themeName}" not found; falling back to "minimal". Available themes: ${available.join(', ')}.`,
      severity: 'warning',
      context: { code: 'theme_not_found', requested: themeName, available },
    });
  }

  return getThemeWithFallback(themeName);
}

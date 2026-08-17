/**
 * In-document theme overrides: a partial theme from the document root's
 * `themeOverrides` prop, deep-merged over the resolved named theme.
 */

import { createHash } from 'crypto';
import type { ThemeConfig } from '../styles';

export interface ThemeOverrides {
  colors?: Partial<ThemeConfig['colors']>;
  fonts?: Partial<ThemeConfig['fonts']>;
  styles?: ThemeConfig['styles'];
}

/**
 * Merge a partial override object over a resolved theme.
 *
 * - `colors`: per-token replacement.
 * - `fonts`: per-role merge (an override role only replaces the fields it
 *   sets, so `{ heading: { family: "Geist" } }` keeps the theme's size).
 * - `styles`: per-style merge, one level deep — nested objects inside a style
 *   (spacing, lineSpacing, borders, indent) are replaced wholesale.
 */
export function applyThemeOverrides(
  theme: ThemeConfig,
  overrides: ThemeOverrides | undefined
): ThemeConfig {
  if (!overrides) return theme;

  const fonts = { ...theme.fonts };
  for (const [role, def] of Object.entries(overrides.fonts ?? {})) {
    const key = role as keyof ThemeConfig['fonts'];
    fonts[key] = { ...theme.fonts[key], ...def };
  }

  const styles: Record<string, object> = { ...(theme.styles ?? {}) };
  for (const [name, def] of Object.entries(overrides.styles ?? {})) {
    styles[name] = { ...styles[name], ...(def as object) };
  }

  return {
    ...theme,
    colors: { ...theme.colors, ...(overrides.colors ?? {}) },
    fonts,
    ...(Object.keys(styles).length > 0 && { styles }),
  };
}

/** Short stable digest used to scope theme-keyed caches per override set. */
export function themeOverridesDigest(overrides: ThemeOverrides): string {
  return createHash('sha256')
    .update(JSON.stringify(overrides))
    .digest('hex')
    .slice(0, 8);
}

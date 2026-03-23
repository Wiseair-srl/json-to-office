/**
 * Color utilities for PPTX generation.
 * pptxgenjs expects bare 6-char hex (e.g. 'FF0000'), but our theme
 * convention uses '#'-prefixed values (e.g. '#FF0000').
 */

import type { PptxThemeConfig, PipelineWarning } from '../types';
import { SEMANTIC_COLOR_NAMES } from '@json-to-office/shared-pptx';
import { warn, W } from './warn';

// Build identity entries from the shared source of truth, then add aliases
const SEMANTIC_TO_THEME_KEY: Record<string, keyof PptxThemeConfig['colors']> = {
  ...Object.fromEntries(SEMANTIC_COLOR_NAMES.map(n => [n, n])),
  // Aliases (PowerPoint XML compat)
  accent1: 'primary',
  accent2: 'secondary',
  accent3: 'accent',
  tx1: 'text',
  tx2: 'text2',
  bg1: 'background',
  bg2: 'background2',
};

/**
 * Resolve a color value to bare hex (no '#' prefix).
 * Accepts hex colors (with or without '#') or semantic theme color names.
 */
export function resolveColor(color: string, theme: PptxThemeConfig, warnings?: PipelineWarning[]): string {
  const themeKey = SEMANTIC_TO_THEME_KEY[color];
  if (themeKey) {
    const resolved = theme.colors[themeKey];
    if (resolved) return resolved.startsWith('#') ? resolved.slice(1) : resolved;
    // Fall back to primary for unset optional colors
    warn(warnings, W.THEME_COLOR_FALLBACK, `Theme color "${themeKey}" not defined, falling back to primary`);
    return theme.colors.primary.startsWith('#') ? theme.colors.primary.slice(1) : theme.colors.primary;
  }
  // Not a semantic name — treat as literal hex
  const bare = color.startsWith('#') ? color.slice(1) : color;
  // Expand 3-char hex shorthand (e.g. 'FFF' → 'FFFFFF')
  if (/^[0-9A-Fa-f]{3}$/.test(bare)) {
    return bare[0] + bare[0] + bare[1] + bare[1] + bare[2] + bare[2];
  }
  if (!/^[0-9A-Fa-f]{6}$/.test(bare)) {
    warn(warnings, W.UNKNOWN_COLOR, `Unknown color value: "${color}", treating as literal`);
  }
  return bare;
}

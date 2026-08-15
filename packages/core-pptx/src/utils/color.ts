/**
 * Color utilities for PPTX generation.
 * pptxgenjs expects bare 6-char hex (e.g. 'FF0000'), but our theme
 * convention uses '#'-prefixed values (e.g. '#FF0000').
 */

import type { PptxThemeConfig, PipelineWarning } from '../types';
import { SEMANTIC_COLOR_NAMES } from '@json-to-office/shared-pptx';
import { DEFAULT_CHART_THEME_COLORS } from '@json-to-office/shared';
import { warn, W } from './warn';

// Build identity entries from the shared source of truth, then add aliases
const SEMANTIC_TO_THEME_KEY: Record<string, keyof PptxThemeConfig['colors']> = {
  ...Object.fromEntries(SEMANTIC_COLOR_NAMES.map((n) => [n, n])),
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
 * Default series-color tokens for charts, used by the native `chart` component
 * and the `highcharts` component. Defined in @json-to-office/shared so the DOCX
 * `highcharts` component resolves the same tokens; re-exported here because
 * every PPTX call site already imports colors from this module.
 */
export { DEFAULT_CHART_THEME_COLORS };

/**
 * Follow a stored theme color value to bare hex, or undefined when it never
 * reaches one. The theme schema lets a slot name another slot
 * (`"accent4": "primary"`), so a stored value is only a color once the
 * reference chain has been walked — without this, `accent4` resolved to the
 * literal string `primary` and pptxgenjs silently painted the series black.
 *
 * Mirrors DOCX `toChartColor`/`resolveColor` (core-docx colorUtils) on casing:
 * the stored value passes through verbatim when it is already hex, and anything
 * reached by following a reference is normalized to uppercase. Two deliberate
 * divergences: `seen` turns a reference cycle into "unresolvable" instead of the
 * stack overflow the DOCX version would hit, and 3-char shorthand is expanded
 * here but not by DOCX, so `"accent4": "#abc"` fills the slot in a deck and
 * drops it in a document.
 */
function chainToHex(
  value: string,
  theme: PptxThemeConfig,
  seen: Set<string>
): string | undefined {
  const bare = value.startsWith('#') ? value.slice(1) : value;
  if (/^[0-9A-Fa-f]{6}$/.test(bare)) return bare;
  // Expand 3-char hex shorthand (e.g. 'FFF' → 'FFFFFF')
  if (/^[0-9A-Fa-f]{3}$/.test(bare)) {
    return bare[0] + bare[0] + bare[1] + bare[1] + bare[2] + bare[2];
  }
  const themeKey = SEMANTIC_TO_THEME_KEY[value];
  if (!themeKey || seen.has(themeKey)) return undefined;
  seen.add(themeKey);
  const next = theme?.colors?.[themeKey];
  if (typeof next !== 'string' || next.length === 0) return undefined;
  return chainToHex(next, theme, seen)?.toUpperCase();
}

/**
 * The default chart palette narrowed to the tokens this theme actually defines
 * *and* can resolve to a color. Both PPTX chart paths build their implicit
 * palette from this, so an unset accent4-6 is skipped — matching DOCX — instead
 * of resolving to `primary` six times over, and a slot holding an unresolvable
 * value is dropped rather than posted as `#primary`. Author-supplied colors must
 * NOT go through here: naming an undefined token stays a loud `resolveColor`
 * fallback + warning.
 */
export function definedChartColorTokens(theme: PptxThemeConfig): string[] {
  const colors = theme?.colors as
    | Record<string, string | undefined>
    | undefined;
  if (!colors) return [];
  return DEFAULT_CHART_THEME_COLORS.filter((token) => {
    const themeKey = SEMANTIC_TO_THEME_KEY[token] ?? token;
    const value = colors[themeKey];
    if (typeof value !== 'string' || value.length === 0) return false;
    return chainToHex(value, theme, new Set([themeKey])) !== undefined;
  });
}

/**
 * Resolve a color value to bare hex (no '#' prefix).
 * Accepts hex colors (with or without '#') or semantic theme color names.
 */
export function resolveColor(
  color: string,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): string {
  const themeKey = SEMANTIC_TO_THEME_KEY[color];
  if (themeKey) {
    const resolved = theme.colors[themeKey];
    if (resolved) {
      const hex = chainToHex(resolved, theme, new Set([themeKey]));
      if (hex) return hex;
      // Defined but not a color (e.g. a name reference that goes nowhere).
      // Never hand the literal on to pptxgenjs — it renders black in silence.
      warn(
        warnings,
        W.UNKNOWN_COLOR,
        `Theme color "${themeKey}" is "${resolved}", which is not a hex color or a theme color name; falling back to primary`
      );
      return resolvePrimary(theme);
    }
    // Fall back to primary for unset optional colors
    warn(
      warnings,
      W.THEME_COLOR_FALLBACK,
      `Theme color "${themeKey}" not defined, falling back to primary`
    );
    return resolvePrimary(theme);
  }
  // Not a semantic name — treat as literal hex
  const bare = color.startsWith('#') ? color.slice(1) : color;
  // Expand 3-char hex shorthand (e.g. 'FFF' → 'FFFFFF')
  if (/^[0-9A-Fa-f]{3}$/.test(bare)) {
    return bare[0] + bare[0] + bare[1] + bare[1] + bare[2] + bare[2];
  }
  if (!/^[0-9A-Fa-f]{6}$/.test(bare)) {
    warn(
      warnings,
      W.UNKNOWN_COLOR,
      `Unknown color value: "${color}", treating as literal`
    );
  }
  return bare;
}

/** The `primary` fallback, itself chain-resolved so it can't leak a token name. */
function resolvePrimary(theme: PptxThemeConfig): string {
  const primary = theme.colors.primary;
  return (
    chainToHex(primary, theme, new Set(['primary'])) ??
    (primary.startsWith('#') ? primary.slice(1) : primary)
  );
}

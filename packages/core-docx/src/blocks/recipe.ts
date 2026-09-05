/**
 * What every block reads from the theme, and how it falls back.
 *
 * A block never states a size, a colour or a coordinate of its own: it names a
 * type role and a chrome recipe, and the resolved theme supplies the values.
 * On a theme that declares neither, the block still has to draw — so each
 * helper here carries the plain fallback that holds anywhere: a named style
 * when the theme resolved one, explicit run formatting when it did not.
 */

import type { ThemeConfig } from '../styles';

/** What a block's rule may weigh: the `divider` component's whole range. */
export const MIN_RULE_PT = 0.25;
export const MAX_RULE_PT = 12;

export function clampRule(weightPt: number): number {
  return Math.min(MAX_RULE_PT, Math.max(MIN_RULE_PT, weightPt));
}

/** The eyebrow a theme without the role gets: small, bold, accent, caps. */
export const FALLBACK_EYEBROW_FONT = {
  size: 9,
  bold: true,
  color: 'accent',
  case: 'upper',
} as const;

/** Whether the resolved theme carries a named style for `role`. */
export function hasStyle(theme: ThemeConfig, role: string): boolean {
  const styles = theme.styles as Record<string, unknown> | undefined;
  return styles?.[role] !== undefined;
}

/**
 * The paragraph props that set text in `role`: `themeStyle` when the theme
 * resolved that role, else the explicit `font` the caller falls back to. A
 * recipe colour, when given, is stated either way — it is the theme's own
 * word on the matter.
 */
export function roleProps(
  theme: ThemeConfig,
  role: string,
  fallbackFont: Record<string, unknown>,
  color?: string
): Record<string, unknown> {
  if (hasStyle(theme, role)) {
    return {
      themeStyle: role,
      ...(color !== undefined && { font: { color } }),
    };
  }
  return { font: { ...fallbackFont, ...(color !== undefined && { color }) } };
}

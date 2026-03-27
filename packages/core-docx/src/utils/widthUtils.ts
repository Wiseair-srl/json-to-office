import { ThemeConfig } from '../styles';
import { getPageSetup } from '../styles';
import { pointsToTwips } from '../styles/utils/styleHelpers';

/**
 * Compute available page width in twips (page width minus left/right margins)
 */
export function getAvailableWidthTwips(
  theme?: ThemeConfig,
  themeName?: string
): number {
  const page = getPageSetup(theme, themeName);
  const width = page?.size?.width || 0;
  const left = page?.margin?.left || 0;
  const right = page?.margin?.right || 0;
  return Math.max(0, width - left - right);
}

/**
 * Compute full page width in twips (ignores margins)
 */
export function getPageWidthTwips(
  theme?: ThemeConfig,
  themeName?: string
): number {
  const page = getPageSetup(theme, themeName);
  return page?.size?.width || 0;
}

/**
 * Compute available page height in twips (page height minus top/bottom margins)
 */
export function getAvailableHeightTwips(
  theme?: ThemeConfig,
  themeName?: string
): number {
  const page = getPageSetup(theme, themeName);
  const height = page?.size?.height || 0;
  const top = page?.margin?.top || 0;
  const bottom = page?.margin?.bottom || 0;
  return Math.max(0, height - top - bottom);
}

/**
 * Compute full page height in twips (ignores margins)
 */
export function getPageHeightTwips(
  theme?: ThemeConfig,
  themeName?: string
): number {
  const page = getPageSetup(theme, themeName);
  return page?.size?.height || 0;
}

/**
 * Parse a percentage string like "75%" into a fraction 0..1
 */
export function parsePercentageStringToFraction(
  value: string
): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)%$/.exec(value);
  if (!match) return undefined;
  const pct = parseFloat(match[1]);
  if (pct < 0 || pct > 100) return undefined;
  return pct / 100;
}

/**
 * Convert a numeric (points) or percentage string to twips using available width
 */
export function relativeLengthToTwips(
  value: number | string,
  availableWidthTwips: number
): number {
  if (typeof value === 'number') {
    return pointsToTwips(value);
  }
  const fraction = parsePercentageStringToFraction(value);
  if (fraction === undefined) return 0;
  return Math.round(availableWidthTwips * fraction);
}

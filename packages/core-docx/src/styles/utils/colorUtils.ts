import { ThemeConfig } from '../index';
import { getThemeColors } from '../../themes/defaults';

export type ColorName = keyof ReturnType<typeof getThemeColors>;

// Union type for all valid color names
export type ValidColorName =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'text'
  | 'background'
  | 'textPrimary'
  | 'textSecondary'
  | 'textMuted'
  | 'borderPrimary'
  | 'borderSecondary'
  | 'backgroundPrimary'
  | 'backgroundSecondary';

// Type for color value that can be either a hex string or a color name
export type ColorValue = string; // Can be hex color or color name

/**
 * Resolves a color value, which can be either a hex color string or a color name reference
 * @param colorValue - Either a hex color (e.g., '#000000') or a color name (e.g., 'primary')
 * @param theme - The theme configuration containing color definitions
 * @returns The resolved hex color value (6-character hex without #)
 * @throws Error if the color value is invalid
 */
export function resolveColor(
  colorValue: ColorValue,
  theme: ThemeConfig
): string {
  // Check if it's a hex color with # prefix
  if (colorValue.startsWith('#')) {
    const hexValue = colorValue.slice(1);
    if (/^[0-9A-Fa-f]{6}$/.test(hexValue)) {
      return hexValue.toUpperCase(); // Normalize to uppercase
    }
    // Invalid hex format
    throw new Error(
      `Invalid hex color: "${colorValue}". Hex colors must be in format #RRGGBB (e.g., "#000000").`
    );
  }

  // If it's a color name, resolve it from the theme
  const colors = getThemeColors(theme);
  if (colorValue in colors) {
    const resolvedColor = colors[colorValue as ColorName];
    // Recursively resolve in case the theme color is also a reference
    return resolveColor(resolvedColor, theme);
  }

  // Strict validation - throw error for invalid colors
  throw new Error(
    `Invalid color value: "${colorValue}". Must be a hex color with # prefix (e.g., "#000000") or a valid theme color name.`
  );
}

/**
 * Validates if a color name exists in the theme
 * @param colorName - The color name to validate
 * @param theme - The theme configuration
 * @returns True if the color name exists in the theme
 */
export function isValidColorName(
  colorName: string,
  theme: ThemeConfig
): boolean {
  const colors = getThemeColors(theme);
  return colorName in colors;
}

/**
 * Gets all available color names from a theme
 * @param theme - The theme configuration
 * @returns Array of valid color names
 */
export function getAvailableColorNames(theme: ThemeConfig): string[] {
  const colors = getThemeColors(theme);
  return Object.keys(colors);
}

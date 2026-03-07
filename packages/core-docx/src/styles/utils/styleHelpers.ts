import { getTheme } from '../../templates/themes';
import { ThemeConfig } from '../index';
import { resolveColor } from './colorUtils';
import { LineSpacing } from '@json-to-office/shared-docx';
import { ISpacingProperties } from 'docx';
import { getNormalStyle } from '../../themes/defaults';

// Constants for line spacing calculations
const TWIPS_PER_POINT = 20;
const SINGLE_LINE_SPACING_POINTS = 12;
const SINGLE_LINE_SPACING_TWIPS = SINGLE_LINE_SPACING_POINTS * TWIPS_PER_POINT;
const DOUBLE_LINE_SPACING_TWIPS = SINGLE_LINE_SPACING_TWIPS * 2;

/**
 * Convert points to twips for docx spacing
 * @param points - Value in points
 * @returns Value in twips (1/20 of a point)
 */
export function pointsToTwips(points: number): number {
  return Math.round(points * TWIPS_PER_POINT);
}

/**
 * Resolve theme configuration from either a theme object or theme name
 * @param theme - Theme configuration object (for custom themes)
 * @param themeName - Theme name (for built-in themes)
 * @returns Resolved theme configuration
 */
export function resolveTheme(
  theme?: ThemeConfig,
  themeName?: string
): ThemeConfig | undefined {
  // First check if we have a theme object passed directly (for custom themes)
  if (theme) {
    return theme;
  }

  // If no theme object, check for built-in theme by name
  if (themeName) {
    return getTheme(themeName);
  }

  // Default to minimal theme if nothing else works
  return getTheme('minimal');
}

/**
 * Resolve font family from font reference (e.g., 'body', 'heading') to actual font family name
 * @param theme - Theme configuration object
 * @param fontRef - Font reference ('body', 'heading', 'mono', 'light') or undefined
 * @returns Actual font family name (e.g., 'Arial', 'Helvetica')
 */
export function resolveFontFamily(
  theme: ThemeConfig,
  fontRef?: 'heading' | 'body' | 'mono' | 'light'
): string {
  // Handle empty/invalid themes gracefully
  if (!theme?.fonts?.body?.family) {
    return 'Arial'; // fallback to Arial
  }
  if (!fontRef) {
    return theme.fonts.body.family;
  }
  return theme.fonts[fontRef]?.family || theme.fonts.body.family;
}

/**
 * Resolve font size from font reference (e.g., 'body', 'heading') to actual font size in points
 * @param theme - Theme configuration object
 * @param fontRef - Font reference ('body', 'heading', 'mono', 'light') or undefined
 * @returns Font size in points (callers multiply by 2 for docx) or undefined if no size found
 */
export function resolveFontSize(
  theme: ThemeConfig,
  fontRef?: 'heading' | 'body' | 'mono' | 'light'
): number | undefined {
  // Handle empty/invalid themes gracefully
  if (!theme?.fonts?.body?.size) {
    return undefined; // let caller handle fallback
  }
  if (!fontRef) {
    return theme.fonts.body.size;
  }
  return theme.fonts[fontRef]?.size || theme.fonts.body.size;
}

/**
 * Font properties that can be defined in font definitions
 */
export interface FontProperties {
  family?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: {
    type: 'single' | 'atLeast' | 'exactly' | 'double' | 'multiple';
    value?: number;
  };
  spacing?: {
    before?: number;
    after?: number;
  };
  characterSpacing?: { type: 'condensed' | 'expanded'; value: number };
}

/**
 * Resolve all font properties from font reference.
 * Returns all formatting properties defined in the font definition.
 * @param theme - Theme configuration object
 * @param fontRef - Font reference ('body', 'heading', 'mono', 'light') or undefined
 * @returns Object containing all font properties
 */
export function resolveFontProperties(
  theme: ThemeConfig,
  fontRef?: 'heading' | 'body' | 'mono' | 'light'
): FontProperties {
  // Default to body font if no reference provided
  const targetFontKey = fontRef || 'body';

  // Handle empty/invalid themes gracefully
  if (!theme?.fonts?.[targetFontKey]) {
    return {
      family: 'Arial',
      size: 11,
    };
  }

  const fontDef = theme.fonts[targetFontKey] as FontProperties;

  return {
    family: fontDef.family,
    size: fontDef.size,
    color: fontDef.color,
    bold: fontDef.bold,
    italic: fontDef.italic,
    underline: fontDef.underline,
    alignment: fontDef.alignment,
    lineSpacing: fontDef.lineSpacing,
    spacing: fontDef.spacing,
    characterSpacing: fontDef.characterSpacing,
  };
}

/**
 * Merge font properties with style overrides.
 * Style properties take precedence over font properties.
 * Only defined (non-undefined) style properties override font properties.
 * @param fontProps - Properties from font definition
 * @param styleOverrides - Properties from style definition
 * @returns Merged properties object
 */
export function mergeFontAndStyleProperties<T extends Partial<FontProperties>>(
  fontProps: FontProperties,
  styleOverrides: T
): FontProperties & T {
  // Filter out undefined values from styleOverrides to prevent overwriting font properties
  // Use type-safe Object.entries approach
  const definedOverrides = Object.entries(styleOverrides).reduce<
    Record<string, unknown>
  >((acc, [key, value]) => {
    if (value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {});

  return {
    ...fontProps,
    ...definedOverrides,
  } as FontProperties & T;
}

/**
 * Get body text style configuration
 * @param theme - Theme configuration object
 * @param themeName - Name of the theme (for fallback to built-in themes)
 * @returns Style configuration object
 */
export const getBodyTextStyle = (theme?: ThemeConfig, themeName?: string) => {
  const themeConfig = resolveTheme(theme, themeName);

  if (themeConfig) {
    const normalStyle = getNormalStyle(themeConfig);
    return {
      size: (normalStyle.size || 11) * 2,
      font: resolveFontFamily(themeConfig, normalStyle.font),
      color: normalStyle.color
        ? resolveColor(normalStyle.color, themeConfig)
        : '000000',
    };
  }

  // Fallback
  return {
    size: 20,
    font: 'Arial',
    color: '000000',
  };
};

/**
 * Converts line spacing from theme definition to DOCX spacing options.
 * DOCX uses twips (1/20th of a point) for line spacing.
 * @param lineSpacing The line spacing object from the theme definition.
 * @returns IParagraphSpacingOptions for docx.
 */
export function convertLineSpacing(
  lineSpacing?: LineSpacing | number
): ISpacingProperties | undefined {
  if (lineSpacing === undefined) {
    return undefined;
  }

  // Handle number (simple multiplier) case
  if (typeof lineSpacing === 'number') {
    return {
      line: Math.round(lineSpacing * SINGLE_LINE_SPACING_TWIPS),
      lineRule: 'auto',
    };
  }

  const { type, value } = lineSpacing;
  let line: number | undefined;
  let lineRule: 'auto' | 'exact' | 'atLeast' | undefined;

  switch (type) {
    case 'single':
      line = SINGLE_LINE_SPACING_TWIPS;
      lineRule = 'auto';
      break;
    case 'double':
      line = DOUBLE_LINE_SPACING_TWIPS;
      lineRule = 'auto';
      break;
    case 'atLeast':
      line = value !== undefined ? value * TWIPS_PER_POINT : undefined;
      lineRule = 'atLeast';
      break;
    case 'exactly':
      line = value !== undefined ? value * TWIPS_PER_POINT : undefined;
      lineRule = 'exact';
      break;
    case 'multiple':
      line =
        value !== undefined ? value * SINGLE_LINE_SPACING_TWIPS : undefined;
      lineRule = 'auto';
      break;
    default:
      return undefined;
  }

  return { line, lineRule };
}

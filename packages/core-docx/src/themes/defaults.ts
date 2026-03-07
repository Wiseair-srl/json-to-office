/**
 * Default theme values and utilities for handling optional theme properties
 */

import type { ThemeConfigJson } from '@json-to-office/shared-docx';

/**
 * Default colors for themes
 */
export const DEFAULT_COLORS = {
  primary: '#000000',
  secondary: '#666666',
  accent: '#0066CC',
  text: '#000000',
  background: '#FFFFFF',
  border: '#CCCCCC',
  // Semantic colors
  textPrimary: '#000000',
  textSecondary: '#666666',
  textMuted: '#999999',
  borderPrimary: '#CCCCCC',
  borderSecondary: '#E5E5E5',
  backgroundPrimary: '#FFFFFF',
  backgroundSecondary: '#F5F5F5',
};

/**
 * Default fonts for themes
 */
export const DEFAULT_FONTS = {
  heading: { family: 'Arial', size: 20 },
  body: { family: 'Arial', size: 11 },
  mono: { family: 'Courier New', size: 10 },
  light: { family: 'Arial', size: 24 },
};

/**
 * Default styles for themes
 */
export const DEFAULT_STYLES = {
  normal: {
    font: 'body' as const,
    size: 11,
    color: '#000000',
    alignment: 'left' as const,
    lineSpacing: {
      type: 'single' as const,
      value: 1,
    },
    spacing: {
      after: 6,
    },
  },
  heading1: {
    font: 'heading' as const,
    size: 24,
    color: '#000000',
    bold: true,
    spacing: {
      before: 12,
      after: 12,
    },
  },
  heading2: {
    font: 'heading' as const,
    size: 20,
    color: '#000000',
    bold: true,
    spacing: {
      before: 10,
      after: 10,
    },
  },
  heading3: {
    font: 'heading' as const,
    size: 16,
    color: '#000000',
    bold: true,
    spacing: {
      before: 8,
      after: 8,
    },
  },
  heading4: {
    font: 'heading' as const,
    size: 14,
    color: '#000000',
    bold: true,
    spacing: {
      before: 6,
      after: 6,
    },
  },
  heading5: {
    font: 'heading' as const,
    size: 12,
    color: '#000000',
    bold: true,
    spacing: {
      before: 6,
      after: 6,
    },
  },
  heading6: {
    font: 'heading' as const,
    size: 11,
    color: '#000000',
    bold: true,
    spacing: {
      before: 6,
      after: 6,
    },
  },
};

/**
 * Default page settings
 */
export const DEFAULT_PAGE = {
  size: 'LETTER' as const,
  margins: {
    top: 720,
    bottom: 720,
    left: 720,
    right: 720,
    header: 360,
    footer: 360,
    gutter: 0,
  },
};

/**
 * Ensures theme has all required properties with defaults
 */
export function ensureThemeDefaults(
  theme: Partial<ThemeConfigJson>
): ThemeConfigJson {
  return {
    $schema: theme.$schema,
    name: theme.name || 'default',
    displayName: theme.displayName || 'Default Theme',
    description: theme.description || 'Default theme configuration',
    version: theme.version || '1.0.0',
    colors: {
      ...DEFAULT_COLORS,
      ...(theme.colors || {}),
    },
    fonts: {
      heading: { ...DEFAULT_FONTS.heading, ...(theme.fonts?.heading || {}) },
      body: { ...DEFAULT_FONTS.body, ...(theme.fonts?.body || {}) },
      mono: { ...DEFAULT_FONTS.mono, ...(theme.fonts?.mono || {}) },
      light: { ...DEFAULT_FONTS.light, ...(theme.fonts?.light || {}) },
    },
    page: {
      ...DEFAULT_PAGE,
      ...(theme.page || {}),
      margins: {
        ...DEFAULT_PAGE.margins,
        ...(theme.page?.margins || {}),
      },
    },
    styles: theme.styles,
    componentDefaults: theme.componentDefaults,
  };
}

/**
 * Type guard to check if a theme has all required properties
 */
export function isCompleteTheme(theme: unknown): theme is ThemeConfigJson {
  const t = theme as Record<string, unknown>;
  return (
    t &&
    typeof t === 'object' &&
    !!t.colors &&
    !!t.fonts &&
    !!t.page &&
    typeof t.name === 'string' &&
    typeof t.displayName === 'string' &&
    typeof t.description === 'string' &&
    typeof t.version === 'string'
  );
}

/**
 * Safe getter for theme colors with defaults
 */
export function getThemeColors(theme: Partial<ThemeConfigJson>) {
  return {
    ...DEFAULT_COLORS,
    ...(theme.colors || {}),
  };
}

/**
 * Safe getter for theme fonts with defaults
 */
export function getThemeFonts(theme: Partial<ThemeConfigJson>) {
  return {
    ...DEFAULT_FONTS,
    ...(theme.fonts || {}),
  };
}

/**
 * Safe getter for theme styles with defaults
 */
export function getThemeStyles(theme: Partial<ThemeConfigJson>) {
  return {
    ...DEFAULT_STYLES,
    ...(theme.styles || {}),
  };
}

/**
 * Safe getter for normal style with defaults
 */
export function getNormalStyle(theme: Partial<ThemeConfigJson>) {
  const styles = getThemeStyles(theme);
  return {
    ...DEFAULT_STYLES.normal,
    ...(styles.normal || {}),
  };
}

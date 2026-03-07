/**
 * JSON-based themes registry
 * This file provides a unified interface to JSON themes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ThemeConfigJson } from '@json-to-office/shared-docx';
import { ensureThemeDefaults } from '../../themes/defaults';

// Import theme JSON files directly
import a2aThemeJson from './a2a.theme.json';
import hitachiThemeJson from './hitachi.theme.json';
import minimalThemeJson from './minimal.theme.json';
import verizonThemeJson from './verizon.theme.json';

/**
 * Registry of available themes loaded from JSON files
 */
let _themesCache: Record<string, ThemeConfigJson> | null = null;

function loadThemesFromJson(): Record<string, ThemeConfigJson> {
  if (_themesCache) {
    return _themesCache;
  }

  // Build themes from imported JSON files
  const themes: Record<string, ThemeConfigJson> = {
    a2a: ensureThemeDefaults(a2aThemeJson as ThemeConfigJson),
    hitachi: ensureThemeDefaults(hitachiThemeJson as ThemeConfigJson),
    minimal: ensureThemeDefaults(minimalThemeJson as ThemeConfigJson),
    verizon: ensureThemeDefaults(verizonThemeJson as ThemeConfigJson),
  };

  // Also try to load from file system for runtime additions (if available)
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const themesDir = path.join(__dirname, '../../../dist/templates/themes');

    if (fs.existsSync(themesDir)) {
      const themeFiles = fs
        .readdirSync(themesDir)
        .filter((file) => file.endsWith('.theme.json'))
        .map((file) => path.basename(file, '.theme.json'));

      for (const themeName of themeFiles) {
        if (!themes[themeName]) {
          try {
            const filePath = path.join(themesDir, `${themeName}.theme.json`);
            const content = fs.readFileSync(filePath, 'utf8');
            const parsedTheme = JSON.parse(content);
            themes[themeName] = ensureThemeDefaults(parsedTheme);
          } catch (error) {
            console.warn(
              `Failed to load additional theme ${themeName}:`,
              error
            );
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore if file system access fails (e.g., in bundled environment)
  }

  _themesCache = themes;
  return themes;
}

export const themes = loadThemesFromJson();

/**
 * Type representing valid theme names
 */
export type ThemeName = keyof typeof themes;

/**
 * Get theme configuration by name
 * @param themeName - Name of the theme to retrieve
 * @returns Theme configuration or undefined if not found
 */
export const getTheme = (themeName: string): ThemeConfigJson | undefined => {
  return themes[themeName];
};

/**
 * Get theme configuration with safe fallback
 * @param themeName - Name of the theme to retrieve
 * @param fallbackTheme - Fallback theme name (default: 'minimal')
 * @returns Theme configuration (guaranteed to be defined)
 * @throws Error if neither theme nor fallback can be found
 */
export const getThemeWithFallback = (
  themeName: string,
  fallbackTheme: string = 'minimal'
): ThemeConfigJson => {
  const theme = getTheme(themeName) || getTheme(fallbackTheme);

  if (!theme) {
    throw new Error(
      `Failed to load theme: ${themeName}. Fallback theme '${fallbackTheme}' also not found.`
    );
  }

  return theme;
};

/**
 * Check if a theme exists
 * @param themeName - Name of the theme to check
 * @returns True if theme exists, false otherwise
 */
export const hasTheme = (themeName: string): boolean => {
  return themeName in themes;
};

/**
 * Type guard to ensure theme name is valid
 * @param themeName - Theme name to validate
 * @returns True if theme name exists in registry
 */
export const isValidThemeName = (
  themeName: string
): themeName is keyof typeof themes => {
  return hasTheme(themeName);
};

/**
 * Get all available theme names
 * @returns Array of theme names
 */
export const getThemeNames = (): string[] => {
  return Object.keys(themes);
};

// Export individual theme configs for direct access
export const verizonTheme = themes['verizon'];
export const a2aTheme = themes['a2a'];
export const hitachiTheme = themes['hitachi'];
export const minimalTheme = themes['minimal'];

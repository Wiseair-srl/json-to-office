// Public API exports for JSON theme system
export {
  ThemeConfigSchema,
  type ThemeConfigJson,
  isValidThemeConfig,
} from '@json-to-office/shared-docx';
export { ThemeParser, ThemeValidationError, ThemeParseError } from './parser';
export {
  validateThemeJson,
  formatValidationErrors,
  type ValidationResult,
} from './validator';
export { ThemeLoader, ThemeFileError } from './loader';

// Main API functions - Core public interface for JSON theme system
import type { ThemeConfigJson } from '@json-to-office/shared-docx';
import { ThemeParser } from './parser';
import { ThemeLoader } from './loader';

// Global instances for consistent behavior
const themeParser = new ThemeParser();
const themeLoader = new ThemeLoader();

/**
 * Load and parse a theme from a JSON string
 * @param jsonString - JSON string containing theme definition
 * @returns Promise<ThemeConfig> - Parsed and validated theme configuration
 * @throws ThemeParseError - If JSON is malformed or invalid
 * @throws ThemeValidationError - If theme fails schema validation
 */
export async function loadThemeFromJson(
  jsonString: string
): Promise<ThemeConfigJson> {
  return themeParser.parse(jsonString);
}

/**
 * Load and parse a theme from a JSON file
 * @param filePath - Path to JSON file containing theme definition
 * @returns Promise<ThemeConfig> - Parsed and validated theme configuration
 * @throws ThemeFileError - If file cannot be read or path is invalid
 * @throws ThemeParseError - If JSON is malformed or invalid
 * @throws ThemeValidationError - If theme fails schema validation
 */
export async function loadThemeFromFile(
  filePath: string
): Promise<ThemeConfigJson> {
  return themeLoader.loadFromFile(filePath);
}

/**
 * Export a theme configuration to JSON string
 * @param theme - Theme configuration to export
 * @param pretty - Whether to format JSON with indentation (default: true)
 * @returns string - Formatted JSON string
 */
export function exportThemeToJson(
  theme: ThemeConfigJson,
  pretty: boolean = true
): string {
  try {
    // Since ThemeConfig is inferred from TypeBox schema, it can be directly serialized
    // The schema ensures all properties are JSON-serializable

    if (pretty) {
      return JSON.stringify(theme, null, 2);
    } else {
      return JSON.stringify(theme);
    }
  } catch (error) {
    throw new Error(
      `Failed to export theme to JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate a JSON string against the theme schema without parsing
 * @param jsonString - JSON string to validate
 * @returns Validation result with success status and detailed errors
 */
export function validateThemeJsonString(jsonString: string) {
  return themeParser.validate(jsonString);
}

/**
 * Create a minimal theme template for users to start with
 * @returns ThemeConfig - Basic theme with required properties
 */
export function createMinimalTheme(): ThemeConfigJson {
  return {
    name: 'minimal-theme',
    displayName: 'Minimal Theme',
    description: 'A minimal theme with basic styling',
    version: '1.0.0',
    colors: {
      primary: '2563EB',
      secondary: '64748B',
      accent: 'F8FAFC',
      text: '334155',
      background: 'FFFFFF',
      border: '334155',
      textPrimary: '334155',
      textSecondary: '64748B',
      textMuted: '94A3B8',
      borderPrimary: '334155',
      borderSecondary: '64748B',
      backgroundPrimary: 'FFFFFF',
      backgroundSecondary: 'F8FAFC',
    },
    fonts: {
      heading: { family: 'Arial', size: 14 },
      body: { family: 'Arial', size: 11 },
      mono: { family: 'Courier New', size: 10 },
      light: { family: 'Arial', size: 10 },
    },
    page: {
      size: 'A4',
      margins: {
        top: 1440,
        bottom: 1440,
        left: 1440,
        right: 1440,
        header: 720,
        footer: 720,
        gutter: 0,
      },
    },
    styles: {
      normal: {
        font: 'body',
        size: 11,
        color: '334155',
        alignment: 'left',
        lineSpacing: { type: 'multiple', value: 1.15 },
        spacing: { after: 8 },
      },
    },
  };
}

// Public API exports for JSON theme system
export {
  ThemeConfigSchema,
  type ThemeConfigJson,
  isValidThemeConfig,
  /**
   * Create a minimal theme template for users to start with.
   * Defined in shared-docx next to `ThemeConfigSchema` so every consumer
   * (CLI, playground) scaffolds from one schema-checked source.
   */
  createMinimalTheme,
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

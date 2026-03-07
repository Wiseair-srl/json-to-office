/**
 * Theme validation implementation
 * Single source of truth for all theme validation
 */

import type { Static } from '@sinclair/typebox';
import { ThemeConfigSchema } from '../../schemas/theme';
import type { ValidationOptions } from './types';
import { validateAgainstSchema, validateJson } from './base-validator';

// Re-export ThemeValidationResult type
export type { ThemeValidationResult } from './types';
import type { ThemeValidationResult } from './types';

/**
 * Validate a theme configuration object
 */
export function validateTheme(
  data: unknown,
  options?: ValidationOptions
): ThemeValidationResult {
  // Handle string input (theme name)
  if (typeof data === 'string') {
    // This is just a theme name, not a theme config
    // It will be resolved later by the theme resolver
    return {
      valid: true,
      themeName: data,
    };
  }

  const result = validateAgainstSchema(ThemeConfigSchema, data, options);

  // Add theme-specific metadata
  const themeResult: ThemeValidationResult = {
    ...result,
  };

  // Extract theme name if present
  if (result.valid && result.data) {
    const theme = result.data as any;
    if (theme.name) {
      themeResult.themeName = theme.name;
    }
  }

  return themeResult;
}

/**
 * Validate a theme JSON string or object
 * This replaces all three validateThemeJson implementations
 */
export function validateThemeJson(
  jsonInput: string | object,
  options?: ValidationOptions
): ThemeValidationResult {
  const result = validateJson(ThemeConfigSchema, jsonInput, options);

  // Add theme-specific metadata
  const themeResult: ThemeValidationResult = {
    ...result,
  };

  // Extract theme name if present
  if (result.valid && result.data) {
    const theme = result.data as any;

    // Inject default $schema if missing and it's an object
    if (typeof theme === 'object' && !theme.$schema) {
      theme.$schema = './json-schemas/theme.schema.json';
    }

    if (theme.name) {
      themeResult.themeName = theme.name;
    }
  }

  return themeResult;
}

/**
 * Validate theme with enhanced error messages
 */
export function validateThemeWithEnhancement(
  data: unknown,
  options?: ValidationOptions
): ThemeValidationResult {
  const result = validateTheme(data, options);

  // Enhance errors with theme-specific suggestions
  if (!result.valid && result.errors) {
    result.errors = result.errors.map((error) => {
      // Add specific suggestions for common theme errors
      if (error.path.includes('colors') && !error.suggestion) {
        error.suggestion = 'Colors must be valid hex, rgb, or named colors';
      }
      if (error.path.includes('fonts') && !error.suggestion) {
        error.suggestion = 'Fonts must include size and family properties';
      }
      if (error.path.includes('headings') && !error.suggestion) {
        error.suggestion = 'Headings must be an array of 6 style definitions';
      }
      return error;
    });
  }

  return result;
}

/**
 * Type guard for valid theme result
 */
export function isValidTheme(
  result: ThemeValidationResult
): result is ThemeValidationResult & {
  valid: true;
  data: Static<typeof ThemeConfigSchema>;
} {
  return result.valid === true && result.data !== undefined;
}

/**
 * Create a theme validator with default options
 */
export function createThemeValidator(defaultOptions?: ValidationOptions) {
  return {
    validate: (data: unknown, options?: ValidationOptions) =>
      validateTheme(data, { ...defaultOptions, ...options }),
    validateJson: (jsonInput: string | object, options?: ValidationOptions) =>
      validateThemeJson(jsonInput, { ...defaultOptions, ...options }),
    validateWithEnhancement: (data: unknown, options?: ValidationOptions) =>
      validateThemeWithEnhancement(data, { ...defaultOptions, ...options }),
  };
}

// Export convenient validators with common configurations
export const themeValidator = createThemeValidator({
  clean: true,
  applyDefaults: true,
});

export const strictThemeValidator = createThemeValidator({
  clean: false,
  applyDefaults: false,
  maxErrors: 10,
});

/**
 * Get theme name from data
 */
export function getThemeName(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'object' && data !== null && 'name' in data) {
    const theme = data as any;
    if (typeof theme.name === 'string') {
      return theme.name;
    }
  }

  return undefined;
}

/**
 * Check if theme config is valid (basic check without full validation)
 */
export function isThemeConfig(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const theme = data as any;
  return !!(theme.colors && theme.fonts);
}

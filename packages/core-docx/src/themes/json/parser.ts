/**
 * Theme Parser using unified validation (TypeBox under the hood)
 */

import type { ThemeConfigJson } from '@json-to-office/shared-docx';
import { validateThemeJson } from '@json-to-office/shared-docx/validation/unified';
import type { ValidationError } from '@json-to-office/shared-docx/validation/unified';
import { ensureThemeDefaults } from '../../themes/defaults';

// Custom error classes with enhanced error details
export class ThemeValidationError extends Error {
  constructor(public errors: ValidationError[]) {
    const errorCount = errors.length;
    const errorSummary = errors
      .slice(0, 3)
      .map((error) => {
        const path = error.path
          ? error.path.replace(/^\//, '').replace(/\//g, '.')
          : '';
        const pathStr = path ? `${path}: ` : '';
        return `${pathStr}${error.message}`;
      })
      .join('; ');

    super(
      `Theme validation failed with ${errorCount} error${errorCount > 1 ? 's' : ''}: ${errorSummary}${errorCount > 3 ? '...' : ''}`
    );
    this.name = 'ThemeValidationError';
  }

  getDetailedErrors(): string[] {
    return this.errors.map((error) => {
      const path = error.path
        ? error.path.replace(/^\//, '').replace(/\//g, '.')
        : '';
      const pathStr = path ? `${path}: ` : '';
      return `${pathStr}${error.message}`;
    });
  }
}

export class ThemeParseError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(`Failed to parse theme: ${message}`);
    this.name = 'ThemeParseError';
  }
}

// Theme parser class with comprehensive validation and error handling
export class ThemeParser {
  private readonly MAX_JSON_SIZE = 1024 * 1024; // 1MB limit (pre-parse guard)

  parse(jsonString: string): ThemeConfigJson {
    try {
      // Input validation and sanitization
      this.validateInput(jsonString);

      // Use unified validator (handles parsing + position calculation)
      const result = validateThemeJson(jsonString);
      if (!result.valid) {
        throw new ThemeValidationError(result.errors || []);
      }

      const validated = result.data as ThemeConfigJson;

      // Apply defaults and return ThemeConfig
      return this.applyDefaults(validated);
    } catch (error) {
      if (
        error instanceof ThemeValidationError ||
        error instanceof ThemeParseError
      ) {
        throw error;
      }
      throw new ThemeParseError(
        `Unexpected error during theme parsing: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private validateInput(jsonString: string): void {
    // Check for null/undefined
    if (!jsonString) {
      throw new ThemeParseError('JSON string cannot be null or empty');
    }

    // Check string type
    if (typeof jsonString !== 'string') {
      throw new ThemeParseError('Input must be a string');
    }

    // Check size limits (additional robustness guard)
    if (jsonString.length > this.MAX_JSON_SIZE) {
      throw new ThemeParseError(
        `JSON string too large (${jsonString.length} bytes, max ${this.MAX_JSON_SIZE} bytes)`
      );
    }
  }

  private applyDefaults(parsedTheme: ThemeConfigJson): ThemeConfigJson {
    // Apply defaults to ensure all required properties are present
    // This handles partial theme configurations by merging with defaults
    return ensureThemeDefaults(parsedTheme);
  }

  // Utility method for validating without parsing
  validate(jsonString: string): { valid: boolean; errors?: string[] } {
    try {
      this.validateInput(jsonString);
      const result = validateThemeJson(jsonString);

      if (result.valid) {
        return { valid: true };
      } else {
        const errors = (result.errors || []).map((e) => {
          const path = e.path
            ? e.path.replace(/^\//, '').replace(/\//g, '.')
            : '';
          const pathStr = path ? `${path}: ` : '';
          return `${pathStr}${e.message}`;
        });
        return { valid: false, errors };
      }
    } catch (error) {
      return {
        valid: false,
        errors: [
          error instanceof Error ? error.message : 'Unknown validation error',
        ],
      };
    }
  }
}

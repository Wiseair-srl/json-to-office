export interface ThemeValidationError {
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export interface ThemeValidationResult {
  valid: boolean;
  errors?: ThemeValidationError[];
}

/**
 * Validates a theme JSON string - checks structure without requiring format-specific schemas
 */
export function validateThemeJson(jsonString: string): ThemeValidationResult {
  try {
    const parsed = JSON.parse(jsonString);

    if (!parsed || typeof parsed !== 'object') {
      return {
        valid: false,
        errors: [{ message: 'Theme must be a JSON object' }],
      };
    }

    if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
      return {
        valid: false,
        errors: [{ message: 'Theme must have a non-empty "name" property' }],
      };
    }

    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          message:
            e instanceof SyntaxError
              ? `Invalid JSON: ${e.message}`
              : 'Failed to parse theme JSON',
        },
      ],
    };
  }
}

/**
 * Gets theme name from a theme JSON object
 */
export function getThemeName(themeJson: unknown): string | null {
  try {
    if (
      themeJson &&
      typeof themeJson === 'object' &&
      'name' in (themeJson as any) &&
      typeof (themeJson as any).name === 'string'
    ) {
      return (themeJson as any).name as string;
    }
    return null;
  } catch {
    return null;
  }
}

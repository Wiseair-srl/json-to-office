/**
 * Theme Validator - thin wrapper over shared unified validator
 * Maintains backward-compatible API while removing duplicate logic
 */

import { validateThemeJson as validateThemeJsonUnified } from '@json-to-office/shared-docx/validation/unified';

// Backward-compatible ValidationResult type used by core
export type ValidationResult = {
  success: boolean;
  error?: {
    issues: Array<{
      code: string;
      message: string;
      path: Array<string | number>;
      expected?: string;
      received?: string;
      type?: string;
      minimum?: number;
      maximum?: number;
      validation?: string;
      options?: string[];
      line?: number;
      column?: number;
    }>;
  };
};

// Validator function using unified shared validation
export function validateThemeJson(jsonString: string): ValidationResult {
  const result = validateThemeJsonUnified(jsonString);

  if (result.valid) {
    return { success: true };
  }

  const issues = (result.errors || []).map((e) => {
    const pathArray = (e.path || '')
      .split('/')
      .filter((p) => p)
      .map((p) => {
        const num = parseInt(p, 10);
        return isNaN(num) ? p : num;
      });

    return {
      code: e.code || 'validation_error',
      message: e.message,
      path: pathArray,
      line: e.line,
      column: e.column,
    };
  });

  return { success: false, error: { issues } };
}

export function formatValidationErrors(error: {
  issues: Array<any>;
}): string[] {
  return error.issues.map((issue) => {
    const path =
      issue.path && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    let message = issue.message;
    // Keep messages simple; unified validator already includes good messages
    return `${path}${message}`;
  });
}

export function isValidThemeJson(jsonString: string): boolean {
  const result = validateThemeJson(jsonString);
  return result.success;
}

export function getValidationSummary(jsonString: string): {
  valid: boolean;
  errorCount: number;
  errors: string[];
  summary: string;
} {
  const result = validateThemeJson(jsonString);

  if (result.success) {
    return {
      valid: true,
      errorCount: 0,
      errors: [],
      summary: 'Theme JSON is valid',
    };
  }

  const errors = formatValidationErrors(result.error!);
  const errorCount = errors.length;

  return {
    valid: false,
    errorCount,
    errors,
    summary: `Theme validation failed with ${errorCount} error${errorCount > 1 ? 's' : ''}`,
  };
}

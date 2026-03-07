import { ValueError } from '@sinclair/typebox/value';
import type { FormattedError } from './types';

/**
 * Error formatting utilities
 * @module validation/core/errors
 * @description
 * Enhanced error formatting for TypeBox validation errors.
 * Provides detailed, user-friendly error messages with context and suggestions.
 */

/**
 * Format a single TypeBox error into a user-friendly error message
 */
function formatSingleIssue(issue: ValueError): FormattedError {
  const path = issue.path || 'root';
  let message = issue.message;
  let suggestion: string | undefined;
  let expected: string | undefined;
  let received: string | undefined;
  let options: string[] | undefined;

  // Enhance error messages based on error type
  if (message.includes('Expected')) {
    const match = message.match(/Expected (.+) but received (.+)/);
    if (match) {
      expected = match[1];
      received = match[2];
      suggestion = getSuggestionForType(expected, received);
    }
  }

  // Handle required property errors
  if (message.includes('Required property')) {
    const match = message.match(/Required property '(.+)'/);
    if (match) {
      message = `Missing required field: ${match[1]}`;
      suggestion = `Add the required field: ${match[1]}`;
    }
  }

  // Handle unexpected property errors
  if (message.includes('Unexpected property')) {
    const match = message.match(/Unexpected property '(.+)'/);
    if (match) {
      message = `Unknown property: ${match[1]}`;
      suggestion = `Remove the unknown property: ${match[1]}`;
    }
  }

  // Handle union type errors
  if (message.includes('Expected union')) {
    message = 'Value does not match any of the expected types';
    suggestion = 'Check the documentation for valid format options';
  }

  // Handle literal value errors
  if (message.includes('Expected literal')) {
    const match = message.match(/Expected literal (.+)/);
    if (match) {
      expected = match[1];
      message = `Expected value: ${expected}`;
      suggestion = `Use the exact value: ${expected}`;
    }
  }

  // Handle string length errors
  if (message.includes('String length')) {
    const minMatch = message.match(/minimum length of (\d+)/);
    const maxMatch = message.match(/maximum length of (\d+)/);
    if (minMatch) {
      message = `String must be at least ${minMatch[1]} characters long`;
      suggestion = `Add more characters to meet the minimum length of ${minMatch[1]}`;
    } else if (maxMatch) {
      message = `String must be at most ${maxMatch[1]} characters long`;
      suggestion = `Reduce to ${maxMatch[1]} characters or less`;
    }
  }

  // Handle number range errors
  if (message.includes('Expected number')) {
    const minMatch = message.match(/minimum value of ([\d.]+)/);
    const maxMatch = message.match(/maximum value of ([\d.]+)/);
    if (minMatch) {
      message = `Number must be greater than or equal to ${minMatch[1]}`;
      suggestion = `Use a value of ${minMatch[1]} or higher`;
    } else if (maxMatch) {
      message = `Number must be less than or equal to ${maxMatch[1]}`;
      suggestion = `Use a value of ${maxMatch[1]} or lower`;
    }
  }

  // Handle array length errors
  if (message.includes('Array length')) {
    const minMatch = message.match(/minimum length of (\d+)/);
    const maxMatch = message.match(/maximum length of (\d+)/);
    if (minMatch) {
      message = `Array must have at least ${minMatch[1]} items`;
      suggestion = `Add more items to meet the minimum of ${minMatch[1]}`;
    } else if (maxMatch) {
      message = `Array must have at most ${maxMatch[1]} items`;
      suggestion = `Remove items to meet the maximum of ${maxMatch[1]}`;
    }
  }

  // Handle format errors
  if (message.includes('format')) {
    if (message.includes('email')) {
      message = 'Invalid email address format';
      suggestion = 'Use a valid email format like user@example.com';
    } else if (message.includes('uri') || message.includes('url')) {
      message = 'Invalid URL format';
      suggestion = 'Use a valid URL format like https://example.com';
    } else if (message.includes('date-time')) {
      message = 'Invalid date-time format';
      suggestion = 'Use ISO 8601 format like 2024-01-01T00:00:00Z';
    }
  }

  // Handle pattern errors
  if (message.includes('pattern')) {
    message = 'String does not match the required pattern';
    suggestion = 'Check the format requirements for this field';
  }

  return {
    path,
    message,
    code: String(issue.type || 'validation_error'),
    suggestion,
    expected,
    received,
    options,
  };
}

/**
 * Get type-specific suggestions for common type mismatches
 */
function getSuggestionForType(
  expected: string,
  received: string
): string | undefined {
  // Number/String confusion
  if (expected === 'number' && received === 'string') {
    return 'Remove quotes or convert the string to a number';
  }
  if (expected === 'string' && received === 'number') {
    return 'Add quotes or convert the number to a string';
  }

  // Boolean confusion
  if (expected === 'boolean') {
    return 'Use true or false (without quotes)';
  }

  // Array/Object confusion
  if (expected === 'array' && received === 'object') {
    return 'Use square brackets [] for arrays instead of curly braces {}';
  }
  if (expected === 'object' && received === 'array') {
    return 'Use curly braces {} for objects instead of square brackets []';
  }

  // Null/undefined handling
  if (received === 'null' || received === 'undefined') {
    return `Provide a valid ${expected} value or mark the field as optional`;
  }

  return undefined;
}

/**
 * Format TypeBox validation errors into detailed, user-friendly messages
 */
export function formatTypeBoxError(errors: ValueError[]): FormattedError[] {
  return errors.map(formatSingleIssue);
}

/**
 * Format errors as simple string array (backward compatible)
 */
export function formatTypeBoxErrorStrings(errors: ValueError[]): string[] {
  return formatTypeBoxError(errors).map((err) => {
    let msg = `${err.path}: ${err.message}`;
    if (err.suggestion) {
      msg += ` (Suggestion: ${err.suggestion})`;
    }
    return msg;
  });
}

/**
 * Get a summary of validation errors grouped by path
 */
export function getErrorSummary(
  errors: ValueError[]
): Map<string, FormattedError[]> {
  const summary = new Map<string, FormattedError[]>();

  for (const formattedError of formatTypeBoxError(errors)) {
    const existing = summary.get(formattedError.path) || [];
    existing.push(formattedError);
    summary.set(formattedError.path, existing);
  }

  return summary;
}

/**
 * Format validation errors as a detailed report
 */
export function formatErrorReport(errors: ValueError[]): string {
  const formattedErrors = formatTypeBoxError(errors);
  const summary = getErrorSummary(errors);

  let report = `Validation failed with ${formattedErrors.length} error${formattedErrors.length > 1 ? 's' : ''}:\n\n`;

  for (const [path, pathErrors] of summary) {
    report += `📍 ${path}:\n`;
    for (const err of pathErrors) {
      report += `   ❌ ${err.message}\n`;
      if (err.suggestion) {
        report += `   💡 ${err.suggestion}\n`;
      }
      if (err.expected && err.received) {
        report += `   📋 Expected: ${err.expected}, Received: ${err.received}\n`;
      }
      if (err.options) {
        report += `   📋 Valid options: ${err.options.join(', ')}\n`;
      }
    }
    report += '\n';
  }

  return report;
}

/**
 * Check if an error is critical (affects core functionality)
 */
export function hasCriticalErrors(errors: ValueError[]): boolean {
  return errors.some((issue) => {
    // Missing required fields are critical
    if (issue.message.includes('Required property')) {
      return true;
    }

    // Invalid component names are critical
    if (
      issue.path.includes('name') &&
      issue.message.includes('Expected literal')
    ) {
      return true;
    }

    // Schema structure errors are critical
    if (
      issue.message.includes('Expected union') ||
      issue.message.includes('Never')
    ) {
      return true;
    }

    return false;
  });
}

/**
 * Get validation context for better error messages
 */
export function getValidationContext(path: string): string {
  if (!path || path === 'root') return 'document root';

  const pathParts = path.split('.');

  // Identify component context
  if (pathParts.includes('children')) {
    const childIndex = pathParts.indexOf('children');
    if (pathParts.length > childIndex + 1) {
      const index = pathParts[childIndex + 1];
      return `component at index ${index}`;
    }
  }

  // Identify props context
  if (pathParts.includes('props')) {
    return `props section`;
  }

  // Identify theme context
  if (pathParts.includes('theme')) {
    return `theme configuration`;
  }

  return pathParts.join(' > ');
}

// ============================================================================
// Legacy Compatibility Exports (for API backward compatibility)
// ============================================================================

// Primary exports - use formatTypeBoxError and formatTypeBoxErrorStrings directly
export const formatValidationError = formatTypeBoxError;
export const formatValidationErrorStrings = formatTypeBoxErrorStrings;

/**
 * Base validator implementation
 * Core validation logic that eliminates duplication across the codebase
 */

import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import type {
  ValidationResult,
  ValidationOptions,
  JsonValidationResult,
} from './types';
import {
  transformValueErrors,
  createJsonParseError,
  formatErrorSummary,
} from '@json-to-office/shared';

/**
 * Base validation function that all specific validators use
 * This eliminates the repeated Value.Check -> Value.Errors -> map pattern
 */
export function validateAgainstSchema<T extends TSchema>(
  schema: T,
  data: unknown,
  options?: ValidationOptions
): ValidationResult<Static<T>> {
  try {
    // Check if data matches the schema
    if (!Value.Check(schema, data)) {
      // Collect ALL errors (not just the first one)
      const errors = [...Value.Errors(schema, data)];
      const transformedErrors = transformValueErrors(errors, {
        jsonString: options?.jsonString,
        maxErrors: options?.maxErrors || 100, // Default to 100 if not specified
      });

      return {
        valid: false,
        errors: transformedErrors,
      };
    }

    // Data is valid, apply transformations if requested
    let processedData = data;

    if (options?.clean) {
      // Remove unknown properties
      processedData = Value.Clean(schema, Value.Clone(processedData));
    }

    if (options?.applyDefaults) {
      // Apply default values
      processedData = Value.Default(schema, processedData);
    }

    return {
      valid: true,
      data: processedData as Static<T>,
    };
  } catch (error) {
    // Handle unexpected errors
    return {
      valid: false,
      errors: [
        {
          path: 'root',
          message:
            error instanceof Error ? error.message : 'Unknown validation error',
          code: 'validation_exception',
        },
      ],
    };
  }
}

/**
 * Validate JSON string or object with schema
 */
export function validateJson<T extends TSchema>(
  schema: T,
  jsonInput: string | object,
  options?: ValidationOptions
): JsonValidationResult<Static<T>> {
  // Handle string input
  if (typeof jsonInput === 'string') {
    // Basic input validation
    if (!jsonInput.trim()) {
      return {
        valid: false,
        errors: [
          {
            path: 'root',
            message: 'Input must be a non-empty string',
            code: 'empty_input',
          },
        ],
        isJsonError: true,
      };
    }

    // Try to parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonInput);
    } catch (error) {
      if (error instanceof Error) {
        return {
          valid: false,
          errors: [createJsonParseError(error, jsonInput)],
          isJsonError: true,
        };
      }
      return {
        valid: false,
        errors: [
          {
            path: 'root',
            message: 'Failed to parse JSON',
            code: 'json_parse_error',
          },
        ],
        isJsonError: true,
      };
    }

    // Validate parsed object with position calculation
    const result = validateAgainstSchema(schema, parsed, {
      ...options,
      jsonString: jsonInput,
      calculatePosition: true,
    });

    return {
      ...result,
      parsed,
      isJsonError: false,
    };
  }

  // Handle object input directly
  const result = validateAgainstSchema(schema, jsonInput, options);
  return {
    ...result,
    parsed: jsonInput,
    isJsonError: false,
  };
}

/**
 * Batch validate multiple items
 */
export function validateBatch<T extends TSchema>(
  schema: T,
  items: unknown[],
  options?: ValidationOptions
): ValidationResult<Static<T>[]> {
  const results: Static<T>[] = [];
  const allErrors: any[] = [];
  let hasErrors = false;

  for (let i = 0; i < items.length; i++) {
    const result = validateAgainstSchema(schema, items[i], options);

    if (result.valid && result.data) {
      results.push(result.data);
    } else {
      hasErrors = true;
      if (result.errors) {
        // Prefix errors with item index
        const prefixedErrors = result.errors.map((e) => ({
          ...e,
          path: `[${i}]${e.path ? '/' + e.path : ''}`,
        }));
        allErrors.push(...prefixedErrors);
      }
    }

    // Stop if we've hit the max errors
    if (options?.maxErrors && allErrors.length >= options.maxErrors) {
      break;
    }
  }

  if (hasErrors) {
    return {
      valid: false,
      errors: allErrors.slice(0, options?.maxErrors),
    };
  }

  return {
    valid: true,
    data: results,
  };
}

/**
 * Validate with custom error enhancement
 */
export function validateWithEnhancement<T extends TSchema>(
  schema: T,
  data: unknown,
  enhancer: (errors: any[]) => any[],
  options?: ValidationOptions
): ValidationResult<Static<T>> {
  const result = validateAgainstSchema(schema, data, options);

  if (!result.valid && result.errors) {
    result.errors = enhancer(result.errors);
  }

  return result;
}

/**
 * Create a validator function for a specific schema
 */
export function createValidator<T extends TSchema>(
  schema: T,
  defaultOptions?: ValidationOptions
) {
  return (data: unknown, options?: ValidationOptions) => {
    return validateAgainstSchema(schema, data, {
      ...defaultOptions,
      ...options,
    });
  };
}

/**
 * Create a JSON validator function for a specific schema
 */
export function createJsonValidator<T extends TSchema>(
  schema: T,
  defaultOptions?: ValidationOptions
) {
  return (jsonInput: string | object, options?: ValidationOptions) => {
    return validateJson(schema, jsonInput, {
      ...defaultOptions,
      ...options,
    });
  };
}

/**
 * Utility to check if validation result is successful with type guard
 */
export function isValidationSuccess<T>(
  result: ValidationResult<T>
): result is ValidationResult<T> & { valid: true; data: T } {
  return result.valid === true && result.data !== undefined;
}

/**
 * Get validation error summary
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid) {
    return 'Validation successful';
  }

  if (!result.errors || result.errors.length === 0) {
    return 'Validation failed with unknown error';
  }

  return formatErrorSummary(result.errors);
}

import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import type { ValidationResult as BaseValidationResult } from '../validation/unified';
import {
  transformValueErrors,
  formatErrorSummary,
} from '../validation/unified';

/**
 * Validation options for plugin components
 */
export interface PluginValidationOptions {
  /** Apply Value.Clean to remove unknown properties */
  clean?: boolean;
  /** Apply Value.Default to add default values */
  applyDefaults?: boolean;
  /** Maximum number of errors to collect */
  maxErrors?: number;
  /** Original JSON string for position calculation */
  jsonString?: string;
  /** Calculate line/column for JSON errors */
  calculatePosition?: boolean;
}

/**
 * Generic validation result extending the base non-generic one
 */
export interface PluginValidationResult<T = unknown>
  extends BaseValidationResult {
  data?: T;
}

/**
 * Component-specific validation result
 */
export interface ComponentValidationResult<T = unknown>
  extends PluginValidationResult<T> {
  componentName?: string;
  isCustomComponent?: boolean;
  success?: boolean;
}

/**
 * Base validation: schema check + optional clean/defaults
 */
export function validateAgainstSchema<T extends TSchema>(
  schema: T,
  data: unknown,
  options?: PluginValidationOptions
): PluginValidationResult<Static<T>> {
  try {
    let processedData: unknown = Value.Clone(data);

    if (options?.applyDefaults) {
      processedData = Value.Default(schema, processedData);
    }

    if (options?.clean) {
      processedData = Value.Clean(schema, processedData);
    }

    if (!Value.Check(schema, processedData)) {
      const errors = [...Value.Errors(schema, processedData)];
      const transformedErrors = transformValueErrors(errors, {
        jsonString: options?.jsonString,
        maxErrors: options?.maxErrors || 100,
      });

      return { valid: false, errors: transformedErrors };
    }

    return { valid: true, data: processedData as Static<T> };
  } catch (error) {
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
 * Validate custom component props against a TypeBox schema.
 * Hardcodes clean + applyDefaults for consistent plugin behavior.
 */
export function validateCustomComponentProps<T>(
  componentSchema: TSchema,
  config: unknown,
  options?: PluginValidationOptions & { componentName?: string }
): ComponentValidationResult<T> {
  const name = options?.componentName ?? 'custom';
  try {
    const result = validateAgainstSchema(componentSchema, config, {
      ...options,
      clean: options?.clean ?? true,
      applyDefaults: options?.applyDefaults ?? true,
    });

    return {
      ...result,
      success: result.valid,
      data: result.data as T,
      componentName: name,
      isCustomComponent: true,
    };
  } catch (error) {
    return {
      valid: false,
      success: false,
      errors: [
        {
          path: 'props',
          message:
            error instanceof Error ? error.message : 'Unknown validation error',
          code: 'validation_exception',
        },
      ],
      componentName: name,
      isCustomComponent: true,
    };
  }
}

/**
 * Utility to check if validation result is successful with type guard
 */
export function isValidationSuccess<T>(
  result: PluginValidationResult<T>
): result is PluginValidationResult<T> & { valid: true; data: T } {
  return result.valid === true && result.data !== undefined;
}

/**
 * Get validation error summary
 */
export function getValidationSummary(result: PluginValidationResult): string {
  if (result.valid) {
    return 'Validation successful';
  }

  if (!result.errors || result.errors.length === 0) {
    return 'Validation failed with unknown error';
  }

  return formatErrorSummary(result.errors);
}

import { Value } from '@sinclair/typebox/value';
import { Static } from '@sinclair/typebox';
import {
  ComponentDefinitionSchema,
  ReportPropsSchema,
  SectionPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ColumnsPropsSchema,
  ImagePropsSchema,
  StatisticPropsSchema,
  TablePropsSchema,
  ListPropsSchema,
} from '../../schemas/components';
import { CustomComponentDefinitionSchema } from '../../schemas/custom-components';
import {
  formatTypeBoxError,
  formatTypeBoxErrorStrings,
  formatErrorReport,
  hasCriticalErrors,
} from './errors';
import type {
  CoreValidationResult,
  ValidationOptions,
  BatchValidationResult,
  ComponentValidationConfig,
  DataTransformer,
} from './types';

/**
 * Core validation engine
 * @module validation/core/validator
 * @description
 * Main validation utilities using TypeBox for runtime validation.
 * Provides comprehensive validation with error handling and data transformation.
 */

/**
 * Component name to schema mapping
 */
const COMPONENT_SCHEMA_MAP = {
  report: ReportPropsSchema,
  section: SectionPropsSchema,
  heading: HeadingPropsSchema,
  paragraph: ParagraphPropsSchema,
  columns: ColumnsPropsSchema,
  image: ImagePropsSchema,
  statistic: StatisticPropsSchema,
  table: TablePropsSchema,
  list: ListPropsSchema,
} as const;

export type StandardComponentName = keyof typeof COMPONENT_SCHEMA_MAP;

/**
 * Validate any component configuration with comprehensive error handling
 */
export function validateComponent<T extends StandardComponentName>(
  name: T,
  props: unknown,
  options?: ValidationOptions
): CoreValidationResult<Static<(typeof COMPONENT_SCHEMA_MAP)[T]>> {
  const schema = COMPONENT_SCHEMA_MAP[name];

  if (!schema) {
    // Handle custom components
    if (Value.Check(CustomComponentDefinitionSchema, props)) {
      return {
        success: true,
        data: props as Static<(typeof COMPONENT_SCHEMA_MAP)[T]>,
      };
    }

    const errors = [...Value.Errors(CustomComponentDefinitionSchema, props)];
    const formattedErrors = formatTypeBoxError(errors);
    return {
      success: false,
      errors: formattedErrors,
      errorStrings: formatTypeBoxErrorStrings(errors),
      report: options?.includeReport ? formatErrorReport(errors) : undefined,
      hasCriticalErrors: options?.checkCritical
        ? hasCriticalErrors(errors)
        : undefined,
    };
  }

  // Validate with the schema
  if (Value.Check(schema, props)) {
    return {
      success: true,
      data: props as Static<(typeof COMPONENT_SCHEMA_MAP)[T]>,
    };
  }

  const errors = [...Value.Errors(schema, props)];
  const formattedErrors = formatTypeBoxError(errors);
  return {
    success: false,
    errors: formattedErrors,
    errorStrings: formatTypeBoxErrorStrings(errors),
    report: options?.includeReport ? formatErrorReport(errors) : undefined,
    hasCriticalErrors: options?.checkCritical
      ? hasCriticalErrors(errors)
      : undefined,
  };
}

/**
 * Validate a complete component definition (with nested children)
 */
export function validateComponentDefinition(
  component: unknown,
  options?: ValidationOptions
): CoreValidationResult<Static<typeof ComponentDefinitionSchema>> {
  // Check for circular references or excessive nesting
  const maxDepth = options?.maxDepth ?? 10;
  const currentDepth = options?.currentDepth ?? 0;

  if (currentDepth > maxDepth) {
    return {
      success: false,
      errors: [
        {
          path: 'children',
          message: `Maximum nesting depth (${maxDepth}) exceeded`,
          code: 'custom',
          suggestion: 'Reduce the nesting level of components',
        },
      ],
      errorStrings: [`Maximum nesting depth (${maxDepth}) exceeded`],
      hasCriticalErrors: true,
    };
  }

  if (Value.Check(ComponentDefinitionSchema, component)) {
    // Validate nested children recursively
    const data = component as any;
    const warnings: string[] = [];

    if (data.children && Array.isArray(data.children)) {
      for (let i = 0; i < data.children.length; i++) {
        const nestedResult = validateComponentDefinition(data.children[i], {
          ...options,
          currentDepth: currentDepth + 1,
        });

        if (!nestedResult.success) {
          // Add context to nested errors
          const nestedErrors = nestedResult.errors?.map((err) => ({
            ...err,
            path: `children[${i}].${err.path}`,
          }));

          return {
            success: false,
            errors: nestedErrors,
            errorStrings: nestedErrors?.map(
              (err) => `${err.path}: ${err.message}`
            ),
            report: options?.includeReport
              ? `Validation failed in nested component at index ${i}:\n${nestedResult.report}`
              : undefined,
            hasCriticalErrors: nestedResult.hasCriticalErrors,
          };
        }

        if (nestedResult.warnings) {
          warnings.push(
            ...nestedResult.warnings.map((w) => `children[${i}]: ${w}`)
          );
        }
      }
    }

    return {
      success: true,
      data: component as Static<typeof ComponentDefinitionSchema>,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  const errors = [...Value.Errors(ComponentDefinitionSchema, component)];
  const formattedErrors = formatTypeBoxError(errors);
  return {
    success: false,
    errors: formattedErrors,
    errorStrings: formatTypeBoxErrorStrings(errors),
    report: options?.includeReport ? formatErrorReport(errors) : undefined,
    hasCriticalErrors: options?.checkCritical
      ? hasCriticalErrors(errors)
      : undefined,
  };
}

/**
 * Batch validate multiple components
 */
export function validateComponents(
  components: ComponentValidationConfig[],
  options?: ValidationOptions
): BatchValidationResult {
  const results: CoreValidationResult<any>[] = [];
  let criticalCount = 0;

  for (const { name, props } of components) {
    const result =
      name in COMPONENT_SCHEMA_MAP
        ? validateComponent(name as StandardComponentName, props, options)
        : validateComponentDefinition(props, options);

    results.push(result);

    if (result.hasCriticalErrors) {
      criticalCount++;
    }

    if (!result.success && options?.stopOnFirst) {
      break;
    }
  }

  const valid = results.filter((r) => r.success).length;
  const invalid = results.length - valid;

  return {
    success: invalid === 0,
    results,
    summary: {
      total: results.length,
      valid,
      invalid,
      criticalErrors: criticalCount,
    },
  };
}

/**
 * Transform and validate data (for migration scenarios)
 */
export function transformAndValidate<T extends StandardComponentName>(
  name: T,
  data: unknown,
  transformer?: DataTransformer
): CoreValidationResult<Static<(typeof COMPONENT_SCHEMA_MAP)[T]>> {
  try {
    // Apply custom transformation if provided
    const transformed = transformer ? transformer(data) : data;

    // Validate the transformed data
    return validateComponent(name, transformed, {
      includeReport: true,
      checkCritical: true,
    });
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'root',
          message: `Transformation failed: ${error instanceof Error ? error.message : String(error)}`,
          code: 'custom',
        },
      ],
      errorStrings: [
        `Transformation failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      hasCriticalErrors: true,
    };
  }
}

/**
 * Create a validated component with defaults
 */
export function createValidatedComponent<T extends StandardComponentName>(
  name: T,
  partialConfig: Partial<Static<(typeof COMPONENT_SCHEMA_MAP)[T]>>
): CoreValidationResult<Static<(typeof COMPONENT_SCHEMA_MAP)[T]>> {
  const schema = COMPONENT_SCHEMA_MAP[name];

  if (!schema) {
    return {
      success: false,
      errors: [
        {
          path: 'name',
          message: `Unknown component name: ${name}`,
          code: 'custom',
          suggestion: `Use one of: ${Object.keys(COMPONENT_SCHEMA_MAP).join(', ')}`,
        },
      ],
      errorStrings: [`Unknown component name: ${name}`],
      hasCriticalErrors: true,
    };
  }

  // Validate with TypeBox
  if (Value.Check(schema, partialConfig)) {
    return {
      success: true,
      data: partialConfig as Static<(typeof COMPONENT_SCHEMA_MAP)[T]>,
    };
  }

  const errors = [...Value.Errors(schema, partialConfig)];
  const formattedErrors = formatTypeBoxError(errors);
  return {
    success: false,
    errors: formattedErrors,
    errorStrings: formatTypeBoxErrorStrings(errors),
    report: formatErrorReport(errors),
    hasCriticalErrors: hasCriticalErrors(errors),
  };
}

/**
 * Type guard functions with proper error context
 */
export function isValidComponent<T extends StandardComponentName>(
  name: T,
  props: unknown
): props is Static<(typeof COMPONENT_SCHEMA_MAP)[T]> {
  const result = validateComponent(name, props);
  return result.success;
}

/**
 * Validate JSON string input
 */
export function validateJsonComponent<T extends StandardComponentName>(
  name: T,
  jsonString: string
): CoreValidationResult<Static<(typeof COMPONENT_SCHEMA_MAP)[T]>> {
  try {
    const parsed = JSON.parse(jsonString);
    return validateComponent(name, parsed, {
      includeReport: true,
      checkCritical: true,
    });
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'root',
          message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          code: 'custom',
          suggestion: 'Check for syntax errors in your JSON',
        },
      ],
      errorStrings: [
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
      hasCriticalErrors: true,
    };
  }
}

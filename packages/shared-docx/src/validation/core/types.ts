/**
 * Core validation types
 * @module validation/core/types
 * @description
 * Shared types used across the validation system
 */

// Pure TypeScript types for validation system - no external dependencies

/**
 * Validation result with detailed information
 */
export interface CoreValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: FormattedError[];
  errorStrings?: string[];
  report?: string;
  hasCriticalErrors?: boolean;
  warnings?: string[];
}

/**
 * Formatted error with additional context
 */
export interface FormattedError {
  path: string;
  message: string;
  code: string;
  suggestion?: string;
  expected?: string;
  received?: string;
  options?: string[];
}

/**
 * Validation options for customizing behavior
 */
export interface ValidationOptions {
  includeReport?: boolean;
  checkCritical?: boolean;
  strict?: boolean;
  maxDepth?: number;
  currentDepth?: number;
  stopOnFirst?: boolean;
}

/**
 * Batch validation result
 */
export interface BatchValidationResult<T = any> {
  success: boolean;
  results: CoreValidationResult<T>[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    criticalErrors: number;
  };
}

/**
 * Component validation configuration
 */
export interface ComponentValidationConfig {
  name: string;
  props: unknown;
}

/**
 * Transformer function for data migration
 */
export type DataTransformer<T = any> = (data: any) => T;

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  CRITICAL = 'critical',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

/**
 * Validation context for better error messages
 */
export interface ValidationContext {
  file?: string;
  line?: number;
  column?: number;
  component?: string;
  operation?: string;
}

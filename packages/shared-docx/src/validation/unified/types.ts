/**
 * Unified validation types
 * Single source of truth for all validation-related types
 */

import type { ValueError } from '@sinclair/typebox/value';

/**
 * Generic validation result that can be used for any validation scenario
 */
export interface ValidationResult<T = unknown> {
  valid: boolean;
  success?: boolean; // Added for backward compatibility
  data?: T;
  errors?: ValidationError[];
}

/**
 * Standardized validation error format
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
  value?: unknown;
  line?: number;
  column?: number;
  suggestion?: string;
}

/**
 * Options for validation behavior
 */
export interface ValidationOptions {
  /** Apply Value.Clean to remove unknown properties */
  clean?: boolean;
  /** Apply Value.Default to add default values */
  applyDefaults?: boolean;
  /** Include detailed error reports */
  includeReport?: boolean;
  /** Calculate line/column for JSON errors */
  calculatePosition?: boolean;
  /** Original JSON string for position calculation */
  jsonString?: string;
  /** Maximum number of errors to collect */
  maxErrors?: number;
}

/**
 * Result specifically for JSON parsing with validation
 */
export interface JsonValidationResult<T = unknown> extends ValidationResult<T> {
  parsed?: unknown;
  isJsonError?: boolean;
}

/**
 * Theme-specific validation result
 */
export interface ThemeValidationResult extends ValidationResult {
  themeName?: string;
}

/**
 * Document-specific validation result
 */
export interface DocumentValidationResult extends ValidationResult {
  documentType?: string;
  hasCustomComponents?: boolean;
  errors: ValidationError[]; // Made non-optional to match existing type
  warnings?: ValidationError[];
}

/**
 * Component-specific validation result
 */
export interface ComponentValidationResult<T = unknown>
  extends ValidationResult<T> {
  componentName?: string;
  isCustomComponent?: boolean;
  success?: boolean;
}

/**
 * TypeBox error with additional context
 */
export interface EnhancedValueError extends ValueError {
  suggestion?: string;
  severity?: 'error' | 'warning' | 'info';
}

/**
 * Unified validation types - extends @json-to-office/shared types
 */

import type { ValueError } from '@sinclair/typebox/value';
import type {
  ValidationError as SharedValidationError,
  ValidationResult as SharedValidationResult,
} from '@json-to-office/shared';

/**
 * Re-export the shared ValidationError type.
 * Docx validation code uses this everywhere.
 */
export type ValidationError = SharedValidationError;

/**
 * Generic validation result that can be used for any validation scenario
 */
export interface ValidationResult<T = unknown> extends SharedValidationResult {
  success?: boolean;
  data?: T;
  errors?: ValidationError[];
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
  /**
   * When true, unknown/extra properties are stripped before validation instead
   * of being rejected by additionalProperties:false. Escape hatch for callers
   * migrating onto strict schemas.
   */
  allowUnknownFields?: boolean;
  /**
   * Names of registered plugin components. They are not flagged as unknown and
   * their props are not checked against a standard schema here — the plugin
   * layer validates custom props version-aware separately.
   */
  knownCustomNames?: Set<string>;
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

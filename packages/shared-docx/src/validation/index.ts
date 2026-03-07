/**
 * Validation module exports
 * @module validation
 * @description
 * Public API for the validation system.
 * Provides comprehensive validation utilities using TypeBox for runtime validation.
 *
 * Directory Structure:
 * - core/       Core validation engine and error handling
 * - validators/ Specific validators for components, themes, documents
 * - parsers/    JSON and other format parsers with enhanced error reporting
 */

// ============================================================================
// Core Validation Engine
// ============================================================================

export {
  // Main validation functions
  validateComponent,
  validateComponentDefinition,
  validateComponents,
  transformAndValidate,
  createValidatedComponent,
  isValidComponent,
  // Type exports
  type StandardComponentName,
} from './core/validator';

// ============================================================================
// Error Handling
// ============================================================================

export {
  // Error formatting functions
  formatTypeBoxError,
  formatTypeBoxErrorStrings,
  formatErrorReport,
  getErrorSummary,
  hasCriticalErrors,
  getValidationContext,
  // Primary exports
  formatValidationError,
  formatValidationErrorStrings,
} from './core/errors';

// ============================================================================
// Type Definitions
// ============================================================================

export type {
  // Core types
  CoreValidationResult,
  FormattedError,
  ValidationOptions,
  BatchValidationResult,
  ComponentValidationConfig,
  DataTransformer,
  ValidationContext,
  ErrorSeverity,
} from './core/types';

// ============================================================================
// Component Validators
// ============================================================================

export {
  // Component validation functions
  validateComponentProps,
  safeValidateComponentProps,
  safeValidateComponentDefinition,
  // Type guards
  isReportProps,
  isSectionProps,
  isHeadingProps,
  isParagraphProps,
  isColumnsProps,
  isImageProps,
  isStatisticProps,
  isTableProps,
  isHeaderProps,
  isFooterProps,
  isListProps,
  isCustomComponentProps,
  // Error formatting
  getValidationErrors,
} from './validators/component';

// ============================================================================
// Theme Validators
// ============================================================================

export {
  // Theme validation functions
  validateThemeJson,
  isValidThemeJson,
  getValidationSummary,
  // Types
  type ThemeValidationResult,
} from './validators/theme';

// ============================================================================
// JSON Parser
// ============================================================================

export {
  // Parser class
  JsonDocumentParser,
  // Error classes
  JsonParsingError,
  JsonValidationError,
  // Utility functions
  parseJsonComponent,
  validateJsonComponent,
  parseJsonWithLineNumbers,
} from './parsers/json';

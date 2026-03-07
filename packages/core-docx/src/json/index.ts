// Re-export all JSON-related types and utilities
// Schema types are now imported directly from @json-to-office/shared-docx
export * from './parser';
export * from './normalizer';
export * from './filesystem';

// Re-export commonly used types from shared for convenience
export type { ComponentDefinition as JsonComponentDefinition } from '@json-to-office/shared-docx';
export type {
  CoreValidationResult as ValidationResult,
  JsonValidationError as ValidationError,
} from '@json-to-office/shared-docx';

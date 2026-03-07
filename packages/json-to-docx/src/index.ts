/**
 * @json-to-office/json-to-docx
 *
 * Public API package for DOCX document generation.
 * Re-exports from core-docx and shared-docx.
 */

// Core generation API
export { generateDocument } from '@json-to-office/core-docx';

// Re-export shared-docx schemas and types
export * from '@json-to-office/shared-docx';

// Re-export shared utilities
export {
  type ComponentDefinition,
  type GenerationWarning,
  type AddWarningFunction,
  type ValidationError,
  type ParsedSemver,
  isValidSemver,
  parseSemver,
  compareSemver,
  latestVersion,
} from '@json-to-office/shared';

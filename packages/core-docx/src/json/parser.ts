/**
 * JSON Document Parser - Re-exports from shared package
 *
 * This module re-exports the JSON parsing functionality from the shared package
 * and provide a clean interface for the core package.
 */

// Re-export everything from shared package's JSON parser
export {
  JsonDocumentParser,
  JsonParsingError,
  JsonValidationError,
  parseJsonComponent,
  validateJsonComponent,
  parseJsonWithLineNumbers,
} from '@json-to-office/shared-docx';

// Re-export types needed by other modules
export type {
  DocumentValidationResult,
  DocumentValidationError,
} from '@json-to-office/shared-docx';

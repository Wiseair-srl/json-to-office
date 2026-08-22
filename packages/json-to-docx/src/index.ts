/**
 * @json-to-office/json-to-docx
 *
 * Public API package for DOCX document generation.
 * Re-exports from core-docx and shared-docx.
 */

// Core generation API — buffer and file oriented. No export returns or accepts
// a renderer-native object; the backend is chosen with the `renderer` option.
export {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateBufferFromConfig,
  generateBufferFromFile,
  generateAndSaveFromJson,
  generateAndSaveFromFile,
  validateJsonSchema,
  flattenVisuals,
  UncompiledComponentError,
  type FlattenVisualsOptions,
  type DocxGenerationResult,
} from '@json-to-office/core-docx';

// Renderer selection
export type { DocxRendererId } from '@json-to-office/core-docx';
export {
  DEFAULT_DOCX_RENDERER_ID,
  docxRendererIds,
  isDocxRendererId,
} from '@json-to-office/core-docx';

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

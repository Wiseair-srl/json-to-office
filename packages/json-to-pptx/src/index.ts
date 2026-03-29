/**
 * @json-to-office/json-to-pptx
 *
 * Public API package for PPTX presentation generation.
 * Re-exports from core-pptx and shared-pptx.
 */

// Core generation API
export {
  generatePresentation,
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateAndSaveFromJson,
  generateFromFile,
  savePresentation,
  PresentationGenerator,
} from '@json-to-office/core-pptx';

export type {
  GenerationResult,
  PipelineWarning,
  WarningCode,
} from '@json-to-office/core-pptx';
export { WarningCodes } from '@json-to-office/core-pptx';

// Plugin system
export {
  createComponent,
  createVersion,
  createPresentationGenerator,
  resolveComponentVersion,
  validateComponentProps,
  validatePresentation,
  cleanComponentProps,
  ComponentValidationError,
  DuplicateComponentError,
  generatePluginPresentationSchema,
  exportPluginSchema,
} from '@json-to-office/core-pptx';

export type {
  CustomComponent,
  ComponentVersion,
  ComponentVersionMap,
  RenderFunction,
  RenderContext,
  PresentationGeneratorOptions,
  PluginPresentationGenerator,
  PresentationGeneratorBuilder,
  PluginBufferGenerationResult,
  PluginFileGenerationResult,
  PluginValidationResult,
  ExtractCustomComponentType,
  CustomComponentUnion,
  ExtendedPptxComponentInput,
  ExtendedPresentationComponent,
  InferBuilderComponents,
  InferDocumentType,
  InferComponentDefinition,
  ComponentValidationResult,
  PluginValidationError,
} from '@json-to-office/core-pptx';

// Re-export shared-pptx schemas and types
export * from '@json-to-office/shared-pptx';

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

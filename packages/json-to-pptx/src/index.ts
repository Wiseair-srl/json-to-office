/**
 * @json-to-office/json-to-pptx
 *
 * Public API package for PPTX presentation generation.
 * Re-exports from core-pptx and shared-pptx.
 */

// Core generation API — buffer and file oriented. No export returns or accepts
// a renderer-native object; the backend is chosen with the `renderer` option.
export {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateAndSaveFromJson,
  generateFromFile,
  PresentationGenerator,
  PresentationValidationError,
  UncompiledComponentError,
} from '@json-to-office/core-pptx';

export type {
  GenerationOptions,
  GenerationResult,
  GenerationValidationOptions,
  PresentationComponentDefinition,
  PresentationComponentDefinitionFor,
  PipelineWarning,
  WarningCode,
} from '@json-to-office/core-pptx';
export { WarningCodes } from '@json-to-office/core-pptx';

// Renderer selection
export type { PptxRendererId } from '@json-to-office/core-pptx';
export {
  DEFAULT_PPTX_RENDERER_ID,
  isPptxRendererId,
  pptxRendererIds,
} from '@json-to-office/core-pptx';

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

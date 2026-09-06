// Version information
export function getPptxCoreVersion(): string {
  return 'PptxCore v1.0.0';
}

// Core API — buffer and file oriented; no member exposes a renderer object.
export {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateAndSaveFromJson,
  generateFromFile,
  isPresentationComponentDefinition,
  PresentationValidationError,
  PresentationGenerator,
} from './core/generator';

export type {
  GenerationOptions,
  GenerationResult,
  GenerationValidationOptions,
} from './core/generator';

// Renderer selection. The IR itself stays internal to this package for now.
export type { PptxRendererId } from './renderers/types';
export { DEFAULT_PPTX_RENDERER_ID } from './renderers/types';
export {
  isPptxRendererId,
  pptxRendererIds,
  pptxRendererStatuses,
} from './renderers/registry';
export { UncompiledComponentError } from './core/generateFromIr';
export { DEFAULT_GENERATED_AT } from './core/finalizePackage';
export type { PresentationPackagingOptions } from './core/finalizePackage';

// Types
export type {
  PptxComponentInput,
  PresentationComponentDefinition,
  PresentationComponentDefinitionFor,
  SlideComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
  PptxThemeConfig,
  PipelineWarning,
  SlideContext,
  SlideRenderContext,
} from './types';

export { isPresentationComponent, isSlideComponent } from './types';

// Warning utilities
export { W as WarningCodes } from './utils/warn';
export type { WarningCode } from './utils/warn';

// Themes
export {
  CONSULTING_PPTX_THEME,
  DEFAULT_PPTX_THEME,
  getPptxTheme,
  hasPptxTheme,
  pptxThemes,
} from './themes';

// Design-quality analysis (#216)
export { analyzePptxQuality } from './quality/preflight';
export type {
  PptxQualityAnalysisOptions,
  PptxQualityOptions,
} from './quality/preflight';
export {
  preparePptxQualityDocument,
  type PptxCanvasFact,
  type PptxQualityFact,
  type PptxQualityModel,
  type PptxSlideFact,
  type PptxTextFact,
  type PreparePptxQualityOptions,
} from './quality/facts';
export {
  PPTX_DEFAULT_QUALITY_PROFILE,
  PPTX_QUALITY_PROFILES,
  PPTX_QUALITY_RULES,
  pptxQualityEngine,
  resolvePptxQualityProfile,
} from './quality/rules';

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
} from './plugin';

export type {
  CustomComponent,
  ComponentVersion,
  ComponentVersionMap,
  RenderFunction,
  RenderContext,
  PresentationGeneratorOptions,
  PresentationGenerator as PluginPresentationGenerator,
  PresentationGeneratorBuilder,
  BufferGenerationResult as PluginBufferGenerationResult,
  FileGenerationResult as PluginFileGenerationResult,
  GenerateFileOptions as PluginGenerateFileOptions,
  GenerateOptions as PluginGenerateOptions,
  GenerationValidationOptions as PluginGenerationValidationOptions,
  ValidationResult as PluginValidationResult,
  ExtractCustomComponentType,
  CustomComponentUnion,
  ExtendedPptxComponentInput,
  ExtendedPresentationComponent,
  InferBuilderComponents,
  InferDocumentType,
  InferComponentDefinition,
  ComponentValidationResult,
  ValidationError as PluginValidationError,
} from './plugin';

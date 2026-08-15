// Version information
export function getPptxCoreVersion(): string {
  return 'PptxCore v1.0.0';
}

// Core API
export {
  generatePresentation,
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateAndSaveFromJson,
  generateFromFile,
  savePresentation,
  isPresentationComponentDefinition,
  PresentationValidationError,
  PresentationGenerator,
} from './core/generator';

export type {
  GenerationOptions,
  GenerationResult,
  GenerationValidationOptions,
} from './core/generator';
export {
  DEFAULT_GENERATED_AT,
  packagePresentationBuffer,
} from './core/packagePresentation';
export type { PresentationPackagingOptions } from './core/packagePresentation';

// Types
export type {
  PptxComponentInput,
  PresentationComponentDefinition,
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
export { DEFAULT_PPTX_THEME, getPptxTheme, pptxThemes } from './themes';

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

// Component renderers
export {
  renderTextComponent,
  renderImageComponent,
  renderShapeComponent,
  renderTableComponent,
  renderHighchartsComponent,
  renderComponent,
} from './components';

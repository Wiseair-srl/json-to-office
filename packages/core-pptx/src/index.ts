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
  PresentationGenerator,
} from './core/generator';

export type { GenerationOptions, GenerationResult } from './core/generator';

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

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
} from './types';

export { isPresentationComponent, isSlideComponent } from './types';

// Warning utilities
export { W as WarningCodes } from './utils/warn';
export type { WarningCode } from './utils/warn';

// Themes
export { DEFAULT_PPTX_THEME, getPptxTheme, pptxThemes } from './themes';

// Component renderers
export {
  renderTextComponent,
  renderImageComponent,
  renderShapeComponent,
  renderTableComponent,
  renderHighchartsComponent,
  renderComponent,
} from './components';

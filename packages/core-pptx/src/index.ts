// Version information
export function getPptxCoreVersion(): string {
  return 'PptxCore v1.0.0';
}

// Core API
export {
  generatePresentation,
  generateBufferFromJson,
  generateAndSaveFromJson,
  generateFromFile,
  savePresentation,
  isPresentationComponentDefinition,
  PresentationGenerator,
} from './core/generator';

export type { GenerationOptions } from './core/generator';

// Types
export type {
  PptxComponentInput,
  PresentationComponentDefinition,
  SlideComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
  PptxThemeConfig,
} from './types';

export { isPresentationComponent, isSlideComponent } from './types';

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

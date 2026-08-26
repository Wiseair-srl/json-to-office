// Version information
export function getCoreVersion(): string {
  return 'Core v1.0.0';
}

// Core functional API — buffer and file oriented. No export returns or accepts
// a renderer-native object; the backend is chosen with the `renderer` option.
export {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateBufferFromConfig,
  generateBufferFromFile,
  generateAndSaveFromJson,
  generateAndSaveFromFile,
  validateJsonSchema,
  isReportComponentDefinition,
  DocumentGenerator as CoreDocumentGenerator,
  type DocxGenerationResult,
} from './core/generator';

// Renderer selection. The IR itself stays internal to this package for now.
export type { DocxRendererId } from './renderers/types';
export { DEFAULT_DOCX_RENDERER_ID } from './renderers/types';
export {
  docxRendererIds,
  docxRendererStatuses,
  isDocxRendererId,
} from './renderers/registry';
export { UncompiledComponentError } from './core/generateFromIr';

// Visual flattening (desugar `visual` → `image` for portable, service-free docs)
export {
  flattenVisuals,
  type FlattenVisualsOptions,
} from './core/flattenVisuals';

export {
  getVisualPrepassStats,
  resetVisualPrepassStats,
  type VisualPrepassStats,
} from './core/prerasterizeVisuals';

// Legacy class-based API is now removed - use functional API above

// Runtime exports (only type guards and functions)
export {
  // Type guards
  isReportComponent,
  isSectionComponent,
  isHeadingComponent,
  isParagraphComponent,
  isColumnsComponent,
  isImageComponent,
  isStatisticComponent,
  isTableComponent,
  isListComponent,
  isHighchartsComponent,
  isVisualComponent,
} from './types/index';

// Export core-specific types only
export type {
  ReportComponentDefinition,
  ReportComponentDefinitionFor,
  // Core-specific types
  ImageContent,
  StatisticContent,
  TableData,
  SectionProperties,
  ColumnSettings,
  PageSizeOptions,
  PageMarginOptions,
  PageNumberOptions,
  PageBorderOptions,
  RenderContext,
} from './types/index';

// Utilities
export * from './utils/formatters';
export { isNodeEnvironment, hasNodeBuiltins } from './utils/environment';

// Design-quality collectors (#216)
export { collectDocxQualityFindings } from './quality/preflight';
export type { DocxQualityOptions } from './quality/preflight';
export {
  generateWarningsDocument,
  formatWarningsText,
} from './utils/warningsDocument';

// Styles and themes
export {
  themes,
  minimalTheme,
  corporateTheme,
  modernTheme,
} from './styles/index';
export type { ThemeName } from './styles/index';

// JSON Theme System
export {
  loadThemeFromJson,
  loadThemeFromFile,
  exportThemeToJson,
  validateThemeJsonString,
  ThemeValidationError,
  ThemeParseError,
  ThemeFileError,
  createMinimalTheme,
} from './themes/json/index';

// Examples and utilities
export {
  examples,
  getExample,
  getExampleNames,
  loadJsonExample,
} from './templates/documents/index';
export { runExample } from './utils/exampleRunner';

// Export component implementations
import './components/index';

// Re-export types from components (excluding those that come from shared)
export type {
  // ChartGenerationResult is specific to the component implementation
  ChartGenerationResult,
} from './components/highcharts';

// Note: TextSpaceAfterProps and HighchartsProps types are now in shared package
// and should be imported from there to maintain single source of truth

// Plugin System API
export {
  // Core plugin functions
  createComponent,
  createVersion,
  createDocumentGenerator,

  // Validation utilities
  validateComponentProps,
  validateDocument,
  cleanComponentProps,
  ComponentValidationError,
  UnknownPreservedComponentError,

  // Schema utilities
  generatePluginDocumentSchema,
  exportPluginSchema,
  generateComponentSchemas,
  mergeSchemas,

  // Types
  type CustomComponent,
  type ComponentVersion,
  type ComponentVersionMap,
  type RenderFunction,
  type RenderContext as ComponentRenderContext,
  type DocumentGenerator,
  type DocumentGeneratorOptions,
  type GenerateOptions,
  type GenerateFileOptions,
  type BufferGenerationResult,
  type FileGenerationResult,
  type StandardDefinitionResult,
  type ValidationResult,
  type ValidationError,

  // Type utilities for custom components
  type ExtractCustomComponentType,
  type CustomComponentUnion,
  type ExtendedComponentDefinition,
  type ExtendedReportComponent,
  type InferCustomComponents,
} from './plugin/index';

// Plugin types
export type {
  PluginComponent,
  PluginRenderFunction,
  PluginValidationError,
  PluginValidationResult,
} from './types/plugin';

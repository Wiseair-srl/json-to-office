// Version information
export function getCoreVersion(): string {
  return 'Core v1.0.0';
}

// Core functional API
export {
  generateDocument,
  generateFromConfig,
  generateDocumentFromJson,
  generateDocumentFromFile,
  generateBufferFromJson,
  generateBufferFromFile,
  generateAndSaveFromJson,
  generateAndSaveFromFile,
  validateJsonSchema,
  isReportComponentDefinition,
  saveDocument,
  generateAndSave,
  DocumentGenerator as CoreDocumentGenerator,
} from './core/generator';

// Cache API (general purpose caching, not specific to custom components)
export {
  MemoryCache,
  CacheKeyGenerator,
  DEFAULT_CACHE_CONFIG,
  getCacheConfigFromEnv,
  mergeConfigs,
  ComponentCacheAnalytics,
  // Types
  type CacheConfiguration,
  type CachedComponent,
  type CacheStatistics,
  type CacheKeyOptions,
  type CacheEvents,
  type CacheAnalyticsReport,
  type ComponentPerformanceMetrics,
  type ComponentCacheTrends,
  type CacheOptimizationRecommendation,
  type TimeSeriesPoint,
} from './cache/index';

// Component cache functions from core
export {
  initializeComponentCache,
  getComponentCache,
  clearComponentCache,
  getComponentCacheStats,
  warmComponentCache,
} from './core/cached-render';

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
} from './types/index';

// Export core-specific types only
export type {
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
export { parseTextWithDecorators } from './utils/textParser';
export { isNodeEnvironment, hasNodeBuiltins } from './utils/environment';
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
  type GenerationResult,
  type BufferGenerationResult,
  type FileGenerationResult,
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

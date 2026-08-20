// Types
export type { ComponentDefinition } from './types/components';
export type { GenerationWarning, AddWarningFunction } from './types/warnings';
export type {
  ServicesConfig,
  HighchartsServiceConfig,
  HighchartsHeaders,
  HighchartsHeadersResolver,
  PptxServiceConfig,
  PptxServiceHeaders,
  PptxServiceHeadersResolver,
  PptxRasterizeRequest,
  PptxRasterizeResult,
  PptxRasterizer,
  PptxRasterizeBatchSlide,
  PptxRasterizeBatchRequest,
  PptxRasterizeBatchSlideResult,
  PptxRasterizeBatchResult,
  PptxRasterizeFailureStage,
  PptxBatchRasterizer,
} from './types/services';
export {
  DEFAULT_VISUAL_DPI,
  MIN_VISUAL_DPI,
  MAX_VISUAL_DPI,
  MAX_RASTERIZE_BATCH_SLIDES,
  clampVisualDpi,
} from './types/services';

// Schema utilities
export {
  fixSchemaReferences,
  convertToJsonSchema,
  createComponentSchema,
  createComponentSchemaObject,
  exportSchemaToFile,
} from './schemas/schema-utils';
export type { ComponentSchemaConfig } from './schemas/schema-utils';
export {
  restructureNameDiscriminatedUnions,
  unionBranches,
} from './schemas/discriminated-unions';

// Validation - unified system
export {
  transformValueError,
  transformValueErrors,
  formatErrorSummary,
  groupErrorsByPath,
  createJsonParseError,
  calculatePosition,
} from './validation/unified';
export type {
  ValidationError,
  ValidationResult,
  TransformedError,
} from './validation/unified';
export {
  type ErrorFormatterConfig,
  DEFAULT_ERROR_CONFIG,
  createErrorConfig,
  ERROR_EMOJIS,
  formatErrorMessage,
} from './validation/unified';
export {
  isUnionSchema,
  isObjectSchema,
  isLiteralSchema,
  getObjectSchemaPropertyNames,
  getLiteralValue,
  extractStandardComponentNames,
  clearComponentNamesCache,
  getSchemaMetadata,
} from './validation/unified';

// Plugin system
export {
  createComponent,
  createVersion,
  resolveComponentVersion,
  DuplicateComponentError,
  ComponentValidationError,
  UnknownPreservedComponentError,
  validateCustomComponentProps,
  isValidationSuccess,
  getValidationSummary,
  type RenderContext,
  type RenderFunction,
  type ComponentVersion,
  type ComponentVersionMap,
  type CustomComponent,
  type PluginValidationOptions,
  type PluginValidationResult,
  type ComponentValidationResult,
} from './plugin';

// Font catalog + registry schemas
export {
  SAFE_FONTS,
  isSafeFont,
  FontFamilyNameSchema,
  FontSourceSchema,
  FontRegistryEntrySchema,
  FontRegistrySchema,
  type SafeFontName,
  type FontSource,
  type FontRegistryEntry,
  type FontRegistryDefinition,
} from './schemas/font-catalog';

// Font runtime (collect, validate, resolve)
export {
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  validateFontReferences,
  FontRegistry,
  detectFontFormat,
  isAllowedFontUrl,
  FONT_URL_ALLOWLIST,
  fetchGoogleFontSources,
  POPULAR_GOOGLE_FONTS,
  WEIGHT_LABELS,
  synthesizeFamilyName,
  type SynthesizedFamily,
  rewriteFontFamilyName,
  UPSTREAM_OVERRIDES,
  getUpstreamOverride,
  type UpstreamOverride,
  type UpstreamVariant,
  type ResolvedFont,
  type ResolvedFontSource,
  type FontRuntimeOpts,
  type FontResolutionIssue,
  type FontIssueCode,
  type FontValidationResult,
  type FontValidationInput,
  type FontRegistryInput,
  type PopularGoogleFont,
  applyFontSubstitution,
  buildDefaultSubstitutionMap,
  defaultSubstituteFor,
  applyExportMode,
  scopedThemeName,
  type FontSubstitution,
  documentFontRegistry,
  themeFontRegistry,
  mergeFontRegistries,
} from './fonts';

// Cross-format theme constants
export { DEFAULT_CHART_THEME_COLORS } from './theme/chart-palette';

// Deep merge utilities
export { mergeWithDefaults } from './utils/deepMerge';

// Semver utilities
export {
  isValidSemver,
  parseSemver,
  compareSemver,
  latestVersion,
  type ParsedSemver,
} from './utils/semver';

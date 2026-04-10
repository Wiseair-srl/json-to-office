// Types
export type { ComponentDefinition } from './types/components';
export type { GenerationWarning, AddWarningFunction } from './types/warnings';
export type { ServicesConfig, HighchartsServiceConfig } from './types/services';

// Schema utilities
export {
  fixSchemaReferences,
  convertToJsonSchema,
  createComponentSchema,
  createComponentSchemaObject,
  exportSchemaToFile,
} from './schemas/schema-utils';
export type { ComponentSchemaConfig } from './schemas/schema-utils';

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

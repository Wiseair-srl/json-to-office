/**
 * Unified validation facade
 * Simple, clean API for all validation needs
 */

// Format-agnostic types re-exported from @json-to-office/shared
export type { ValidationError, ValidationResult } from '@json-to-office/shared';

// Docx-specific extended types (local)
export type {
  ValidationOptions,
  JsonValidationResult,
  ThemeValidationResult,
  DocumentValidationResult,
  ComponentValidationResult,
  EnhancedValueError,
} from './types';

// Format-agnostic error utilities re-exported from @json-to-office/shared
export {
  transformValueError,
  transformValueErrors,
  calculatePosition,
  formatErrorSummary,
  groupErrorsByPath,
  createJsonParseError,
} from '@json-to-office/shared';

// Docx-specific error transformer (local, extends shared with docx-specific messages)
export {
  transformValueError as transformDocxValueError,
  transformValueErrors as transformDocxValueErrors,
} from './error-transformer';

// Export deep validation utilities (docx-specific)
export {
  deepValidateDocument,
  comprehensiveValidateDocument,
} from './deep-validator';

// Format-agnostic schema utilities re-exported from @json-to-office/shared
export {
  isUnionSchema,
  isObjectSchema,
  isLiteralSchema,
  getObjectSchemaPropertyNames,
  getLiteralValue,
  extractStandardComponentNames,
  clearComponentNamesCache,
  getSchemaMetadata,
} from '@json-to-office/shared';

// Format-agnostic error formatter config re-exported from @json-to-office/shared
export {
  type ErrorFormatterConfig,
  DEFAULT_ERROR_CONFIG,
  ERROR_EMOJIS,
  createErrorConfig,
  formatErrorMessage,
} from '@json-to-office/shared';

// Docx-specific error formatter extras (local)
export { ERROR_TEMPLATES, DOC_LINKS } from './error-formatter-config';

// Export base validator utilities
export {
  validateAgainstSchema,
  validateJson,
  validateBatch,
  validateWithEnhancement,
  createValidator,
  createJsonValidator,
  isValidationSuccess,
  getValidationSummary,
} from './base-validator';

// Export document validation
export {
  validateDocument,
  validateJsonDocument,
  isValidDocument,
  createDocumentValidator,
  documentValidator,
  strictDocumentValidator,
  // Legacy compatibility
  validateJsonComponent,
  validateDocumentWithSchema,
} from './document-validator';

// Export theme validation
export {
  validateTheme,
  validateThemeJson,
  validateThemeWithEnhancement,
  isValidTheme,
  createThemeValidator,
  themeValidator,
  strictThemeValidator,
  getThemeName,
  isThemeConfig,
} from './theme-validator';

// Export component validation
export {
  validateComponent,
  validateComponentDefinition,
  validateCustomComponentProps,
  validateComponents,
  isStandardComponentName,
  createComponentValidator,
  componentValidator,
  strictComponentValidator,
  // Type guards
  isReportProps,
  isSectionProps,
  isHeadingProps,
  isParagraphProps,
  isColumnsProps,
  isImageProps,
  isStatisticProps,
  isTableProps,
  isHeaderProps,
  isFooterProps,
  isListProps,
  isCustomComponentProps,
  // Types
  type StandardComponentName,
} from './component-validator';

// Import the validators we need
import {
  documentValidator,
  strictDocumentValidator,
} from './document-validator';
import { themeValidator, strictThemeValidator } from './theme-validator';
import {
  componentValidator,
  strictComponentValidator,
} from './component-validator';

/**
 * Simple validation API
 * The main entry point for most validation needs
 */
export const validate = {
  // Document validation
  document: (data: unknown) => documentValidator.validate(data),
  jsonDocument: (jsonInput: string | object) =>
    documentValidator.validateJson(jsonInput),

  // Theme validation
  theme: (data: unknown) => themeValidator.validate(data),
  jsonTheme: (jsonInput: string | object) =>
    themeValidator.validateJson(jsonInput),

  // Component validation
  component: (name: string, props: unknown) =>
    componentValidator.validate(name, props),
  componentDefinition: (component: unknown) =>
    componentValidator.validateDefinition(component),

  // Batch operations
  components: (components: Array<{ name: string; props: unknown }>) =>
    components.map((c) => componentValidator.validate(c.name, c.props)),

  // Type checking (non-throwing)
  isDocument: (data: unknown) => {
    const result = documentValidator.validate(data);
    return result.valid;
  },
  isTheme: (data: unknown) => {
    const result = themeValidator.validate(data);
    return result.valid;
  },
  isComponent: (name: string, props: unknown) => {
    const result = componentValidator.validate(name, props);
    return result.valid;
  },
};

/**
 * Strict validation API
 * For cases where you want no cleaning or defaults
 */
export const validateStrict = {
  document: (data: unknown) => strictDocumentValidator.validate(data),
  jsonDocument: (jsonInput: string | object) =>
    strictDocumentValidator.validateJson(jsonInput),
  theme: (data: unknown) => strictThemeValidator.validate(data),
  jsonTheme: (jsonInput: string | object) =>
    strictThemeValidator.validateJson(jsonInput),
  component: (name: string, props: unknown) =>
    strictComponentValidator.validate(name, props),
  componentDefinition: (component: unknown) =>
    strictComponentValidator.validateDefinition(component),
};

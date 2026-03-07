// Version information
export const SHARED_DOCX_VERSION = '1.0.0';

// ============================================================================
// Format-agnostic re-exports from @json-to-office/shared
// ============================================================================

// Types
export type { ComponentDefinition as SharedComponentDefinition } from '@json-to-office/shared';
export type { GenerationWarning, AddWarningFunction } from '@json-to-office/shared';

// Schema utilities
export {
  fixSchemaReferences,
  convertToJsonSchema,
  createComponentSchema,
  createComponentSchemaObject as sharedCreateComponentSchemaObject,
  exportSchemaToFile,
} from '@json-to-office/shared';
export type { ComponentSchemaConfig } from '@json-to-office/shared';

// Validation - format-agnostic from shared
export {
  transformValueError,
  transformValueErrors,
  formatErrorSummary,
  groupErrorsByPath,
  createJsonParseError,
  calculatePosition,
} from '@json-to-office/shared';
export type { ValidationError, ValidationResult } from '@json-to-office/shared';
export {
  type ErrorFormatterConfig,
  DEFAULT_ERROR_CONFIG,
  createErrorConfig,
  ERROR_EMOJIS,
  formatErrorMessage,
} from '@json-to-office/shared';
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

// Semver utilities
export {
  isValidSemver,
  parseSemver,
  compareSemver,
  latestVersion,
  type ParsedSemver,
} from '@json-to-office/shared';

// ============================================================================
// Docx-specific: Document schemas
// ============================================================================

export {
  JsonComponentDefinitionSchema,
  JSON_SCHEMA_URLS,
  validateDocumentWithSchema,
  validateJsonComponent as validateJsonComponentDoc,
} from './schemas/document';

export type {
  DocumentValidationResult,
  ValidationError as DocumentValidationError,
} from './schemas/document';

// ============================================================================
// Docx-specific: Theme schemas
// ============================================================================

export { ThemeConfigSchema, isValidThemeConfig } from './schemas/theme';

export type {
  ThemeConfigJson,
  StyleDefinitions,
  DocumentMargins,
  PageDimensions,
  Page,
  FontDefinition,
  Fonts,
  ComponentDefaults,
  HeadingComponentDefaults,
  ParagraphComponentDefaults,
  ImageComponentDefaults,
  StatisticComponentDefaults,
  TableComponentDefaults,
  SectionComponentDefaults,
  ColumnsComponentDefaults,
  ListComponentDefaults,
  HeadingDefinition,
} from './schemas/theme';

// ============================================================================
// Docx-specific: API schemas
// ============================================================================

export * from './schemas/api';

// ============================================================================
// Docx-specific: Validation utilities
// ============================================================================

// Parser utilities
export {
  JsonDocumentParser,
  JsonParsingError,
  JsonValidationError,
  parseJsonComponent,
  validateJsonComponent,
  parseJsonWithLineNumbers,
} from './validation/parsers/json';

// Theme validators
export {
  validateThemeJson,
  isValidThemeJson,
  getValidationSummary,
} from './validation/validators/theme';

// Component validators
export {
  validateComponentProps,
  safeValidateComponentProps,
  safeValidateComponentDefinition,
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
  getValidationErrors,
} from './validation/validators/component';

// Export formatValidationErrors from theme validator (works for both)
export { formatValidationErrors } from './validation/validators/theme';

// New comprehensive validation exports
export {
  // Core validators
  validateComponent,
  validateComponentDefinition,
  validateComponents,
  transformAndValidate,
  createValidatedComponent,
  isValidComponent,
  // Error formatting
  formatValidationError,
  formatValidationErrorStrings,
  formatErrorReport,
  getErrorSummary,
  hasCriticalErrors,
  getValidationContext,
} from './validation';

// Export types from validation
export type { ThemeValidationResult } from './validation/validators/theme';

export type {
  CoreValidationResult,
  StandardComponentName,
  FormattedError,
} from './validation';

// ============================================================================
// Docx-specific: Unified Validation System
// ============================================================================

export * from './validation/unified';

// Re-export the simple validation API as the main validation interface
export { validate, validateStrict } from './validation/unified';

// ============================================================================
// Docx-specific: Component schemas (JavaScript values)
// ============================================================================

export {
  AlignmentSchema,
  JustifiedAlignmentSchema,
  HeadingLevelSchema,
  SpacingSchema,
  LineSpacingSchema,
  IndentSchema,
  NumberingSchema,
  BorderSchema,
  MarginsSchema,
  BaseComponentPropsSchema,
  ReportPropsSchema,
  SectionPropsSchema,
  ColumnsPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ImagePropsSchema,
  TextBoxPropsSchema,
  StatisticPropsSchema,
  TablePropsSchema,
  HeaderPropsSchema,
  FooterPropsSchema,
  ListPropsSchema,
  TocPropsSchema,
  StandardComponentDefinitionSchema,
  ComponentDefinitionSchema,
} from './schemas/components';

// Component types - export as types only
export type {
  BaseComponentProps,
  ReportProps,
  SectionProps,
  ColumnsProps,
  HeadingProps,
  ParagraphProps,
  ImageProps,
  TextBoxProps,
  StatisticProps,
  TableProps,
  HeaderProps,
  FooterProps,
  ListProps,
  TocProps,
  Alignment,
  JustifiedAlignment,
  HeadingLevel,
  Spacing,
  LineSpacing,
  Indent,
  Numbering,
} from './schemas/components';

// Export ComponentDefinition from types/components.ts (better type inference)
export type {
  ComponentDefinition,
  StandardComponentDefinition,
} from './types/components';

export {
  STANDARD_COMPONENTS,
  STANDARD_COMPONENTS_SET,
} from './types/components';

// Highcharts component schema (standard component)
export { HighchartsPropsSchema } from './schemas/components/highcharts';
export type { HighchartsProps } from './schemas/components/highcharts';

// Custom component schemas
export {
  TextSpaceAfterPropsSchema,
  TextSpaceAfterComponentSchema,
  CustomComponentDefinitionSchema,
} from './schemas/custom-components';

export type {
  TextSpaceAfterProps,
} from './schemas/custom-components';

// Legacy support - re-export common types from schemas
export type { ThemeName } from './types/common';

// ============================================================================
// Docx-specific: Schema Export Utilities
// ============================================================================

export {
  fixSchemaReferences as fixDocxSchemaReferences,
  convertToJsonSchema as convertDocxToJsonSchema,
  createComponentSchema as createDocxComponentSchema,
  exportSchemaToFile as exportDocxSchemaToFile,
  COMPONENT_METADATA,
  BASE_SCHEMA_METADATA,
  THEME_SCHEMA_METADATA,
} from './schemas/export';

export type { ComponentSchemaConfig as DocxComponentSchemaConfig } from './schemas/export';

// ============================================================================
// Docx-specific: Unified Schema Generation
// ============================================================================

export { generateUnifiedDocumentSchema } from './schemas/generator';

export type {
  CustomComponentInfo,
  GenerateDocumentSchemaOptions,
} from './schemas/generator';

// ============================================================================
// Docx-specific: Plugin System Type Support
// ============================================================================

export {
  type ReportComponent,
  type SectionComponent,
  type ColumnsComponent,
  type HeadingComponent,
  type ParagraphComponent,
  type TextBoxComponent,
  type ImageComponent,
  type HighchartsComponent,
  type StatisticComponent,
  type TableComponent,
  type HeaderComponent,
  type FooterComponent,
  type ListComponent,
  type TocComponent,
  type TextSpaceAfterComponent,
  isReportComponent,
  isSectionComponent,
  isColumnsComponent,
  isHeadingComponent,
  isParagraphComponent,
  isTextBoxComponent,
  isImageComponent,
  isHighchartsComponent,
  isStatisticComponent,
  isTableComponent,
  isHeaderComponent,
  isFooterComponent,
  isListComponent,
  isTocComponent,
  isTextSpaceAfterComponent,
} from './types/components';

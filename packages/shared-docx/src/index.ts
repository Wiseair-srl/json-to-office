// Version information
export const SHARED_DOCX_VERSION = '1.0.0';

// ============================================================================
// Document diff (tracked-change redlines)
// ============================================================================

export { diffDocuments, diffWords, stripMarkdown } from './diff';
export type {
  DiffDocumentsOptions,
  DiffDocumentsResult,
  DiffSummary,
  UntrackedChange,
  DiffSegment,
  JsonNode,
} from './diff';

// ============================================================================
// Format-agnostic re-exports from @json-to-office/shared
// ============================================================================

// Types
export type { ComponentDefinition as SharedComponentDefinition } from '@json-to-office/shared';
export type {
  GenerationWarning,
  AddWarningFunction,
} from '@json-to-office/shared';

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

export {
  ThemeConfigSchema,
  ThemeOverridesSchema,
  isValidThemeConfig,
  createMinimalTheme,
} from './schemas/theme';

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
  ParagraphIndentSchema,
  TabStopTypeSchema,
  TabStopLeaderSchema,
  TabStopSchema,
  TabStopsSchema,
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
  KeyTakeawaysPropsSchema,
  KEY_TAKEAWAYS_BUDGET,
  CoverPropsSchema,
  CoverLogoSchema,
  COVER_BUDGET,
  SectionOpenerPropsSchema,
  SECTION_OPENER_BUDGET,
  RunningHeadPropsSchema,
  RUNNING_HEAD_BUDGET,
  TablePropsSchema,
  ListPropsSchema,
  TocPropsSchema,
  DividerPropsSchema,
  RevisionSchema,
  RevisionSegmentSchema,
  RevisionMarkSchema,
  CommentSchema,
  CommentReplySchema,
  NoteSchema,
  FootnotesSchema,
  EndnotesSchema,
  ListMarkerFontSchema,
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
  KeyTakeawaysProps,
  CoverProps,
  SectionOpenerProps,
  RunningHeadProps,
  TableProps,
  ListProps,
  TocProps,
  DividerProps,
  Revision,
  RevisionSegment,
  RevisionMark,
  Comment,
  CommentReply,
  Note,
  ListMarkerFont,
  Alignment,
  JustifiedAlignment,
  HeadingLevel,
  Spacing,
  LineSpacing,
  Indent,
  ParagraphIndent,
  TabStopType,
  TabStopLeader,
  TabStop,
  TabStops,
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

// Component registry — the single source of truth for which components exist,
// which can hold children, and what those children may be.
export {
  STANDARD_COMPONENTS_REGISTRY,
  getStandardComponent,
  getAllStandardComponentNames,
} from './schemas/component-registry';

// Highcharts component schema (standard component)
export { HighchartsPropsSchema } from './schemas/components/highcharts';
export type { HighchartsProps } from './schemas/components/highcharts';
export { ChartPropsSchema } from './schemas/components/chart';
export type { ChartProps } from './schemas/components/chart';

// Visual component schema (standard component — a rasterized pptx slide, or a
// native Word drawing group under the `office-open` renderer)
export {
  VisualPropsSchema,
  VisualRasterPropsSchema,
  VisualNativePropsSchema,
  VisualCanvasSchema,
  VisualCanvasBackgroundSchema,
  NATIVE_RENDER_MODE,
  isNativeVisualProps,
} from './schemas/components/visual';
export type {
  VisualProps,
  VisualRasterProps,
  VisualNativeProps,
  VisualCanvas,
} from './schemas/components/visual';

// Native visual content (the DrawingML element model)
export {
  NativeVisualElementSchema,
  NativeVisualCanvasSchema,
  NativeVisualTextPropsSchema,
  NativeVisualShapePropsSchema,
  NativeVisualImagePropsSchema,
  NATIVE_VISUAL_ELEMENT_NAMES,
} from './schemas/components/visual-native';
export type {
  NativeVisualElement,
  NativeVisualElementName,
  NativeVisualCanvas,
  NativeVisualTextProps,
  NativeVisualShapeProps,
  NativeVisualImageProps,
  NativeVisualTextRun,
  NativeVisualTextSegment,
  NativeVisualFill,
  NativeVisualLine,
} from './schemas/components/visual-native';

// Custom component schemas
export {
  TextSpaceAfterPropsSchema,
  TextSpaceAfterComponentSchema,
  CustomComponentDefinitionSchema,
} from './schemas/custom-components';

export type { TextSpaceAfterProps } from './schemas/custom-components';

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

// Renderer-discriminated schema profiles
export {
  DOCX_RENDERER_IDS,
  DEFAULT_DOCX_RENDERER_ID,
  collectDocxRendererErrors,
  docxComponentDefinitionName,
} from './schemas/renderer';
export type { DocxRendererId } from './schemas/renderer';

// ============================================================================
// Docx-specific: Plugin System Type Support
// ============================================================================

export {
  type ReportComponent,
  type ReportComponentFor,
  type SectionComponent,
  type ColumnsComponent,
  type HeadingComponent,
  type ParagraphComponent,
  type TextBoxComponent,
  type ImageComponent,
  type HighchartsComponent,
  type VisualComponent,
  type StatisticComponent,
  type KeyTakeawaysComponent,
  type CoverComponent,
  type SectionOpenerComponent,
  type RunningHeadComponent,
  type TableComponent,
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
  isVisualComponent,
  isStatisticComponent,
  isKeyTakeawaysComponent,
  isCoverComponent,
  isSectionOpenerComponent,
  isRunningHeadComponent,
  isTableComponent,
  isListComponent,
  isTocComponent,
  isTextSpaceAfterComponent,
} from './types/components';

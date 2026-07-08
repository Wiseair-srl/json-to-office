export const PPTX_SHARED_VERSION = '1.0.0';

// Component Schemas
export {
  PositionSchema,
  SlideBackgroundSchema,
  TransitionSchema,
  VerticalAlignmentSchema,
  ShadowSchema,
  PresentationPropsSchema,
  SlidePropsSchema,
  TextPropsSchema,
  PptxImagePropsSchema,
  ShapePropsSchema,
  ShapeTypeSchema,
  PptxTablePropsSchema,
  PptxHighchartsPropsSchema,
  PptxStandardComponentDefinitionSchema,
  PptxComponentDefinitionSchema,
  PptxSlideContentSchema,
} from './schemas/components';

export type {
  Position,
  SlideBackground,
  Transition,
  VerticalAlignment,
  Shadow,
  PresentationProps,
  SlideProps,
  TextProps,
  PptxImageProps,
  ShapeType,
  ShapeProps,
  TextSegment,
  PptxTableProps,
  PptxHighchartsProps,
  PptxComponentDefinition,
  PptxSlideContent,
} from './schemas/components';

// Chart (not re-exported from components barrel)
export { PptxChartPropsSchema } from './schemas/components/chart';
export type { PptxChartProps } from './schemas/components/chart';

// Component Registry
export {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  getPptxStandardComponent,
  getAllPptxComponentNames,
  getPptxComponentsByCategory,
  getPptxContainerComponents,
  getPptxContentComponents,
  isPptxStandardComponent,
  createPptxComponentSchemaObject,
  createAllPptxComponentSchemas,
} from './schemas/component-registry';

export type { PptxStandardComponentDefinition } from './schemas/component-registry';

// Document Schema
export {
  PptxJsonComponentDefinitionSchema,
  PPTX_JSON_SCHEMA_URLS,
} from './schemas/document';

export type { PptxJsonComponentDefinition } from './schemas/document';

// Schema Export Metadata
export {
  PPTX_COMPONENT_METADATA,
  PPTX_BASE_SCHEMA_METADATA,
} from './schemas/export';

// Component Defaults
export {
  PptxComponentDefaultsSchema,
  TextComponentDefaultsSchema,
  ImageComponentDefaultsSchema,
  ShapeComponentDefaultsSchema,
  TableComponentDefaultsSchema,
  HighchartsComponentDefaultsSchema,
  ChartComponentDefaultsSchema,
} from './schemas/component-defaults';
export type {
  PptxComponentDefaults,
  TextComponentDefaults,
  ImageComponentDefaults,
  ShapeComponentDefaults,
  TableComponentDefaults,
  HighchartsComponentDefaults,
  ChartComponentDefaults,
} from './schemas/component-defaults';

// Theme
export {
  ThemeConfigSchema,
  ColorValueSchema,
  SEMANTIC_COLOR_NAMES,
  SEMANTIC_COLOR_ALIASES,
  STYLE_NAMES,
  StyleNameSchema,
  TextStyleSchema,
  isValidThemeConfig,
} from './schemas/theme';
export type { ThemeConfigJson, StyleName, TextStyle } from './schemas/theme';

// Schema Generator
export { generateUnifiedDocumentSchema } from './schemas/generator';
export type {
  VersionedPropsEntry,
  CustomComponentInfo,
  GenerateSchemaOptions,
} from './schemas/generator';

// Types
export type { ReportComponent } from './types/components';

// Image source conflict detection (path/base64/svg mutual exclusivity)
export {
  collectImageSourceConflicts,
  presentImageSources,
} from './validation/image-source-conflicts';

// Unified validation facade (deep, path-aware validation of whole presentations
// and themes) — the API the CLI's `pptx validate` consumes.
export {
  validate,
  validateStrict,
  validatePresentationDocument,
  validateJsonPresentationDocument,
  validatePptxTheme,
  validateJsonPptxTheme,
  deepValidatePresentation,
  comprehensiveValidatePresentation,
} from './validation/unified';
export type {
  PptxValidationResult,
  DeepValidateOptions,
} from './validation/unified';

// Re-export shared validation utilities for convenience
export {
  transformValueError,
  transformValueErrors,
  DEFAULT_ERROR_CONFIG,
  createErrorConfig,
} from '@json-to-office/shared';

export type {
  ErrorFormatterConfig,
  ValidationError,
} from '@json-to-office/shared';

// Re-export shared utilities
export {
  latestVersion,
  isValidSemver,
  parseSemver,
  compareSemver,
} from '@json-to-office/shared';
export type { ParsedSemver } from '@json-to-office/shared';

// Re-export schema utils
export {
  fixSchemaReferences,
  convertToJsonSchema,
  createComponentSchema,
  exportSchemaToFile,
} from '@json-to-office/shared';
export type { ComponentSchemaConfig } from '@json-to-office/shared';

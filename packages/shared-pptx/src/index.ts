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
} from './schemas/components';

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

// Theme
export { ThemeConfigSchema, ColorValueSchema, SEMANTIC_COLOR_NAMES, SEMANTIC_COLOR_ALIASES, STYLE_NAMES, StyleNameSchema, TextStyleSchema, isValidThemeConfig } from './schemas/theme';
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

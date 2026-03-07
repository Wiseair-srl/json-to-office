/**
 * Document Schema Definitions using TypeBox
 * This file provides TypeBox schemas for document validation
 */

import { Static } from '@sinclair/typebox';
import { ComponentDefinitionSchema } from './components';

// ============================================================================
// Component Definition alias for document context
export const JsonComponentDefinitionSchema = ComponentDefinitionSchema;

// ============================================================================
// TypeScript Types
// ============================================================================

export type JsonComponentDefinition = Static<
  typeof JsonComponentDefinitionSchema
>;

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
  line?: number;
  column?: number;
  suggestions?: string[];
}

export interface DocumentValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationError[];
}

// ============================================================================
// JSON Schema URLs
// ============================================================================

export const JSON_SCHEMA_URLS = {
  // Individual component schemas
  report: './json-schemas/components/report.schema.json',
  section: './json-schemas/components/section.schema.json',
  columns: './json-schemas/components/columns.schema.json',
  heading: './json-schemas/components/heading.schema.json',
  paragraph: './json-schemas/components/paragraph.schema.json',
  image: './json-schemas/components/image.schema.json',
  statistic: './json-schemas/components/statistic.schema.json',
  table: './json-schemas/components/table.schema.json',
  header: './json-schemas/components/header.schema.json',
  footer: './json-schemas/components/footer.schema.json',
  list: './json-schemas/components/list.schema.json',

  // Base schemas
  alignment: './json-schemas/base/alignment.schema.json',
  baseComponent: './json-schemas/base/base-component.schema.json',
  border: './json-schemas/base/border.schema.json',
  spacing: './json-schemas/base/spacing.schema.json',
  margins: './json-schemas/base/margins.schema.json',

  // Index
  index: './json-schemas/index.schema.json',
};

// ============================================================================
// Validation Functions - Now using unified validation
// ============================================================================

// Re-export from unified validation for backward compatibility
export {
  validateDocumentWithSchema,
  validateJsonComponent,
} from '../validation/unified/document-validator';

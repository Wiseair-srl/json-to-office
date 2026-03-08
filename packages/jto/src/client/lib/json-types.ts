/**
 * JSON Editor Types
 *
 * Re-exports types and schemas from shared packages for use in the web editor.
 * Format-aware: exports docx or pptx types based on FORMAT.
 */

import { FORMAT } from './env';

// Docx schemas & types
import {
  ComponentDefinitionSchema as DocxComponentDefinitionSchema,
  type ComponentDefinition as DocxComponentDefinition,
  type ReportProps,
  type SectionProps,
  type HeadingProps,
  type ParagraphProps,
  type ImageProps as DocxImageProps,
  type TableProps as DocxTableProps,
  parseJsonComponent as parseDocxJsonComponent,
} from '@json-to-office/shared-docx';

// Pptx schemas & types
import {
  PptxComponentDefinitionSchema,
  type PptxComponentDefinition,
  type PresentationProps,
  type SlideProps,
  type TextProps,
  type PptxImageProps,
  type ShapeProps,
  type PptxTableProps,
  parseJsonComponent as parsePptxJsonComponent,
} from '@json-to-office/shared-pptx';

// Re-export the right ComponentDefinitionSchema based on format
export const ComponentDefinitionSchema =
  FORMAT === 'docx'
    ? DocxComponentDefinitionSchema
    : PptxComponentDefinitionSchema;

// Re-export the right parseJsonComponent based on format
export const parseJsonComponent =
  FORMAT === 'docx' ? parseDocxJsonComponent : parsePptxJsonComponent;

// Re-export all types (consumers pick what they need)
export type {
  // docx
  DocxComponentDefinition,
  ReportProps,
  SectionProps,
  HeadingProps,
  ParagraphProps,
  DocxImageProps,
  DocxTableProps,
  // pptx
  PptxComponentDefinition,
  PresentationProps,
  SlideProps,
  TextProps,
  PptxImageProps,
  ShapeProps,
  PptxTableProps,
};

/**
 * JSON Editor specific types
 */

// JSON Editor Document representation
export interface JsonEditorDocument {
  name: string;
  content: string;
  isValid: boolean;
  validationErrors: JsonEditorError[];
  lastModified: Date;
}

// JSON Schema type definition (subset of JSON Schema Draft-07)
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  definitions?: Record<string, JsonSchema>;
  $ref?: string;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

// JSON Editor validation context
export interface ValidationContext {
  document: JsonEditorDocument;
  schema: JsonSchema;
  enableSchemaValidation: boolean;
  enableRealTimeValidation: boolean;
}

// Monaco Editor JSON configuration
export interface MonacoJsonConfig {
  language: 'json';
  schemaValidation: boolean;
  diagnosticsOptions: {
    validate: boolean;
    enableSchemaRequest: boolean;
    hover: boolean;
    completion: boolean;
  };
  schemas: {
    uri: string;
    fileMatch: string[];
    schema: object;
  }[];
}

// JSON Editor error with position information
export interface JsonEditorError {
  path: string;
  message: string;
  code: string;
  line?: number;
  column?: number;
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
}

// JSON Editor completion item
export interface JsonCompletionItem {
  label: string;
  kind: 'property' | 'value' | 'enum' | 'snippet';
  detail?: string;
  documentation?: string;
  insertText: string;
  range?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

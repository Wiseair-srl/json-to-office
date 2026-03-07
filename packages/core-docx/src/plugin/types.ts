/**
 * Generic type utilities for extending document types with custom components
 */

import type { Static, TSchema } from '@sinclair/typebox';
import type { CustomComponent } from './createComponent';
import type { ComponentDefinition as BaseComponentDefinition } from '@json-to-office/shared-docx';
import type {
  ReportComponent,
  GenerationWarning,
} from '@json-to-office/shared-docx';
import type { ReportComponentDefinition } from '../types';
import type { Document } from 'docx';

/**
 * Helper to infer the versions map type from a CustomComponent
 */
type InferVersionMap<T> =
  T extends CustomComponent<any, infer V, any> ? V : never;

/**
 * Helper to infer the name literal type from a CustomComponent
 */
type InferName<T> = T extends CustomComponent<any, any, infer N> ? N : never;

/**
 * Extract the component type definition from a versioned CustomComponent.
 *
 * Produces a discriminated union:
 * - One variant per version with `version: V` (required) and version-specific props
 * - One fallback variant with `version?: never` accepting any version's props
 *
 * This enables TypeScript to narrow props by the `version` discriminant:
 *   { version: '1.0.0'; props: V1Props } | { version: '2.0.0'; props: V2Props } | { version?: never; props: V1Props | V2Props }
 */
export type ExtractCustomComponentType<
  T extends CustomComponent<any, any, any>,
> =
  | {
      [V in keyof InferVersionMap<T> & string]: {
        name: InferName<T>;
        version: V;
        id?: string;
        props: Static<InferVersionMap<T>[V]['propsSchema']>;
        children?: InferVersionMap<T>[V] extends { hasChildren: true }
          ? BaseComponentDefinition[]
          : never;
      };
    }[keyof InferVersionMap<T> & string]
  | {
      name: InferName<T>;
      version?: never;
      id?: string;
      props: {
        [V in keyof InferVersionMap<T> & string]: Static<
          InferVersionMap<T>[V]['propsSchema']
        >;
      }[keyof InferVersionMap<T> & string];
      children?: {
        [V in keyof InferVersionMap<T> &
          string]: InferVersionMap<T>[V] extends { hasChildren: true }
          ? BaseComponentDefinition[]
          : never;
      }[keyof InferVersionMap<T> & string];
    };

/**
 * Union type of all custom component definitions from an array of custom components
 */
export type CustomComponentUnion<
  T extends readonly CustomComponent<any, any, any>[],
> = {
  [K in keyof T]: T[K] extends CustomComponent<any, any, any>
    ? ExtractCustomComponentType<T[K]>
    : never;
}[number];

/**
 * Extended ComponentDefinition that includes both standard components and custom components
 */
export type ExtendedComponentDefinition<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> = TCustomComponents extends readonly []
  ? BaseComponentDefinition
  : BaseComponentDefinition | CustomComponentUnion<TCustomComponents>;

/**
 * Extended ReportComponent that includes custom components in its children array
 */
export type ExtendedReportComponent<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> = Omit<ReportComponent, 'children'> & {
  children?: ExtendedComponentDefinition<TCustomComponents>[];
};

/**
 * Helper type to infer custom components array from createDocumentGenerator options
 */
export type InferCustomComponents<T> = T extends { customComponents: infer M }
  ? M extends readonly CustomComponent<any, any, any>[]
    ? M
    : readonly []
  : readonly [];

// ============================================================================
// Document Generator Types
// ============================================================================

/**
 * Result of document generation
 */
export interface GenerationResult {
  /** The generated document */
  document: Document;
  /** Warnings collected during generation, null if no warnings */
  warnings: GenerationWarning[] | null;
}

/**
 * Result of buffer generation
 */
export interface BufferGenerationResult {
  /** The generated buffer */
  buffer: Buffer;
  /** Warnings collected during generation, null if no warnings */
  warnings: GenerationWarning[] | null;
}

/**
 * Result of file generation
 */
export interface FileGenerationResult {
  /** Warnings collected during generation, null if no warnings */
  warnings: GenerationWarning[] | null;
}

/**
 * Result of document validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Document generator with custom components and full type safety
 */
export interface DocumentGenerator<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> {
  generate: (
    document: ExtendedReportComponent<TCustomComponents>
  ) => Promise<GenerationResult>;

  generateBuffer: (
    document: ExtendedReportComponent<TCustomComponents>
  ) => Promise<BufferGenerationResult>;

  generateFile: (
    document: ExtendedReportComponent<TCustomComponents>,
    outputPath: string
  ) => Promise<FileGenerationResult>;

  getComponentNames: () => string[];

  validate: (
    document: ExtendedReportComponent<TCustomComponents>
  ) => ValidationResult;

  generateSchema: (includeStandardComponents?: boolean) => TSchema;

  exportSchema: (
    outputPath: string,
    options?: {
      includeStandardComponents?: boolean;
      prettyPrint?: boolean;
    }
  ) => Promise<void>;

  getStandardComponentsDefinition: (
    document: ExtendedReportComponent<TCustomComponents>
  ) => Promise<ReportComponentDefinition>;
}

/**
 * Document generator builder with chainable .addComponent() method.
 */
export interface DocumentGeneratorBuilder<
  TComponents extends readonly CustomComponent<any, any, any>[] = readonly [],
> extends DocumentGenerator<TComponents> {
  addComponent<TNewComponent extends CustomComponent<any, any, any>>(
    component: TNewComponent
  ): DocumentGeneratorBuilder<readonly [...TComponents, TNewComponent]>;
}

/**
 * Infer the components tuple from a DocumentGeneratorBuilder
 */
export type InferBuilderComponents<T> =
  T extends DocumentGeneratorBuilder<infer M> ? M : never;

/**
 * Infer the document type accepted by a builder
 */
export type InferDocumentType<T> =
  T extends DocumentGeneratorBuilder<infer M>
    ? ExtendedReportComponent<M>
    : never;

/**
 * Infer the component definition type accepted by a builder.
 */
export type InferComponentDefinition<T> =
  T extends DocumentGeneratorBuilder<infer M>
    ? ExtendedComponentDefinition<M>
    : T extends DocumentGenerator<infer M>
      ? ExtendedComponentDefinition<M>
      : never;

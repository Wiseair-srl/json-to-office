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
import type { DocxRendererId } from '../renderers/types';

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
 * Per-call options shared by generateBuffer/generateFile.
 *
 * `preserveCustomComponents`: list of registered custom-component names whose
 * `{ name, props, children? }` nodes should be kept verbatim in the returned
 * `preservedDefinition`. The DOCX output is unaffected — it always renders
 * the fully-expanded tree.
 */
/**
 * Validation behavior for the generation entry points.
 *
 * `enabled` (default true) runs the plugin-aware validator before building and
 * throws `ComponentValidationError` on errors, rather than emitting a corrupt
 * or incomplete document. `allowUnknownFields` strips unknown properties
 * instead of rejecting them under strict (additionalProperties:false) schemas —
 * an escape hatch for migration.
 */
export interface GenerationValidationOptions {
  enabled?: boolean;
  allowUnknownFields?: boolean;
}

export interface GenerateOptions {
  preserveCustomComponents?: string[];
  /** Override the generator's validation behavior for this call. */
  validation?: GenerationValidationOptions;
  /** Normalize volatile OOXML values for byte-identical output. Defaults true. */
  deterministic?: boolean;
  /** Build timestamp for metadata; defaults to a stable epoch. */
  generatedAt?: string | Date;
  /**
   * Directory that relative asset paths (image `path` props) resolve against
   * for this call. Overrides the constructor `baseDir`; defaults to
   * `process.cwd()` when neither is set (#142).
   */
  baseDir?: string;
  /**
   * Backend that turns the compiled document into bytes for this call.
   * Overrides the constructor `renderer`; defaults to `docxjs`.
   */
  renderer?: DocxRendererId;
}

/**
 * Per-call options for `generateFile` only — adds a sidecar-path override.
 */
export interface GenerateFileOptions extends GenerateOptions {
  /**
   * Override path for the preserved-tree sidecar JSON.
   * Default: `<outputPath without extension>-preserved.json`.
   * Only used when `preserveCustomComponents` is set.
   */
  preservedOutputPath?: string;
}

/**
 * Result of buffer generation
 */
export interface BufferGenerationResult<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> {
  /** The generated buffer */
  buffer: Buffer;
  /** Warnings collected during generation, null if no warnings */
  warnings: GenerationWarning[] | null;
  /** Post-expansion, post-normalization standard JSON tree (custom plugins resolved). */
  standardDefinition: ReportComponentDefinition;
  /**
   * Partially-expanded tree honoring `preserveCustomComponents`.
   * Present iff the option was passed.
   */
  preservedDefinition?: ExtendedReportComponent<TCustomComponents>;
}

/**
 * Result of file generation
 */
export interface FileGenerationResult<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> {
  /** Warnings collected during generation, null if no warnings */
  warnings: GenerationWarning[] | null;
  /** Post-expansion, post-normalization standard JSON tree (custom plugins resolved). */
  standardDefinition: ReportComponentDefinition;
  /**
   * Partially-expanded tree honoring `preserveCustomComponents`.
   * Present iff the option was passed; also written as a JSON sidecar file.
   */
  preservedDefinition?: ExtendedReportComponent<TCustomComponents>;
  /** Resolved path of the preserved-tree sidecar, if written. */
  preservedOutputPath?: string;
}

/**
 * Result of `expandStandardDefinition` — the post-expansion JSON tree without
 * any of the rendering work.
 */
export interface StandardDefinitionResult {
  /** Post-expansion, post-normalization standard JSON tree (custom plugins resolved). */
  standardDefinition: ReportComponentDefinition;
  /** Warnings collected during expansion, null if no warnings */
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
  generateBuffer: (
    document: ExtendedReportComponent<TCustomComponents>,
    options?: GenerateOptions
  ) => Promise<BufferGenerationResult<TCustomComponents>>;

  generateFile: (
    document: ExtendedReportComponent<TCustomComponents>,
    outputPath: string,
    options?: GenerateFileOptions
  ) => Promise<FileGenerationResult<TCustomComponents>>;

  /**
   * Compute only the post-expansion standard definition: validation, theme
   * resolution, custom-component expansion, and normalization — no font
   * resolution, no layout, no rendering, no packaging, no external services.
   * Use this instead of `generateBuffer()` when you only need the JSON tree.
   */
  expandStandardDefinition: (
    document: ExtendedReportComponent<TCustomComponents>,
    options?: GenerateOptions
  ) => Promise<StandardDefinitionResult>;

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

  /**
   * @deprecated Use `generateBuffer(...).standardDefinition`, or
   * `expandStandardDefinition(...)` when you do not want a document at all.
   * This is a thin wrapper that runs `render()` once per call, so calling it
   * alongside `generateBuffer`/`generateFile` costs a second expansion pass.
   * Kept for backwards compatibility; will be removed in a future major.
   */
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

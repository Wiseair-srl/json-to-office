/**
 * PPTX plugin type utilities
 */

import type { Static, TSchema } from '@sinclair/typebox';
import type { CustomComponent } from '@json-to-office/shared/plugin';
import type {
  PptxComponentInput,
  PresentationComponentDefinition,
  SlideComponentDefinition,
  PipelineWarning,
} from '../types';
import type { PptxRendererId } from '../renderers/types';
import type { PresentationPackagingOptions } from '../core/finalizePackage';

// ---- Helper types ----

type InferVersionMap<T> =
  T extends CustomComponent<any, infer V, any> ? V : never;

type InferName<T> = T extends CustomComponent<any, any, infer N> ? N : never;

// ---- Custom component type extraction ----

/**
 * Extract the component type definition from a versioned CustomComponent.
 * Produces a discriminated union per version + a fallback variant.
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
          ? PptxComponentInput[]
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
          ? PptxComponentInput[]
          : never;
      }[keyof InferVersionMap<T> & string];
    };

/**
 * Union type of all custom component definitions from an array
 */
export type CustomComponentUnion<
  T extends readonly CustomComponent<any, any, any>[],
> = {
  [K in keyof T]: T[K] extends CustomComponent<any, any, any>
    ? ExtractCustomComponentType<T[K]>
    : never;
}[number];

/**
 * Extended PptxComponentInput that includes custom components
 */
export type ExtendedPptxComponentInput<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> = TCustomComponents extends readonly []
  ? PptxComponentInput
  : PptxComponentInput | CustomComponentUnion<TCustomComponents>;

/**
 * Extended SlideComponentDefinition with custom components in slide children
 */
export type ExtendedSlideComponent<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> = Omit<SlideComponentDefinition, 'children'> & {
  children?: ExtendedPptxComponentInput<TCustomComponents>[];
};

/**
 * Extended PresentationComponentDefinition with custom components in children
 */
export type ExtendedPresentationComponent<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> = Omit<PresentationComponentDefinition, 'children'> & {
  children?: (
    | ExtendedSlideComponent<TCustomComponents>
    | ExtendedPptxComponentInput<TCustomComponents>
  )[];
};

// ---- Generator result types ----

/**
 * Result of buffer generation
 */
export interface BufferGenerationResult {
  buffer: Buffer;
  warnings: PipelineWarning[];
}

/**
 * Result of file generation
 */
export interface FileGenerationResult {
  warnings: PipelineWarning[];
}

/**
 * Result of validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

/** Validation behavior shared by all plugin generation entry points. */
export interface GenerationValidationOptions {
  /** Validate authored and expanded trees before rendering. Defaults to true. */
  enabled?: boolean;
  /** Accept unknown props while preserving required-field/type checks. */
  allowUnknownFields?: boolean;
}

export interface GenerateOptions extends PresentationPackagingOptions {
  validation?: GenerationValidationOptions;
  /**
   * Directory that relative asset paths (image `path` props, slide
   * background images) resolve against for this call. Overrides the
   * constructor `baseDir`; defaults to `process.cwd()` when neither is
   * set (#142).
   */
  baseDir?: string;
  /**
   * Backend that turns the compiled presentation into bytes. Overrides the
   * constructor `renderer`; defaults to `pptxgenjs`.
   */
  renderer?: PptxRendererId;
}

export type GenerateFileOptions = GenerateOptions;

// ---- Generator interfaces ----

/**
 * Presentation generator with custom components and full type safety
 */
export interface PresentationGenerator<
  TCustomComponents extends readonly CustomComponent<
    any,
    any,
    any
  >[] = readonly [],
> {
  generate: (
    document: ExtendedPresentationComponent<TCustomComponents>,
    options?: GenerateOptions
  ) => Promise<BufferGenerationResult>;

  generateBuffer: (
    document: ExtendedPresentationComponent<TCustomComponents>,
    options?: GenerateOptions
  ) => Promise<BufferGenerationResult>;

  generateFile: (
    document: ExtendedPresentationComponent<TCustomComponents>,
    outputPath: string,
    options?: GenerateFileOptions
  ) => Promise<FileGenerationResult>;

  getComponentNames: () => string[];

  validate: (
    document: ExtendedPresentationComponent<TCustomComponents>
  ) => ValidationResult;

  generateSchema: () => TSchema;

  exportSchema: (
    outputPath: string,
    options?: { prettyPrint?: boolean }
  ) => Promise<void>;
}

/**
 * Presentation generator builder with chainable .addComponent() method
 */
export interface PresentationGeneratorBuilder<
  TComponents extends readonly CustomComponent<any, any, any>[] = readonly [],
> extends PresentationGenerator<TComponents> {
  addComponent<TNewComponent extends CustomComponent<any, any, any>>(
    component: TNewComponent
  ): PresentationGeneratorBuilder<readonly [...TComponents, TNewComponent]>;
}

// ---- Inference helpers ----

export type InferBuilderComponents<T> =
  T extends PresentationGeneratorBuilder<infer M> ? M : never;

export type InferDocumentType<T> =
  T extends PresentationGeneratorBuilder<infer M>
    ? ExtendedPresentationComponent<M>
    : never;

export type InferComponentDefinition<T> =
  T extends PresentationGeneratorBuilder<infer M>
    ? ExtendedPptxComponentInput<M>
    : T extends PresentationGenerator<infer M>
      ? ExtendedPptxComponentInput<M>
      : never;

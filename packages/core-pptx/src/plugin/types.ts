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
    document: ExtendedPresentationComponent<TCustomComponents>
  ) => Promise<BufferGenerationResult>;

  generateBuffer: (
    document: ExtendedPresentationComponent<TCustomComponents>
  ) => Promise<BufferGenerationResult>;

  generateFile: (
    document: ExtendedPresentationComponent<TCustomComponents>,
    outputPath: string
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

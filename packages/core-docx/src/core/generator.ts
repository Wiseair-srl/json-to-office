/**
 * Document generation entry points.
 *
 * Every path here compiles the authoring tree to DocxIR and hands it to a
 * renderer adapter; nothing in this module knows which backend that is. The
 * default is `docxjs`, which reproduces the output this pipeline has always
 * produced — see `src/__tests__/corpus-ir-parity.test.ts`.
 *
 * The surface is buffer- and file-oriented. No entry point returns or accepts a
 * renderer-native object: the whole point of the IR is that the backend is an
 * implementation detail, and handing a caller a docx.js `Document` would make
 * it part of the contract again.
 */

import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  ComponentDefinition,
  ReportProps,
  ReportComponentDefinition,
  isReportComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { generateBufferViaIr } from './generateFromIr';
import type { DocxRendererId } from '../renderers/types';
import type { PreparedDocument } from '@json-to-office/quality';
import type { DocxQualityFact, DocxQualityModel } from '../quality/facts';

// JSON support imports
import {
  DOCX_RENDERER_IDS,
  DocumentValidationResult,
} from '@json-to-office/shared-docx';
import type { GenerationWarning } from '@json-to-office/shared';
import {
  validateJsonComponent,
  JsonParsingError,
  JsonValidationError,
} from '../json/parser';
import { loadJsonDefinition } from '../json/filesystem';

// Local generation options type
export interface JsonGenerationOptions {
  outputPath?: string;
  validation?: {
    /**
     * Validate the document against the schema before building, throwing on
     * errors. Defaults to `true` — invalid props are surfaced rather than
     * silently dropped into a corrupt/incomplete document.
     */
    enabled?: boolean;
    /**
     * When true, unknown/extra properties are stripped instead of rejected by
     * strict (additionalProperties:false) schemas. Escape hatch for migration.
     */
    allowUnknownFields?: boolean;
    /** @deprecated No longer consulted; retained for back-compat. */
    strict?: boolean;
  };
  customThemes?: { [key: string]: ThemeConfig };
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  /**
   * Optional collector for structured warnings (font resolution, etc.).
   * When provided, mirrors the plugin path's warning semantics; when absent,
   * warnings fall back to `console.warn` as before.
   */
  warnings?: GenerationWarning[];
  /** Normalize volatile OOXML values for byte-identical output. Defaults true. */
  deterministic?: boolean;
  /** Build timestamp for metadata; defaults to a stable epoch. */
  generatedAt?: string | Date;
  /**
   * Directory that relative asset paths (image `path` props) resolve against.
   * File entry points default it to the document's own directory; elsewhere
   * it falls back to `process.cwd()` (#142).
   */
  baseDir?: string;
  /**
   * Backend to render with. Defaults to `docxjs`.
   *
   * The default reproduces byte-for-byte what this pipeline has always
   * produced; anything else is opt-in and may not.
   */
  renderer?: DocxRendererId;
  /**
   * Rasterize a PNG fallback for each inline SVG. Defaults to true.
   *
   * Only readers older than Word 2016 draw that raster; everything current
   * draws the vector. Producing it dominates the render of a document whose
   * artwork is many small SVGs, so it can be turned off.
   */
  svgRasterFallback?: boolean;
  /** Canonical prepared model; internal hosts use it to avoid a second prologue. */
  prepared?: PreparedDocument<DocxQualityModel, DocxQualityFact>;
}

/** A generated package, with whatever the pipeline had to say about it. */
export interface DocxGenerationResult {
  buffer: Buffer;
  warnings: GenerationWarning[];
}

/**
 * Type guard to check if input is a report component definition
 */
export function isReportComponentDefinition(
  definition: unknown
): definition is ReportComponentDefinition {
  if (typeof definition !== 'object' || definition === null) {
    return false;
  }

  const def = definition as Record<string, unknown>;

  // Must be a report component (optionally with $schema for JSON validation).
  // `props` is optional: a propless root generates like one with `props: {}`.
  return def.name === 'docx';
}

/**
 * Generate a `.docx` buffer from a report definition, with its warnings.
 *
 * Validation runs first unless the caller opts out: the same validator the
 * playground uses, so an object or a buffer is held to the same standard as a
 * pasted document and malformed props are surfaced rather than dropped into an
 * incomplete file.
 */
export async function generateBufferWithWarnings(
  jsonConfig: string | ComponentDefinition | ReportComponentDefinition,
  options?: JsonGenerationOptions
): Promise<DocxGenerationResult> {
  const document = parseDocument(jsonConfig);
  const renderer = options?.renderer ?? document.renderer;
  const validation = options?.validation;
  if (validation?.enabled !== false) {
    const result = validateJsonComponent(
      renderer && DOCX_RENDERER_IDS.includes(renderer)
        ? { ...document, renderer }
        : document,
      {
        allowUnknownFields: validation?.allowUnknownFields,
      }
    );
    const errors = result.errors.filter(
      (error) => error.code !== 'unsupported_renderer_feature'
    );
    if (errors.length > 0) {
      throw new JsonValidationError('Document validation failed', errors);
    }
  }

  return generateBufferViaIr(document, {
    ...(options?.customThemes ? { customThemes: options.customThemes } : {}),
    ...(options?.services ? { services: options.services } : {}),
    ...(options?.fonts ? { fonts: options.fonts } : {}),
    ...(options?.warnings ? { warnings: options.warnings } : {}),
    ...(options?.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
    ...(options?.deterministic !== undefined
      ? { deterministic: options.deterministic }
      : {}),
    ...(options?.generatedAt !== undefined
      ? { generatedAt: options.generatedAt }
      : {}),
    ...(renderer ? { renderer } : {}),
    ...(options?.svgRasterFallback !== undefined
      ? { svgRasterFallback: options.svgRasterFallback }
      : {}),
    ...(options?.prepared ? { prepared: options.prepared } : {}),
  });
}

/** Resolve a JSON string or an object to the report definition to build. */
function parseDocument(
  jsonConfig: string | ComponentDefinition | ReportComponentDefinition
): ReportComponentDefinition {
  if (typeof jsonConfig !== 'string') {
    return jsonConfig as ReportComponentDefinition;
  }

  let parsed: ComponentDefinition;
  try {
    parsed = JSON.parse(jsonConfig) as ComponentDefinition;
  } catch (error) {
    throw new JsonParsingError('Invalid JSON syntax', [
      {
        path: '',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        code: 'JSON_PARSE_ERROR',
      },
    ]);
  }
  if (!isReportComponent(parsed)) {
    throw new Error('Parsed JSON must be a docx component');
  }
  return parsed as ReportComponentDefinition;
}

/**
 * Generate a `.docx` buffer from a report definition built out of props and
 * children — the same document as passing `{ name: 'docx', props, children }`.
 */
export async function generateBufferFromConfig(
  props: ReportProps,
  components: ComponentDefinition[],
  options?: JsonGenerationOptions
): Promise<Buffer> {
  return generateBufferFromJson(
    { name: 'docx', props, children: components } as ReportComponentDefinition,
    options
  );
}

/**
 * Validate JSON schema without generating document
 */
export function validateJsonSchema(
  jsonConfig: string | object
): DocumentValidationResult {
  return validateJsonComponent(jsonConfig);
}

/**
 * Generate a `.docx` buffer from a report definition.
 */
export async function generateBufferFromJson(
  jsonConfig: string | ComponentDefinition | ReportComponentDefinition,
  options?: JsonGenerationOptions
): Promise<Buffer> {
  const { buffer } = await generateBufferWithWarnings(jsonConfig, options);
  return buffer;
}

/**
 * Generate and save a `.docx` file from a report definition.
 */
export async function generateAndSaveFromJson(
  jsonConfig: string | ComponentDefinition | ReportComponentDefinition,
  filename: string,
  options?: JsonGenerationOptions
): Promise<void> {
  writeFileSync(filename, await generateBufferFromJson(jsonConfig, options));
}

/**
 * Generate a `.docx` buffer from a JSON file.
 *
 * The document's own directory is the natural base for its relative assets, so
 * it becomes the default `baseDir` unless the caller says otherwise.
 */
export async function generateBufferFromFile(
  filePath: string,
  options?: JsonGenerationOptions
): Promise<Buffer> {
  const definition = await loadJsonDefinition(filePath);
  return generateBufferFromJson(definition, {
    baseDir: dirname(resolve(filePath)),
    ...options,
  });
}

/**
 * Generate and save a `.docx` file from a JSON file.
 */
export async function generateAndSaveFromFile(
  inputFilePath: string,
  outputFilePath: string,
  options?: JsonGenerationOptions
): Promise<void> {
  writeFileSync(
    outputFilePath,
    await generateBufferFromFile(inputFilePath, options)
  );
}

/**
 * Compose multiple transform functions
 * Utility for creating custom pipelines
 */
export function pipe<T>(...fns: Array<(_arg: T) => T>): (_arg: T) => T {
  return (_arg: T) => fns.reduce((acc, fn) => fn(acc), _arg);
}

/**
 * The main API surface.
 *
 * Buffer- and file-oriented only: no member returns a renderer-native object.
 */
export const DocumentGenerator = {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateBufferFromConfig,
  generateBufferFromFile,
  generateAndSaveFromJson,
  generateAndSaveFromFile,
  validateJsonSchema,
  isReportComponentDefinition,
};

/**
 * Document Generator
 * Main orchestration functions that compose the document generation pipeline
 */

import { Document } from 'docx';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  ComponentDefinition,
  ReportProps,
  ReportComponentDefinition,
  isReportComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { resolveThemeContext } from './generationContext';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { processDocument } from './structure';
import { applyLayout } from './layout';
import { renderDocument } from './render';
import { resolveDocumentFonts } from './fontResolution';
import { collectVisualProps } from './prerasterizeVisuals';
import { toRasterizeFontFaces } from '@json-to-office/shared/fonts/node';
import {
  packageDocument,
  resolveGenerationDate,
} from '../utils/packageDocument';

// JSON support imports
import { DocumentValidationResult } from '@json-to-office/shared-docx';
import type { GenerationWarning } from '@json-to-office/shared';
import {
  validateJsonComponent,
  JsonParsingError,
  JsonValidationError,
} from '../json/parser';
import { normalizeDocument } from '../json/normalizer';
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
}

// Font resolution shared with the plugin path — see ./fontResolution.ts

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
 * Generate a Word document from a report component definition
 * This is the main entry point for document generation
 */
export async function generateDocument(
  document: ReportComponentDefinition,
  options?: JsonGenerationOptions
): Promise<Document> {
  // Validate that the document is a report component
  if (!document || document.name !== 'docx') {
    throw new Error('Top-level component must be a docx component');
  }

  // Handle JSON definitions (report components with $schema)
  if ('$schema' in document) {
    return await generateDocumentFromJson(document, options);
  }

  // Route through the font-aware pipeline so `options.fonts` (mode,
  // substitution, onResolved, strict) is honoured identically to the JSON
  // entry point. Previously this branch bypassed export-mode + font
  // resolution, silently ignoring `fonts.mode: 'substitute'`.
  return await generateDocumentWithCustomThemes(
    document,
    options?.customThemes,
    options?.services,
    options?.fonts,
    options?.warnings,
    resolveGenerationDate(options),
    options?.baseDir
  );
}

/**
 * Generate document from report props and components
 * Convenience function that constructs the report component
 */
export async function generateFromConfig(
  props: ReportProps,
  components: ComponentDefinition[],
  options?: JsonGenerationOptions
): Promise<Document> {
  const reportComponent: ReportComponentDefinition = {
    name: 'docx',
    props,
    children: components,
  };

  return await generateDocument(reportComponent, options);
}

/**
 * Generate a Word document with custom themes support
 * Extends the standard pipeline to support custom theme resolution
 */
async function generateDocumentWithCustomThemes(
  documentIn: ReportComponentDefinition,
  customThemes?: { [key: string]: ThemeConfig },
  services?: ServicesConfig,
  fonts?: FontRuntimeOpts,
  warnings?: GenerationWarning[],
  generationDate?: Date,
  baseDir?: string
): Promise<Document> {
  // Props defaulting, theme resolution, in-document overrides, export-mode
  // pre-pass and cache-key scoping — shared with the plugin pipeline so the
  // two cannot drift (see core/generationContext.ts).
  const { document, theme, themeName } = resolveThemeContext(documentIn, {
    customThemes,
    fonts,
    warnings,
  });

  // Resolve fonts for the LibreOffice preview stager (side-channel).
  // resolveDocumentFonts fires `fonts.onResolved` internally when a
  // listener is registered. The final DOCX never embeds bytes.
  //
  // A `visual` is rasterized by an out-of-process LibreOffice, which needs
  // the real font files, so a visual-bearing document forces materialization
  // even with no listener (the plain CLI path has none). Gated on the visual
  // check so fontless-by-design builds still pay no network cost.
  const hasVisual = collectVisualProps(document).length > 0;
  const resolvedFonts = await resolveDocumentFonts(
    document,
    theme,
    fonts,
    warnings,
    hasVisual
  );
  // Gate on the ENCODED faces, not on `resolvedFonts.length`: a safe-only
  // font resolves to an entry with no sources, which encodes to nothing. A
  // document with only safe fonts must send no `fonts` key at all so its
  // rasterize body — and therefore its cache key — is unchanged.
  const visualFonts = hasVisual ? toRasterizeFontFaces(resolvedFonts) : [];

  // Pipeline: Structure -> Layout -> Render (with caching)
  const structure = await processDocument(
    document,
    theme,
    themeName,
    generationDate
  );
  const layout = applyLayout(structure.sections, theme, themeName);
  const renderedDocument = await renderDocument(structure, layout, {
    bypassCache: false,
    services,
    baseDir,
    ...(visualFonts.length > 0 && { visualFonts }),
  });

  return renderedDocument;
}

/**
 * Generate a Word document from JSON report definition
 * Handles parsing, validation, and conversion to internal components
 */
export async function generateDocumentFromJson(
  jsonConfig: string | ComponentDefinition | ReportComponentDefinition,
  options?: JsonGenerationOptions
): Promise<Document> {
  // Validate before building unless the caller opted out. This runs the same
  // plugin-unaware validator the public playground uses, so the object/buffer
  // entry point is as strict as the playground — malformed props throw instead
  // of being silently dropped into the document.
  const validation = options?.validation;
  if (validation?.enabled !== false) {
    const result = validateJsonComponent(jsonConfig, {
      allowUnknownFields: validation?.allowUnknownFields,
    });
    if (!result.valid) {
      throw new JsonValidationError(
        'Document validation failed',
        result.errors
      );
    }
  }

  // Resolve to an object for the build pipeline.
  let componentToConvert: ComponentDefinition | ReportComponentDefinition;
  if (typeof jsonConfig === 'string') {
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
    componentToConvert = parsed as ReportComponentDefinition;
  } else {
    // Could be either ComponentDefinition (from JSON) or ReportComponentDefinition (internal)
    componentToConvert = jsonConfig;
  }

  // Normalize JSON components (handle shorthand notations and nested structures)
  // The normalizer preserves all validated properties from TypeBox
  const [reportComponent] = normalizeDocument(componentToConvert);

  // Generate document using custom theme-aware pipeline.
  // Font registry lives on the theme, so resolution happens inside the
  // pipeline (after theme selection).
  return await generateDocumentWithCustomThemes(
    reportComponent,
    options?.customThemes,
    options?.services,
    options?.fonts,
    options?.warnings,
    resolveGenerationDate(options),
    options?.baseDir
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
 * Generate document buffer from JSON (commonly used for API responses)
 */
export async function generateBufferFromJson(
  jsonConfig: string | ReportComponentDefinition,
  options?: JsonGenerationOptions
): Promise<Buffer> {
  const document = await generateDocumentFromJson(jsonConfig, options);
  return packageDocument(document, options);
}

/**
 * Generate and save document from JSON in one operation
 */
export async function generateAndSaveFromJson(
  jsonConfig: string | ReportComponentDefinition,
  filename: string,
  options?: JsonGenerationOptions
): Promise<void> {
  const document = await generateDocumentFromJson(jsonConfig, options);
  await saveDocument(document, filename, options);
}

/**
 * Generate document from JSON file
 */
export async function generateDocumentFromFile(
  filePath: string,
  options?: JsonGenerationOptions
): Promise<Document> {
  const jsonDefinition = await loadJsonDefinition(filePath);
  // loadJsonDefinition returns ComponentDefinition from shared (JSON schema type)
  // generateDocumentFromJson now accepts the JSON schema type directly
  // The document's own directory is the natural base for its relative assets.
  return await generateDocumentFromJson(jsonDefinition, {
    baseDir: dirname(resolve(filePath)),
    ...options,
  });
}

/**
 * Generate document buffer from JSON file
 */
export async function generateBufferFromFile(
  filePath: string,
  options?: JsonGenerationOptions
): Promise<Buffer> {
  const document = await generateDocumentFromFile(filePath, options);
  return packageDocument(document, options);
}

/**
 * Generate and save document from JSON file in one operation
 */
export async function generateAndSaveFromFile(
  inputFilePath: string,
  outputFilePath: string,
  options?: JsonGenerationOptions
): Promise<void> {
  const document = await generateDocumentFromFile(inputFilePath, options);
  await saveDocument(document, outputFilePath, options);
}

/**
 * Save a document to file
 */
export async function saveDocument(
  document: Document,
  filename: string,
  options?: JsonGenerationOptions
): Promise<void> {
  const buffer = await packageDocument(document, options);
  writeFileSync(filename, buffer);
}

/**
 * Generate and save document in one operation
 */
export async function generateAndSave(
  document: ReportComponentDefinition,
  filename: string,
  options?: JsonGenerationOptions
): Promise<void> {
  const generatedDocument = await generateDocument(document, options);
  await saveDocument(generatedDocument, filename, options);
}

/**
 * Compose multiple transform functions
 * Utility for creating custom pipelines
 */
export function pipe<T>(...fns: Array<(_arg: T) => T>): (_arg: T) => T {
  return (_arg: T) => fns.reduce((acc, fn) => fn(acc), _arg);
}

/**
 * Export the main API
 */
export const DocumentGenerator = {
  generate: generateDocument,
  generateFromConfig,
  generateFromJson: generateDocumentFromJson,
  generateFromFile: generateDocumentFromFile,
  generateBufferFromJson,
  generateBufferFromFile,
  generateAndSaveFromJson,
  generateAndSaveFromFile,
  validateJsonSchema,
  save: saveDocument,
  generateAndSave,
  isReportComponentDefinition,
};

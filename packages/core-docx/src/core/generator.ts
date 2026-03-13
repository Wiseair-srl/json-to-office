/**
 * Document Generator
 * Main orchestration functions that compose the document generation pipeline
 */

import { Document, Packer } from 'docx';
import { writeFileSync } from 'fs';
import {
  ComponentDefinition,
  ReportProps,
  ReportComponentDefinition,
  isReportComponent,
} from '../types';
import { getThemeWithFallback, ThemeConfig } from '../styles';
import { processDocument } from './structure';
import { applyLayout } from './layout';
import { renderDocument } from './render';

// JSON support imports
import { DocumentValidationResult } from '@json-to-office/shared-docx';
import { parseJsonComponent, validateJsonComponent } from '../json/parser';
import { normalizeDocument } from '../json/normalizer';
import { loadJsonDefinition } from '../json/filesystem';

// Local generation options type
export interface JsonGenerationOptions {
  outputPath?: string;
  validation?: {
    strict?: boolean;
    allowUnknownFields?: boolean;
  };
  customThemes?: { [key: string]: ThemeConfig };
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

  // Must be a report component (optionally with $schema for JSON validation)
  return def.name === 'docx' && 'props' in def;
}

/**
 * Generate a Word document from a report component definition
 * This is the main entry point for document generation
 */
export async function generateDocument(
  document: ReportComponentDefinition
): Promise<Document> {
  // Validate that the document is a report component
  if (!document || document.name !== 'docx') {
    throw new Error('Top-level component must be a docx component');
  }

  // Handle JSON definitions (report components with $schema)
  if ('$schema' in document) {
    return await generateDocumentFromJson(document);
  }

  // Get theme configuration (theme is always a string name)
  const themeName = document.props.theme || 'minimal';
  const theme = getThemeWithFallback(themeName);

  // Pipeline: Structure -> Layout -> Render (with caching)
  const structure = await processDocument(document, theme, themeName);
  const layout = applyLayout(structure.sections, theme, themeName);
  const renderedDocument = await renderDocument(structure, layout, {
    bypassCache: false, // Enable component caching
  });

  return renderedDocument;
}

/**
 * Generate document from report props and components
 * Convenience function that constructs the report component
 */
export async function generateFromConfig(
  props: ReportProps,
  components: ComponentDefinition[]
): Promise<Document> {
  const reportComponent: ReportComponentDefinition = {
    name: 'docx',
    props,
    children: components,
  };

  return await generateDocument(reportComponent);
}

/**
 * Generate a Word document with custom themes support
 * Extends the standard pipeline to support custom theme resolution
 */
async function generateDocumentWithCustomThemes(
  document: ReportComponentDefinition,
  customThemes?: { [key: string]: ThemeConfig }
): Promise<Document> {
  // Get theme configuration with custom theme support (theme is always a string name)
  const themeName = document.props.theme || 'minimal';
  let theme: ThemeConfig;

  // Check custom themes first with case-insensitive matching, then fall back to built-in
  if (customThemes) {
    // Try exact match first
    if (customThemes[themeName]) {
      theme = customThemes[themeName];
    } else {
      // Try case-insensitive match
      const themeNameLower = themeName.toLowerCase();
      const matchingThemeKey = Object.keys(customThemes).find(
        (key) => key.toLowerCase() === themeNameLower
      );
      if (matchingThemeKey) {
        theme = customThemes[matchingThemeKey];
      } else {
        theme = getThemeWithFallback(themeName);
      }
    }
  } else {
    theme = getThemeWithFallback(themeName);
  }

  // Pipeline: Structure -> Layout -> Render (with caching)
  const structure = await processDocument(document, theme, themeName);
  const layout = applyLayout(structure.sections, theme, themeName);
  const renderedDocument = await renderDocument(structure, layout, {
    bypassCache: false, // Enable component caching
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
  // Handle string input
  let componentToConvert: ComponentDefinition | ReportComponentDefinition;
  if (typeof jsonConfig === 'string') {
    // Parse and validate - parseJsonComponent returns ComponentDefinition
    const parsed = parseJsonComponent(jsonConfig) as ComponentDefinition;
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
  // Generate document using custom theme-aware pipeline
  return await generateDocumentWithCustomThemes(
    reportComponent,
    options?.customThemes
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
  return await Packer.toBuffer(document);
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
  await saveDocument(document, filename);
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
  return await generateDocumentFromJson(jsonDefinition, options);
}

/**
 * Generate document buffer from JSON file
 */
export async function generateBufferFromFile(
  filePath: string,
  options?: JsonGenerationOptions
): Promise<Buffer> {
  const document = await generateDocumentFromFile(filePath, options);
  return await Packer.toBuffer(document);
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
  await saveDocument(document, outputFilePath);
}

/**
 * Save a document to file
 */
export async function saveDocument(
  document: Document,
  filename: string
): Promise<void> {
  const buffer = await Packer.toBuffer(document);
  writeFileSync(filename, buffer);

  // Post-process: Fix duplicate wp:docPr IDs in floating images
  try {
    const { fixFloatingImageIds } = await import(
      '../utils/fixFloatingImageIds'
    );
    await fixFloatingImageIds(filename);
  } catch (error) {
    console.warn('Failed to fix floating image IDs (non-critical):', error);
  }
}

/**
 * Generate and save document in one operation
 */
export async function generateAndSave(
  document: ReportComponentDefinition,
  filename: string
): Promise<void> {
  const generatedDocument = await generateDocument(document);
  await saveDocument(generatedDocument, filename);
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

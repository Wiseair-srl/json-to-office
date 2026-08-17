/**
 * Presentation Generator
 * Main orchestration functions for the PPTX generation pipeline
 */

import PptxGenJS from 'pptxgenjs';
import { writeFileSync } from 'fs';
import type {
  PresentationComponentDefinition,
  PptxThemeConfig,
  PipelineWarning,
  PendingXmlFill,
} from '../types';
import { isPresentationComponent } from '../types';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { processPresentation } from './structure';
import { renderPresentation } from './render';
import { resolveDocumentFonts } from './fontResolution';
import { resolveThemeContext } from './generationContext';
import {
  collectImageSourceConflicts,
  collectTextContentConflicts,
  validateJsonPresentationDocument,
  validatePresentationDocument,
  type ValidationError,
} from '@json-to-office/shared-pptx';
import {
  packagePresentationBuffer,
  type PresentationPackagingOptions,
} from './packagePresentation';

export interface GenerationValidationOptions {
  /** Validate the complete component tree before rendering. Defaults to true. */
  enabled?: boolean;
  /** Accept unknown props while still enforcing required fields and types. */
  allowUnknownFields?: boolean;
}

/**
 * Options for the generation pipeline
 */
export interface GenerationOptions extends PresentationPackagingOptions {
  customThemes?: Record<string, PptxThemeConfig>;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  validation?: GenerationValidationOptions;
}

// Font resolution shared with the plugin path — see ./fontResolution.ts

/**
 * Result from generateBufferWithWarnings
 */
export interface GenerationResult {
  buffer: Buffer;
  warnings: PipelineWarning[];
}

/** Error thrown when a presentation fails the generation validation gate. */
export class PresentationValidationError extends Error {
  public readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(
      `Presentation validation failed:\n${errors
        .map((error) => `  - ${error.path}: ${error.message}`)
        .join('\n')}`
    );
    this.name = 'PresentationValidationError';
    this.errors = errors;
  }
}

function assertValidPresentation(
  input: string | unknown,
  validation?: GenerationValidationOptions
): void {
  if (validation?.enabled === false) return;

  const options = {
    allowUnknownFields: validation?.allowUnknownFields,
  };
  const result =
    typeof input === 'string'
      ? validateJsonPresentationDocument(input, options)
      : validatePresentationDocument(input, options);

  if (!result.valid) {
    throw new PresentationValidationError(result.errors);
  }
}

/**
 * Structural rules the per-component schema can't express: image sources
 * (path/base64/svg) are mutually exclusive, and text components carry
 * exactly one of text/runs. Reject conflicting payloads before rendering so
 * they can't be silently resolved by runtime precedence. Matches core-docx,
 * which fails generation on the same image conflict.
 *
 * Runs unconditionally — the validators also collect these conflicts, so this
 * is the net for `validation: { enabled: false }`. Shared with the plugin
 * path, which checks the expanded tree (custom components can emit
 * conflicting payloads too).
 */
export function assertNoContentConflicts(document: unknown): void {
  const sourceConflicts = [
    ...collectImageSourceConflicts(document),
    ...collectTextContentConflicts(document),
  ];
  if (sourceConflicts.length > 0) {
    throw new Error(
      `Document validation failed:\n${sourceConflicts
        .map((e) => `  - ${e.path}: ${e.message}`)
        .join('\n')}`
    );
  }
}

/**
 * Type guard for presentation component
 */
export function isPresentationComponentDefinition(
  definition: unknown
): definition is PresentationComponentDefinition {
  if (typeof definition !== 'object' || definition === null) return false;
  const def = definition as Record<string, unknown>;
  return def.name === 'pptx' && 'props' in def;
}

/**
 * Generate a PptxGenJS instance from a presentation component definition
 */
export async function generatePresentation(
  document: PresentationComponentDefinition,
  options?: GenerationOptions,
  warnings?: PipelineWarning[],
  pendingFills?: PendingXmlFill[]
): Promise<PptxGenJS> {
  assertValidPresentation(document, options?.validation);

  if (!document || document.name !== 'pptx') {
    throw new Error('Top-level component must be a pptx component');
  }

  assertNoContentConflicts(document);

  const processed = processPresentation(document, options);
  return await renderPresentation(processed, warnings, pendingFills);
}

/**
 * Generate a buffer from JSON definition
 */
export async function generateBufferFromJson(
  jsonConfig: string | PresentationComponentDefinition,
  options?: GenerationOptions
): Promise<Buffer> {
  const result = await generateBufferWithWarnings(jsonConfig, options);
  return result.buffer;
}

/**
 * Generate a buffer from JSON definition, returning warnings alongside the buffer
 */
export async function generateBufferWithWarnings(
  jsonConfig: string | PresentationComponentDefinition,
  options?: GenerationOptions
): Promise<GenerationResult> {
  assertValidPresentation(jsonConfig, options?.validation);

  let component: PresentationComponentDefinition;

  if (typeof jsonConfig === 'string') {
    const parsed = JSON.parse(jsonConfig);
    if (!isPresentationComponent(parsed)) {
      throw new Error('Parsed JSON must be a presentation component');
    }
    component = parsed;
  } else {
    component = jsonConfig;
  }

  const warnings: PipelineWarning[] = [];

  // Props defaulting, inline-theme normalization, theme resolution,
  // export-mode pre-pass and cache-key scoping — shared with the plugin
  // pipeline so the two cannot drift (see core/generationContext.ts).
  const context = resolveThemeContext(component, {
    customThemes: options?.customThemes,
    fonts: options?.fonts,
    warnings,
  });
  component = context.document;
  // resolveDocumentFonts fires `fonts.onResolved` internally when a
  // listener is registered (LibreOffice preview stager). The PPTX itself
  // never embeds bytes.
  await resolveDocumentFonts(
    component,
    context.theme,
    warnings,
    options?.fonts
  );
  // processPresentation re-resolves the theme from `props.theme` (normalized
  // to context.themeName), so the resolved theme is registered under that
  // name for it to find.
  const effectiveOptions: GenerationOptions = {
    ...options,
    customThemes: {
      ...(options?.customThemes ?? {}),
      [context.themeName]: context.theme,
    },
  };
  // Gradient/pattern fills render as sentinel solid fills during generation;
  // packagePresentationBuffer splices the real fill XML in afterwards.
  const pendingFills: PendingXmlFill[] = [];
  const pptx = await generatePresentation(
    component,
    effectiveOptions,
    warnings,
    pendingFills
  );
  const data = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = await packagePresentationBuffer(data as Buffer, {
    ...options,
    pendingFills,
  });
  return { buffer, warnings };
}

/**
 * Generate and save a .pptx file from JSON definition
 */
export async function generateAndSaveFromJson(
  jsonConfig: string | PresentationComponentDefinition,
  outputPath: string,
  options?: GenerationOptions
): Promise<void> {
  const buffer = await generateBufferFromJson(jsonConfig, options);
  writeFileSync(outputPath, buffer);
}

/**
 * Generate from a JSON file path
 */
export async function generateFromFile(
  filePath: string,
  outputPath: string,
  options?: GenerationOptions
): Promise<void> {
  const { readFileSync } = await import('fs');
  const json = readFileSync(filePath, 'utf-8');
  await generateAndSaveFromJson(json, outputPath, options);
}

/**
 * Save a PptxGenJS instance to file
 */
export async function savePresentation(
  pptx: PptxGenJS,
  outputPath: string,
  options?: PresentationPackagingOptions
): Promise<void> {
  const data = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = await packagePresentationBuffer(data as Buffer, options);
  writeFileSync(outputPath, buffer);
}

/**
 * Export the main API
 */
export const PresentationGenerator = {
  generate: generatePresentation,
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateAndSaveFromJson,
  generateFromFile,
  save: savePresentation,
  isPresentationComponentDefinition,
};

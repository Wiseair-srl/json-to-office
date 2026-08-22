/**
 * Presentation generation entry points.
 *
 * Every path here compiles the authoring tree to PptxIR and hands it to a
 * renderer adapter; nothing in this module knows which backend that is. The
 * default is `pptxgenjs`, which reproduces the output this pipeline has always
 * produced — see `src/__tests__/corpus-goldens.test.ts`.
 */

import { writeFileSync } from 'fs';
import type {
  PipelineWarning,
  PresentationComponentDefinition,
} from '../types';
import { generateBufferViaIr } from './generateFromIr';

export {
  PresentationValidationError,
  assertNoContentConflicts,
  assertValidPresentation,
  isPresentationComponentDefinition,
} from './generationOptions';
export type {
  GenerationOptions,
  GenerationResult,
  GenerationValidationOptions,
} from './generationOptions';

import {
  isPresentationComponentDefinition,
  type GenerationOptions,
  type GenerationResult,
} from './generationOptions';

/**
 * Generate a `.pptx` buffer from a presentation definition.
 */
export async function generateBufferFromJson(
  jsonConfig: string | PresentationComponentDefinition,
  options?: GenerationOptions
): Promise<Buffer> {
  const result = await generateBufferWithWarnings(jsonConfig, options);
  return result.buffer;
}

/**
 * Generate a `.pptx` buffer, returning the pipeline warnings alongside it.
 */
export async function generateBufferWithWarnings(
  jsonConfig: string | PresentationComponentDefinition,
  options?: GenerationOptions
): Promise<GenerationResult> {
  const { buffer, warnings } = await generateBufferViaIr(jsonConfig, options);
  return { buffer, warnings };
}

/**
 * Generate and save a `.pptx` file from a presentation definition.
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
 * Generate from a JSON file path.
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

export type { PipelineWarning };

/**
 * The main API surface.
 *
 * Buffer- and file-oriented only: no member returns a renderer-native object.
 */
export const PresentationGenerator = {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateAndSaveFromJson,
  generateFromFile,
  isPresentationComponentDefinition,
};

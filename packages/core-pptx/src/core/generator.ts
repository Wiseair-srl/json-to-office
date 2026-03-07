/**
 * Presentation Generator
 * Main orchestration functions for the PPTX generation pipeline
 */

import PptxGenJS from 'pptxgenjs';
import { writeFileSync } from 'fs';
import type { PresentationComponentDefinition, PptxThemeConfig } from '../types';
import { isPresentationComponent } from '../types';
import { processPresentation } from './structure';
import { renderPresentation } from './render';

/**
 * Options for the generation pipeline
 */
export interface GenerationOptions {
  customThemes?: Record<string, PptxThemeConfig>;
}

/**
 * Type guard for presentation component
 */
export function isPresentationComponentDefinition(
  definition: unknown
): definition is PresentationComponentDefinition {
  if (typeof definition !== 'object' || definition === null) return false;
  const def = definition as Record<string, unknown>;
  return def.name === 'presentation' && 'props' in def;
}

/**
 * Generate a PptxGenJS instance from a presentation component definition
 */
export async function generatePresentation(
  document: PresentationComponentDefinition,
  options?: GenerationOptions
): Promise<PptxGenJS> {
  if (!document || document.name !== 'presentation') {
    throw new Error('Top-level component must be a presentation component');
  }

  const processed = processPresentation(document, options);
  return renderPresentation(processed);
}

/**
 * Generate a buffer from JSON definition
 */
export async function generateBufferFromJson(
  jsonConfig: string | PresentationComponentDefinition,
  options?: GenerationOptions
): Promise<Buffer> {
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

  const pptx = await generatePresentation(component, options);
  const data = await pptx.write({ outputType: 'nodebuffer' });
  return data as Buffer;
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
  outputPath: string
): Promise<void> {
  const { readFileSync } = await import('fs');
  const json = readFileSync(filePath, 'utf-8');
  await generateAndSaveFromJson(json, outputPath);
}

/**
 * Save a PptxGenJS instance to file
 */
export async function savePresentation(
  pptx: PptxGenJS,
  outputPath: string
): Promise<void> {
  const data = await pptx.write({ outputType: 'nodebuffer' });
  writeFileSync(outputPath, data as Buffer);
}

/**
 * Export the main API
 */
export const PresentationGenerator = {
  generate: generatePresentation,
  generateBufferFromJson,
  generateAndSaveFromJson,
  generateFromFile,
  save: savePresentation,
  isPresentationComponentDefinition,
};

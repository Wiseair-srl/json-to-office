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
} from '../types';
import { isPresentationComponent } from '../types';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { processPresentation } from './structure';
import { renderPresentation } from './render';
import { getPptxTheme } from '../themes/defaults';
import { resolveDocumentFonts } from './fontResolution';
import { applyExportMode, scopedThemeName } from '@json-to-office/shared';
import {
  collectImageSourceConflicts,
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
  warnings?: PipelineWarning[]
): Promise<PptxGenJS> {
  assertValidPresentation(document, options?.validation);

  if (!document || document.name !== 'pptx') {
    throw new Error('Top-level component must be a pptx component');
  }

  // Structural rule the per-component schema can't express: image sources
  // (path/base64/svg) are mutually exclusive. Reject multi-source payloads
  // before rendering so they can't be silently resolved by runtime precedence.
  // Matches core-docx, which fails generation on the same conflict.
  const sourceConflicts = collectImageSourceConflicts(document);
  if (sourceConflicts.length > 0) {
    throw new Error(
      `Document validation failed:\n${sourceConflicts
        .map((e) => `  - ${e.path}: ${e.message}`)
        .join('\n')}`
    );
  }

  const processed = processPresentation(document, options);
  return await renderPresentation(processed, warnings);
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

  // An inline theme object (self-contained document) is normalized to a named
  // customThemes entry up front so the rest of the pipeline — font-mode
  // scoping and processPresentation's name-keyed re-resolution — works
  // unchanged.
  if (
    typeof component.props?.theme === 'object' &&
    component.props.theme !== null
  ) {
    const inlineTheme = component.props.theme as PptxThemeConfig;
    const inlineName = inlineTheme.name || 'inline-theme';
    component = {
      ...component,
      props: { ...component.props, theme: inlineName },
    };
    options = {
      ...options,
      customThemes: {
        ...(options?.customThemes ?? {}),
        [inlineName]: inlineTheme,
      },
    };
  }

  const baseThemeName = (component.props?.theme ?? 'default') as string;
  let resolvedTheme =
    options?.customThemes?.[baseThemeName] ?? getPptxTheme(baseThemeName);
  // Export-mode pre-pass: substitute rewrites non-safe families in place;
  // custom leaves refs untouched and resolution short-circuits to empty.
  const mode = applyExportMode({
    doc: component,
    theme: resolvedTheme,
    fonts: options?.fonts,
  });
  component = mode.doc;
  resolvedTheme = mode.theme;
  for (const w of mode.warnings) {
    warnings.push({
      code: w.code,
      message: w.message,
      component: 'fontRegistry',
    });
  }
  // resolveDocumentFonts fires `fonts.onResolved` internally when a
  // listener is registered (LibreOffice preview stager). The PPTX itself
  // never embeds bytes.
  await resolveDocumentFonts(
    component,
    resolvedTheme,
    warnings,
    options?.fonts
  );
  // Scope the theme key by mode so any future theme-name-keyed cache in
  // PPTX can't leak a custom-mode layout into a substitute-mode run (or
  // vice versa). Matches the DOCX path. processPresentation re-resolves
  // the theme from `props.theme`, so we rewrite it on the component too.
  const themeName = scopedThemeName(baseThemeName, options?.fonts?.mode);
  if (themeName !== baseThemeName) {
    component = {
      ...component,
      props: { ...component.props, theme: themeName },
    };
  }
  const effectiveOptions: GenerationOptions = {
    ...options,
    customThemes: {
      ...(options?.customThemes ?? {}),
      [themeName]: resolvedTheme,
    },
  };
  const pptx = await generatePresentation(
    component,
    effectiveOptions,
    warnings
  );
  const data = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = await packagePresentationBuffer(data as Buffer, options);
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

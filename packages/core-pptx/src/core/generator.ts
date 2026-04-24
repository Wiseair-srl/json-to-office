/**
 * Presentation Generator
 * Main orchestration functions for the PPTX generation pipeline
 */

import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
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

/**
 * Options for the generation pipeline
 */
export interface GenerationOptions {
  customThemes?: Record<string, PptxThemeConfig>;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
}

// Font resolution shared with the plugin path — see ./fontResolution.ts

/**
 * Result from generateBufferWithWarnings
 */
export interface GenerationResult {
  buffer: Buffer;
  warnings: PipelineWarning[];
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
  if (!document || document.name !== 'pptx') {
    throw new Error('Top-level component must be a pptx component');
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
  const baseThemeName = component.props?.theme ?? 'default';
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
  const buffer = await neutralizeTableStyle(data as Buffer);
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
  outputPath: string
): Promise<void> {
  const { readFileSync } = await import('fs');
  const json = readFileSync(filePath, 'utf-8');
  await generateAndSaveFromJson(json, outputPath);
}

/**
 * Replace the default table style (Medium Style 2 - Accent 1, which applies allCaps
 * to headers) with "No Style, No Grid" so table text renders as authored.
 */
const MEDIUM_STYLE_2_ACCENT_1 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const NO_STYLE_NO_GRID = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';

async function neutralizeTableStyle(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!path.match(/^ppt\/slides\/slide\d+\.xml$/)) continue;
    const xml = await entry.async('string');
    if (xml.includes(MEDIUM_STYLE_2_ACCENT_1)) {
      zip.file(path, xml.replaceAll(MEDIUM_STYLE_2_ACCENT_1, NO_STYLE_NO_GRID));
      changed = true;
    }
  }
  return changed
    ? ((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer)
    : buffer;
}

/**
 * Save a PptxGenJS instance to file
 */
export async function savePresentation(
  pptx: PptxGenJS,
  outputPath: string
): Promise<void> {
  const data = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = await neutralizeTableStyle(data as Buffer);
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

/**
 * Generation options and the pre-generation gates.
 *
 * Extracted from `generator.ts` so the IR pipeline can use them without
 * importing the module that now delegates to it.
 */

import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import {
  collectImageSourceConflicts,
  collectTextContentConflicts,
  validateJsonPresentationDocument,
  validatePresentationDocument,
  type ValidationError,
} from '@json-to-office/shared-pptx';
import type {
  PipelineWarning,
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../types';
import type { PresentationPackagingOptions } from './packagePresentation';
import type { PptxRendererId } from '../renderers/types';

export interface GenerationValidationOptions {
  /** Validate the complete component tree before rendering. Defaults to true. */
  enabled?: boolean;
  /** Accept unknown props while still enforcing required fields and types. */
  allowUnknownFields?: boolean;
}

export interface GenerationOptions extends PresentationPackagingOptions {
  customThemes?: Record<string, PptxThemeConfig>;
  /**
   * Fully resolved theme, set by the generation prologue after the
   * export-mode pre-pass. Wins over the `props.theme` name/inline lookup in
   * `processPresentation` — omit it (direct callers) to fall back to that.
   */
  theme?: PptxThemeConfig;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  validation?: GenerationValidationOptions;
  /**
   * Directory that relative asset paths (image `path` props, slide
   * background images) resolve against. Defaults to `process.cwd()` when
   * absent (#142).
   */
  baseDir?: string;
  /**
   * Backend that turns the compiled presentation into bytes.
   *
   * Defaults to `pptxgenjs`, which is what every existing caller gets.
   * `office-open` is experimental and opt-in: it declares a subset of
   * features and fails before rendering on anything outside it.
   */
  renderer?: PptxRendererId;
}

/** Result from `generateBufferWithWarnings`. */
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

export function assertValidPresentation(
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

/** Type guard for a presentation component definition. */
export function isPresentationComponentDefinition(
  definition: unknown
): definition is PresentationComponentDefinition {
  if (typeof definition !== 'object' || definition === null) return false;
  const def = definition as Record<string, unknown>;
  return def.name === 'pptx' && 'props' in def;
}

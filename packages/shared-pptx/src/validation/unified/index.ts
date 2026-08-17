/**
 * Unified validation facade for PPTX.
 *
 * Mirrors the shared-docx `validate` / `validateStrict` API surface the CLI
 * consumes, so `jto pptx validate` gets real schema validation instead of the
 * historical unconditional pass.
 */

import { Value } from '@sinclair/typebox/value';
import type { ValidationError } from '@json-to-office/shared';
import { transformValueErrors } from '@json-to-office/shared';
import { ThemeConfigSchema } from '../../schemas/theme';
import { collectImageSourceConflicts } from '../image-source-conflicts';
import { collectTextContentConflicts } from '../text-content-conflicts';
import {
  comprehensiveValidatePresentation,
  type DeepValidateOptions,
} from './deep-validator';

export {
  deepValidatePresentation,
  comprehensiveValidatePresentation,
} from './deep-validator';
export type { DeepValidateOptions } from './deep-validator';

export interface PptxValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationError[];
  documentType?: 'pptx';
  data?: unknown;
}

function parseJsonInput(jsonInput: string | object): {
  parsed?: unknown;
  error?: ValidationError;
} {
  if (typeof jsonInput !== 'string') return { parsed: jsonInput };
  try {
    return { parsed: JSON.parse(jsonInput) };
  } catch (err: any) {
    return {
      error: {
        path: 'root',
        message: `Invalid JSON: ${err?.message ?? String(err)}`,
        code: 'json_parse_error',
      },
    };
  }
}

/**
 * Validate a presentation component tree.
 *
 * The deep walk is the source of truth: it re-implements everything the
 * recursive discriminated union checks (component names, per-component props
 * schemas, container narrowing) with precise paths, so we run it directly
 * instead of the union check whose failures collapse into a generic root
 * error. Image-source mutual exclusivity is a semantic rule the structural
 * schema cannot express, so it runs unconditionally on top.
 */
export function validatePresentationDocument(
  data: unknown,
  opts: DeepValidateOptions = {}
): PptxValidationResult {
  const errors = comprehensiveValidatePresentation(data, [], opts);
  errors.push(...collectImageSourceConflicts(data));
  errors.push(...collectTextContentConflicts(data));
  const valid = errors.length === 0;
  return {
    valid,
    errors,
    documentType: 'pptx',
    data: valid ? data : undefined,
  };
}

/**
 * Validate a presentation from a JSON string or object.
 */
export function validateJsonPresentationDocument(
  jsonInput: string | object,
  opts: DeepValidateOptions = {}
): PptxValidationResult {
  const { parsed, error } = parseJsonInput(jsonInput);
  if (error) return { valid: false, errors: [error], documentType: 'pptx' };
  return validatePresentationDocument(parsed, opts);
}

/**
 * Validate a PPTX theme config.
 */
export function validatePptxTheme(data: unknown): PptxValidationResult {
  if (Value.Check(ThemeConfigSchema, data)) {
    return { valid: true, errors: [], data };
  }
  const valueErrors = [...Value.Errors(ThemeConfigSchema, data)];
  const errors = transformValueErrors(valueErrors, { maxErrors: 100 });
  return { valid: false, errors };
}

/**
 * Validate a PPTX theme from a JSON string or object.
 */
export function validateJsonPptxTheme(
  jsonInput: string | object
): PptxValidationResult {
  const { parsed, error } = parseJsonInput(jsonInput);
  if (error) return { valid: false, errors: [error] };
  return validatePptxTheme(parsed);
}

/**
 * Simple validation API — the entry point the CLI consumes.
 */
export const validate = {
  document: (data: unknown) => validatePresentationDocument(data),
  jsonDocument: (jsonInput: string | object) =>
    validateJsonPresentationDocument(jsonInput),
  theme: (data: unknown) => validatePptxTheme(data),
  jsonTheme: (jsonInput: string | object) => validateJsonPptxTheme(jsonInput),
  isDocument: (data: unknown) => validatePresentationDocument(data).valid,
  isTheme: (data: unknown) => validatePptxTheme(data).valid,
};

/**
 * Strict validation API. PPTX deep validation never cleans or applies
 * defaults, so this is currently an alias kept for docx API parity — the CLI
 * picks one of the two based on its --strict flag.
 */
export const validateStrict = {
  document: (data: unknown) => validatePresentationDocument(data),
  jsonDocument: (jsonInput: string | object) =>
    validateJsonPresentationDocument(jsonInput),
  theme: (data: unknown) => validatePptxTheme(data),
  jsonTheme: (jsonInput: string | object) => validateJsonPptxTheme(jsonInput),
};

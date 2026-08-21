/**
 * Document validation implementation
 * Single source of truth for all document validation
 */

import type { Static } from '@sinclair/typebox';
import {
  ComponentDefinitionSchema,
  StandardComponentDefinitionSchema,
} from '../../schemas/components';
import { extractStandardComponentNames } from '@json-to-office/shared';
import {
  comprehensiveValidateDocument,
  collectImageSourceConflicts,
  collectIndentConflicts,
  collectNoteRevisionConflicts,
  collectTextBoxShapeConflicts,
} from './deep-validator';

// JsonComponentDefinitionSchema is just an alias for ComponentDefinitionSchema
const JsonComponentDefinitionSchema = ComponentDefinitionSchema;
import type {
  DocumentValidationResult,
  ValidationError,
  ValidationOptions,
} from './types';
import { validateAgainstSchema, validateJson } from './base-validator';

/**
 * The semantic rules the structural schema cannot express.
 *
 * Each entry runs unconditionally over the whole document, because every one of
 * them describes a payload TypeBox already accepted: the fields involved are
 * independently optional, and only their combination is wrong.
 *
 * They live in one list because both entry points below need all of them, and a
 * collector wired into only one of the two is invisible until a document takes
 * the other path.
 */
const SEMANTIC_COLLECTORS: readonly {
  readonly why: string;
  readonly collect: (document: unknown) => ValidationError[];
}[] = [
  {
    // A multi-source image passes the structural check: each source is its own
    // optional field.
    why: 'image source mutual-exclusivity',
    collect: collectImageSourceConflicts,
  },
  {
    why: 'indent hanging/firstLine mutual-exclusivity',
    collect: collectIndentConflicts,
  },
  {
    // Tracked-change text renders literally, so a note marker inside it never
    // resolves and docx cannot express the pair anyway.
    why: 'notes on a revised paragraph',
    collect: collectNoteRevisionConflicts,
  },
  {
    // A shape has no autofit and its outline carries no dash pattern, so the
    // request could only ever come back as a table.
    why: 'a text box asking for a shape rendering a shape cannot give it',
    collect: collectTextBoxShapeConflicts,
  },
];

/**
 * Run every semantic rule over an already-resolved document — `data` for the
 * object entry point, `result.parsed` for the JSON one.
 */
function collectSemanticConflicts(document: unknown): ValidationError[] {
  return SEMANTIC_COLLECTORS.flatMap(({ collect }) => collect(document));
}

/**
 * Validate a document/report component definition
 */
export function validateDocument(
  data: unknown,
  options?: ValidationOptions
): DocumentValidationResult {
  const result = validateAgainstSchema(
    ComponentDefinitionSchema,
    data,
    options
  );

  // If validation failed, use deep validation to get all detailed errors
  let finalErrors = result.errors || [];
  let finalValid = result.valid;
  if (!result.valid && data) {
    finalErrors = comprehensiveValidateDocument(data, result.errors, {
      allowUnknownFields: options?.allowUnknownFields,
      knownCustomNames: options?.knownCustomNames,
    });
    // If TypeBox's union check produced only generic catch-all errors and the
    // deep validator finds nothing actionable, treat the document as valid.
    if (finalErrors.length === 0) {
      finalValid = true;
    }
  }

  // Semantic rules run on every document, valid or not: they describe payloads
  // the structural check already accepted.
  const semanticConflicts = collectSemanticConflicts(data);
  if (semanticConflicts.length > 0) {
    finalErrors = [...finalErrors, ...semanticConflicts];
    finalValid = false;
  }

  // Same for a text box asking for a shape rendering a shape cannot give it.
  const textBoxShapeConflicts = collectTextBoxShapeConflicts(data);
  if (textBoxShapeConflicts.length > 0) {
    finalErrors = [...finalErrors, ...textBoxShapeConflicts];
    finalValid = false;
  }

  // Add document-specific metadata. Keep `data` populated whenever `valid` is
  // true so `isValidDocument()` (which requires both) stays consistent — when
  // TypeBox failed and the deep validator cleared the doc, fall back to the
  // original input as the data payload.
  const resolvedData =
    result.data ??
    (finalValid
      ? (data as Static<typeof ComponentDefinitionSchema>)
      : undefined);
  const documentResult: DocumentValidationResult = {
    ...result,
    valid: finalValid,
    documentType: 'docx',
    errors: finalErrors,
    data: resolvedData,
  };

  // Check if document has custom components
  if (finalValid) {
    const doc = resolvedData as any;
    if (doc && doc.children && Array.isArray(doc.children)) {
      const hasCustom = doc.children.some(
        (c: any) => !isStandardComponentName(c.name)
      );
      documentResult.hasCustomComponents = hasCustom;
    }
  }

  return documentResult;
}

/**
 * Validate a JSON document (string or object)
 */
export function validateJsonDocument(
  jsonInput: string | object,
  options?: ValidationOptions
): DocumentValidationResult {
  // Use the JSON-specific schema which includes the $schema field
  const result = validateJson(
    JsonComponentDefinitionSchema,
    jsonInput,
    options
  );

  // If validation failed, use deep validation to get all detailed errors
  let finalErrors = result.errors || [];
  let finalValid = result.valid;
  if (!result.valid && result.parsed) {
    finalErrors = comprehensiveValidateDocument(result.parsed, result.errors, {
      allowUnknownFields: options?.allowUnknownFields,
      knownCustomNames: options?.knownCustomNames,
    });
    if (finalErrors.length === 0) {
      finalValid = true;
    }
  }

  // Semantic rules run on every document, valid or not: they describe payloads
  // the structural check already accepted.
  const semanticConflicts = collectSemanticConflicts(result.parsed);
  if (semanticConflicts.length > 0) {
    finalErrors = [...finalErrors, ...semanticConflicts];
    finalValid = false;
  }

  // A text box asking for a shape rendering a shape cannot give it (see
  // validateDocument).
  const textBoxShapeConflicts = collectTextBoxShapeConflicts(result.parsed);
  if (textBoxShapeConflicts.length > 0) {
    finalErrors = [...finalErrors, ...textBoxShapeConflicts];
    finalValid = false;
  }

  // Add document-specific metadata. Keep `data` populated whenever `valid` is
  // true so `isValidDocument()` (which requires both) stays consistent — when
  // TypeBox failed and the deep validator cleared the doc, fall back to the
  // parsed input as the data payload.
  const resolvedData =
    result.data ??
    (finalValid
      ? (result.parsed as Static<typeof ComponentDefinitionSchema>)
      : undefined);
  const documentResult: DocumentValidationResult = {
    ...result,
    valid: finalValid,
    documentType: 'docx',
    errors: finalErrors,
    data: resolvedData,
  };

  // Check for custom components
  if (finalValid) {
    const doc = resolvedData as any;
    if (doc && doc.children && Array.isArray(doc.children)) {
      const hasCustom = doc.children.some(
        (c: any) => !isStandardComponentName(c.name)
      );
      documentResult.hasCustomComponents = hasCustom;
    }
  }

  return documentResult;
}

/**
 * Type guard for document validation result
 */
export function isValidDocument(
  result: DocumentValidationResult
): result is DocumentValidationResult & {
  valid: true;
  data: Static<typeof ComponentDefinitionSchema>;
} {
  return result.valid === true && result.data !== undefined;
}

/**
 * Extract standard component names from the schema (cached)
 */
function getStandardComponentNames(): string[] {
  return extractStandardComponentNames(StandardComponentDefinitionSchema);
}

/**
 * Check if a component name is standard
 */
function isStandardComponentName(name: string): boolean {
  const standardNames = getStandardComponentNames();
  return standardNames.includes(name);
}

/**
 * Create a document validator with default options
 */
export function createDocumentValidator(defaultOptions?: ValidationOptions) {
  return {
    validate: (data: unknown, options?: ValidationOptions) =>
      validateDocument(data, { ...defaultOptions, ...options }),
    validateJson: (jsonInput: string | object, options?: ValidationOptions) =>
      validateJsonDocument(jsonInput, { ...defaultOptions, ...options }),
  };
}

// Export convenient validators with common configurations
export const documentValidator = createDocumentValidator({
  clean: true,
  applyDefaults: true,
  maxErrors: 100, // Collect up to 100 errors to show all validation issues
});

export const strictDocumentValidator = createDocumentValidator({
  clean: false,
  applyDefaults: false,
  maxErrors: 100, // Increased from 10 to show more errors
});

/**
 * Legacy compatibility exports
 */
export const validateJsonComponent = validateJsonDocument;
export const validateDocumentWithSchema = validateDocument;

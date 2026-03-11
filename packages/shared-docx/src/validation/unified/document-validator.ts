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
import { comprehensiveValidateDocument } from './deep-validator';

// JsonComponentDefinitionSchema is just an alias for ComponentDefinitionSchema
const JsonComponentDefinitionSchema = ComponentDefinitionSchema;
import type { DocumentValidationResult, ValidationOptions } from './types';
import { validateAgainstSchema, validateJson } from './base-validator';

/**
 * Validate a document/report component definition
 */
export function validateDocument(
  data: unknown,
  options?: ValidationOptions
): DocumentValidationResult {
  const result = validateAgainstSchema(ComponentDefinitionSchema, data, options);

  // If validation failed, use deep validation to get all detailed errors
  let finalErrors = result.errors || [];
  if (!result.valid && data) {
    finalErrors = comprehensiveValidateDocument(data, result.errors);
  }

  // Add document-specific metadata
  const documentResult: DocumentValidationResult = {
    ...result,
    documentType: 'docx',
    errors: finalErrors, // Use the comprehensive errors
  };

  // Check if document has custom components
  if (result.valid && result.data) {
    const doc = result.data as any;
    if (doc.children && Array.isArray(doc.children)) {
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
  const result = validateJson(JsonComponentDefinitionSchema, jsonInput, options);

  // If validation failed, use deep validation to get all detailed errors
  let finalErrors = result.errors || [];
  if (!result.valid && result.parsed) {
    finalErrors = comprehensiveValidateDocument(result.parsed, result.errors);
  }

  // Add document-specific metadata
  const documentResult: DocumentValidationResult = {
    ...result,
    documentType: 'docx',
    errors: finalErrors, // Use the comprehensive errors
  };

  // Check for custom components
  if (result.valid && result.data) {
    const doc = result.data as any;
    if (doc.children && Array.isArray(doc.children)) {
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

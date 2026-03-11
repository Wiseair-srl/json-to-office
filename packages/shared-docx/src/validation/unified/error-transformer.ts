/**
 * Unified error transformation utilities
 * Converts TypeBox ValueError objects to standardized ValidationError format
 */

import type { ValueError } from '@sinclair/typebox/value';
import type { ValidationError } from '@json-to-office/shared';
import { ReportPropsSchema } from '../../schemas/components/report';
import {
  isObjectSchema,
  getObjectSchemaPropertyNames,
  getLiteralValue,
  type ErrorFormatterConfig,
  createErrorConfig,
  formatErrorMessage,
  ERROR_EMOJIS,
} from '@json-to-office/shared';

/**
 * Generate enhanced error message based on error type and context
 */
function generateEnhancedMessage(
  error: ValueError,
  _config: Required<ErrorFormatterConfig>
): string {
  const typeStr = String(error.type || '');
  const path = error.path || 'root';

  // Handle union errors specially - these are the most common and least helpful
  if (typeStr === '62' || typeStr === 'union') {
    return generateUnionErrorMessage(error);
  }

  // Handle additional properties error
  if (error.message?.includes('additionalProperties')) {
    return generateAdditionalPropertiesMessage(error);
  }

  // Handle missing required properties
  if (error.message?.includes('Required property')) {
    return generateRequiredPropertyMessage(error);
  }

  // Handle type mismatches
  if (
    typeStr === 'string' ||
    typeStr === 'number' ||
    typeStr === 'boolean' ||
    typeStr === 'array' ||
    typeStr === 'object'
  ) {
    return generateTypeMismatchMessage(error);
  }

  // Handle literal value errors
  if (typeStr === 'literal') {
    return generateLiteralErrorMessage(error);
  }

  // Handle pattern/regex errors
  if (typeStr === 'pattern' || typeStr === 'RegExp') {
    return generatePatternErrorMessage(error);
  }

  // Default to original message with some context
  return `At ${path}: ${error.message}`;
}

/**
 * Generate message for union validation errors
 */
function generateUnionErrorMessage(error: ValueError): string {
  const path = error.path || 'root';
  const value = error.value;

  // Try to determine what the user was attempting
  if (path === 'root' || path === '/' || path === '/jsonDefinition') {
    // Root level or jsonDefinition union error - likely a document type issue
    if (value && typeof value === 'object') {
      if ('name' in value) {
        const name = value.name;
        if (name === 'docx') {
          return 'Document structure appears valid but contains invalid component configurations. Check each component for errors.';
        }
        return `Unknown document name '${name}'. Expected 'docx'.`;
      }

      // Missing name field
      const valueAny = value as Record<string, unknown>;
      if ('children' in value && Array.isArray(valueAny.children)) {
        return 'Document is missing required \'name\' field. Add "name": "docx" at the root level.';
      }

      // Check if it might be a theme
      if ('name' in value || 'styles' in value) {
        return 'This appears to be a theme configuration. Use --type theme or ensure proper document structure.';
      }
    }
    return 'Invalid document structure. Expected a document with name="docx" or a theme configuration.';
  }

  // Component-level union error
  if (path.includes('/children/')) {
    if (value && typeof value === 'object' && 'name' in value) {
      const componentType = (value as any).name;
      return `Invalid component configuration for type '${componentType}'. Check that all required fields are present and correctly formatted.`;
    }
    return 'Invalid component structure. Each component must have a "name" field and valid configuration.';
  }

  // Default union error message
  return `Value at ${path} doesn't match any of the expected formats. Check the structure and required fields.`;
}

/**
 * Generate message for additional properties errors
 */
function generateAdditionalPropertiesMessage(error: ValueError): string {
  const path = error.path || 'root';
  const value = error.value;

  if (typeof value === 'object' && value !== null) {
    // Try to identify the unknown properties
    const schema = error.schema;
    if (schema && isObjectSchema(schema)) {
      const knownProps = getObjectSchemaPropertyNames(schema);
      const actualProps = Object.keys(value);
      const unknownProps = actualProps.filter((p) => !knownProps.includes(p));

      if (unknownProps.length > 0) {
        return (
          `Unknown properties at ${path}: ${unknownProps.join(', ')}. ` +
          `Allowed properties are: ${knownProps.join(', ')}`
        );
      }
    }
  }

  return `Additional properties not allowed at ${path}. Check for typos or unsupported fields.`;
}

/**
 * Generate message for required property errors
 */
function generateRequiredPropertyMessage(error: ValueError): string {
  const path = error.path || 'root';
  const match = error.message?.match(/Required property '([^']+)'/);

  if (match) {
    const propName = match[1];
    return `Missing required field '${propName}' at ${path}. This field is mandatory for this configuration.`;
  }

  return `Missing required property at ${path}. Check that all mandatory fields are present.`;
}

/**
 * Generate message for type mismatch errors
 */
function generateTypeMismatchMessage(error: ValueError): string {
  const path = error.path || 'root';
  const expectedType = String(error.type);
  const actualType = Array.isArray(error.value) ? 'array' : typeof error.value;

  // Provide context-specific messages
  if (path.includes('alignment')) {
    return `Invalid alignment value at ${path}. Expected one of: left, center, right, justify`;
  }

  if (path.includes('color')) {
    return `Invalid color value at ${path}. Use hex format (#RRGGBB), rgb(r,g,b), or a named color`;
  }

  if (path.includes('fontSize') || path.includes('size')) {
    return `Invalid size value at ${path}. Expected a number (in points)`;
  }

  if (
    path.includes('margin') ||
    path.includes('padding') ||
    path.includes('spacing')
  ) {
    return `Invalid spacing value at ${path}. Expected a number or spacing object with top/bottom/left/right`;
  }

  return `Type mismatch at ${path}: Expected ${expectedType} but got ${actualType}`;
}

/**
 * Generate message for literal value errors
 */
function generateLiteralErrorMessage(error: ValueError): string {
  const path = error.path || 'root';
  const expected = error.schema
    ? JSON.stringify(getLiteralValue(error.schema))
    : 'specific value';
  const actual = JSON.stringify(error.value);

  return `Invalid value at ${path}: Expected exactly ${expected} but got ${actual}`;
}

/**
 * Generate message for pattern/regex errors
 */
function generatePatternErrorMessage(error: ValueError): string {
  const path = error.path || 'root';

  // Try to provide helpful context based on the path
  if (path.includes('email')) {
    return `Invalid email format at ${path}. Use format: user@example.com`;
  }

  if (path.includes('url') || path.includes('link')) {
    return `Invalid URL format at ${path}. Use format: https://example.com`;
  }

  if (path.includes('date')) {
    return `Invalid date format at ${path}. Use ISO format: YYYY-MM-DD`;
  }

  if (path.includes('phone')) {
    return `Invalid phone number format at ${path}`;
  }

  return `Value at ${path} doesn't match the required pattern`;
}

/**
 * Transform TypeBox ValueError to standardized ValidationError
 */
export function transformValueError(
  error: ValueError,
  jsonString?: string,
  config?: ErrorFormatterConfig
): ValidationError {
  const formatterConfig = createErrorConfig(config);

  // Generate enhanced message based on error type
  const enhancedMessage = generateEnhancedMessage(error, formatterConfig);

  const baseError: ValidationError = {
    path: error.path || 'root',
    message: formatErrorMessage(
      enhancedMessage || error.message,
      formatterConfig
    ),
    code: String(error.type || 'validation_error'),
    value: error.value,
  };

  // Add suggestion if available and configured
  if (formatterConfig.includeSuggestions) {
    const suggestion = getSuggestion(error, formatterConfig);
    if (suggestion) {
      baseError.suggestion = formatErrorMessage(suggestion, formatterConfig);
    }
  }

  // Calculate line and column if JSON string is provided
  if (jsonString && error.path) {
    const position = calculatePosition(jsonString, error.path);
    if (position) {
      baseError.line = position.line;
      baseError.column = position.column;
    }
  }

  return baseError;
}

/**
 * Transform multiple TypeBox errors to ValidationError array
 * Enhanced to collect ALL errors, not just stopping at union failures
 */
export function transformValueErrors(
  errors: ValueError[],
  options?: {
    jsonString?: string;
    maxErrors?: number;
  }
): ValidationError[] {
  const maxErrors = options?.maxErrors ?? Number.MAX_SAFE_INTEGER;
  const result: ValidationError[] = [];
  const seenPaths = new Set<string>();

  // Collect all errors, but avoid duplicates at the same path
  for (const error of errors) {
    if (result.length >= maxErrors) break;

    // Create a unique key for this error based on path and type
    const errorKey = `${error.path}:${error.type}`;

    // Skip if we've already seen an error at this exact path and type
    // This helps avoid duplicate union errors while still showing all unique issues
    if (!seenPaths.has(errorKey)) {
      seenPaths.add(errorKey);
      result.push(transformValueError(error, options?.jsonString, undefined));
    }
  }

  return result;
}

/**
 * Calculate line and column position in JSON string
 */
export function calculatePosition(
  jsonString: string,
  path: string
): { line: number; column: number } | null {
  try {
    // Convert path like "/children/0/props/title" to searchable parts
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length === 0) {
      return { line: 1, column: 1 };
    }

    // Try to find the last part of the path in the JSON
    const lastPart = pathParts[pathParts.length - 1];
    const searchPattern = `"${lastPart}"`;
    const index = jsonString.indexOf(searchPattern);

    if (index === -1) {
      // Try to find just the value if it's a property name
      return { line: 1, column: 1 };
    }

    // Calculate line and column from index
    const beforeError = jsonString.substring(0, index);
    const lines = beforeError.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;

    return { line, column };
  } catch {
    return null;
  }
}

/**
 * Get helpful suggestion based on error type and context
 */
function getSuggestion(
  error: ValueError,
  config: Required<ErrorFormatterConfig>
): string | undefined {
  const { type, path, value } = error;
  const typeStr = String(type);

  // Enhanced suggestions for union errors
  if (typeStr === '62' || typeStr === 'union') {
    if (path === 'root' || path === '/') {
      if (value && typeof value === 'object') {
        if (!('name' in value)) {
          const msg = 'Add a "name" field with value "docx" for documents';
          return config.includeEmojis ? `${ERROR_EMOJIS.FIX} ${msg}` : msg;
        }
        if ('props' in value && typeof value.props === 'object') {
          const knownFields = getObjectSchemaPropertyNames(ReportPropsSchema);
          return `Review the props section for unsupported fields. Allowed fields: ${knownFields.join(', ')}`;
        }
      }
      return 'Ensure the document has proper structure: { "name": "docx", "props": {...}, "children": [...] }';
    }
    if (path?.includes('/children/')) {
      return 'Check that the component has a valid "name" and all required fields for that component type';
    }
    return 'Review the structure and ensure all required fields are present with correct types';
  }

  // Suggestions for additional properties errors
  if (error.message?.includes('additionalProperties')) {
    return 'Remove any unknown or unsupported fields. Check documentation for allowed properties.';
  }

  // Suggestions for required properties
  if (error.message?.includes('Required property')) {
    return 'Add the missing required field to fix this error';
  }

  // Type-specific suggestions
  if (typeStr === 'string') {
    if (path?.includes('alignment')) {
      return 'Use one of: left, center, right, justify';
    }
    if (path?.includes('color')) {
      return 'Use a valid color format (hex: #RRGGBB, rgb: rgb(r,g,b), or named color)';
    }
    return 'Provide a text string value';
  }

  if (typeStr === 'number') {
    if (path?.includes('fontSize') || path?.includes('size')) {
      return 'Use a number in points (e.g., 12, 14, 16)';
    }
    if (path?.includes('margin') || path?.includes('padding')) {
      return 'Use a number for spacing in points';
    }
    return 'Provide a numeric value';
  }

  if (typeStr === 'boolean') {
    return 'Use true or false (without quotes)';
  }

  if (typeStr === 'array') {
    if (path?.includes('children') || path?.includes('modules')) {
      return 'Provide an array of component objects, each with a "name" field';
    }
    return 'Provide an array/list of values using square brackets []';
  }

  if (typeStr === 'object') {
    return 'Provide an object with key-value pairs using curly braces {}';
  }

  if (typeStr === 'literal') {
    const expected = error.schema
      ? JSON.stringify(getLiteralValue(error.schema))
      : 'specific value';
    return `Use exactly this value: ${expected}`;
  }

  if (typeStr === 'pattern' || typeStr === 'RegExp') {
    if (path?.includes('email')) {
      return 'Use valid email format: user@example.com';
    }
    if (path?.includes('url')) {
      return 'Use valid URL format: https://example.com';
    }
    if (path?.includes('date')) {
      return 'Use ISO date format: YYYY-MM-DD';
    }
    return 'Ensure the value matches the required format';
  }

  // Path-based suggestions
  if (path?.includes('name') || path?.includes('type')) {
    return 'Use a valid component name: docx, section, columns, heading, paragraph, image, statistic, table, header, footer, list, toc, text-box, or highcharts';
  }

  return undefined;
}

/**
 * Format validation errors as a summary string
 */
export function formatErrorSummary(errors: ValidationError[]): string {
  if (errors.length === 0) return 'No errors';

  if (errors.length === 1) {
    return errors[0].message;
  }

  const summary = errors
    .slice(0, 3)
    .map((e) => `${e.path}: ${e.message}`)
    .join(', ');

  if (errors.length > 3) {
    return `${summary} and ${errors.length - 3} more...`;
  }

  return summary;
}

/**
 * Group errors by path for better reporting
 */
export function groupErrorsByPath(
  errors: ValidationError[]
): Map<string, ValidationError[]> {
  const grouped = new Map<string, ValidationError[]>();

  for (const error of errors) {
    const path = error.path || 'root';
    const group = grouped.get(path) || [];
    group.push(error);
    grouped.set(path, group);
  }

  return grouped;
}

/**
 * Create a JSON parse error
 */
export function createJsonParseError(
  error: Error,
  jsonString: string
): ValidationError {
  // Try to extract position from error message
  const match = error.message.match(/position (\d+)/);
  const position = match ? parseInt(match[1], 10) : 0;

  let line = 1;
  let column = 1;

  if (position > 0) {
    const lines = jsonString.substring(0, position).split('\n');
    line = lines.length;
    column = lines[lines.length - 1].length + 1;
  }

  return {
    path: 'root',
    message: `JSON Parse Error: ${error.message}`,
    code: 'json_parse_error',
    line,
    column,
    suggestion: 'Check for missing commas, quotes, or brackets',
  };
}

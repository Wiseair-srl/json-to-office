import type { ValueError } from '@sinclair/typebox/value';
import type { ValidationError } from './types';
import {
  isObjectSchema,
  getObjectSchemaPropertyNames,
  getLiteralValue,
} from './schema-utils';
import {
  ErrorFormatterConfig,
  createErrorConfig,
  formatErrorMessage,
} from './error-formatter-config';

export type { TransformedError } from './types';

function generateEnhancedMessage(
  error: ValueError,
  _config: Required<ErrorFormatterConfig>
): string {
  const typeStr = String(error.type || '');
  const path = error.path || 'root';

  if (typeStr === '62' || typeStr === 'union') {
    return generateUnionErrorMessage(error);
  }

  if (error.message?.includes('additionalProperties')) {
    return generateAdditionalPropertiesMessage(error);
  }

  if (error.message?.includes('Required property')) {
    return generateRequiredPropertyMessage(error);
  }

  if (
    typeStr === 'string' ||
    typeStr === 'number' ||
    typeStr === 'boolean' ||
    typeStr === 'array' ||
    typeStr === 'object'
  ) {
    return generateTypeMismatchMessage(error);
  }

  if (typeStr === 'literal') {
    return generateLiteralErrorMessage(error);
  }

  if (typeStr === 'pattern' || typeStr === 'RegExp') {
    return generatePatternErrorMessage(error);
  }

  return `At ${path}: ${error.message}`;
}

function generateUnionErrorMessage(error: ValueError): string {
  const path = error.path || 'root';
  const value = error.value;

  if (path === 'root' || path === '/' || path === '/jsonDefinition') {
    if (value && typeof value === 'object') {
      if ('name' in value) {
        return `Invalid component configuration for '${(value as any).name}'. Check that all required fields are present.`;
      }
      if ('children' in value && Array.isArray((value as any).children)) {
        return 'Document is missing required \'name\' field.';
      }
    }
    return 'Invalid document structure. Check required fields.';
  }

  if (path.includes('/children/')) {
    if (value && typeof value === 'object' && 'name' in value) {
      const componentType = (value as any).name;
      return `Invalid component configuration for type '${componentType}'. Check that all required fields are present and correctly formatted.`;
    }
    return 'Invalid component structure. Each component must have a "name" field and valid configuration.';
  }

  return `Value at ${path} doesn't match any of the expected formats. Check the structure and required fields.`;
}

function generateAdditionalPropertiesMessage(error: ValueError): string {
  const path = error.path || 'root';
  const value = error.value;

  if (typeof value === 'object' && value !== null) {
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

function generateRequiredPropertyMessage(error: ValueError): string {
  const path = error.path || 'root';
  const match = error.message?.match(/Required property '([^']+)'/);

  if (match) {
    const propName = match[1];
    return `Missing required field '${propName}' at ${path}. This field is mandatory.`;
  }

  return `Missing required property at ${path}. Check that all mandatory fields are present.`;
}

function generateTypeMismatchMessage(error: ValueError): string {
  const path = error.path || 'root';
  const expectedType = String(error.type);
  const actualType = Array.isArray(error.value) ? 'array' : typeof error.value;

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

function generateLiteralErrorMessage(error: ValueError): string {
  const path = error.path || 'root';
  const expected = error.schema
    ? JSON.stringify(getLiteralValue(error.schema))
    : 'specific value';
  const actual = JSON.stringify(error.value);

  return `Invalid value at ${path}: Expected exactly ${expected} but got ${actual}`;
}

function generatePatternErrorMessage(error: ValueError): string {
  const path = error.path || 'root';

  if (path.includes('email')) {
    return `Invalid email format at ${path}. Use format: user@example.com`;
  }
  if (path.includes('url') || path.includes('link')) {
    return `Invalid URL format at ${path}. Use format: https://example.com`;
  }
  if (path.includes('date')) {
    return `Invalid date format at ${path}. Use ISO format: YYYY-MM-DD`;
  }

  return `Value at ${path} doesn't match the required pattern`;
}

export function transformValueError(
  error: ValueError,
  jsonString?: string,
  config?: ErrorFormatterConfig
): ValidationError {
  const formatterConfig = createErrorConfig(config);

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

  if (formatterConfig.includeSuggestions) {
    const suggestion = getSuggestion(error, formatterConfig);
    if (suggestion) {
      baseError.suggestion = formatErrorMessage(suggestion, formatterConfig);
    }
  }

  if (jsonString && error.path) {
    const position = calculatePosition(jsonString, error.path);
    if (position) {
      baseError.line = position.line;
      baseError.column = position.column;
    }
  }

  return baseError;
}

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

  for (const error of errors) {
    if (result.length >= maxErrors) break;

    const errorKey = `${error.path}:${error.type}`;

    if (!seenPaths.has(errorKey)) {
      seenPaths.add(errorKey);
      result.push(transformValueError(error, options?.jsonString, undefined));
    }
  }

  return result;
}

export function calculatePosition(
  jsonString: string,
  path: string
): { line: number; column: number } | null {
  try {
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length === 0) {
      return { line: 1, column: 1 };
    }

    const lastPart = pathParts[pathParts.length - 1];
    const searchPattern = `"${lastPart}"`;
    const index = jsonString.indexOf(searchPattern);

    if (index === -1) {
      return { line: 1, column: 1 };
    }

    const beforeError = jsonString.substring(0, index);
    const lines = beforeError.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;

    return { line, column };
  } catch {
    return null;
  }
}

function getSuggestion(
  error: ValueError,
  _config: Required<ErrorFormatterConfig>
): string | undefined {
  const { type, path } = error;
  const typeStr = String(type);

  if (typeStr === '62' || typeStr === 'union') {
    if (path === 'root' || path === '/') {
      return 'Ensure the document has proper structure with a root "name" field';
    }
    if (path?.includes('/children/')) {
      return 'Check that the component has a valid "name" and all required fields';
    }
    return 'Review the structure and ensure all required fields are present with correct types';
  }

  if (error.message?.includes('additionalProperties')) {
    return 'Remove any unknown or unsupported fields.';
  }

  if (error.message?.includes('Required property')) {
    return 'Add the missing required field to fix this error';
  }

  if (typeStr === 'string') {
    if (path?.includes('color')) {
      return 'Use a valid color format (hex: #RRGGBB, rgb: rgb(r,g,b), or named color)';
    }
    return 'Provide a text string value';
  }

  if (typeStr === 'number') {
    return 'Provide a numeric value';
  }

  if (typeStr === 'boolean') {
    return 'Use true or false (without quotes)';
  }

  if (typeStr === 'array') {
    return 'Provide an array of values using square brackets []';
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

  return undefined;
}

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

export function createJsonParseError(
  error: Error,
  jsonString: string
): ValidationError {
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

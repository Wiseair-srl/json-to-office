import { Value, ValueError } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';
import {
  DocumentValidationResult,
  ValidationError,
} from '../../schemas/document';
import {
  ComponentDefinitionSchema,
  ComponentDefinition,
} from '../../schemas/components';

// Register format validators with TypeBox
FormatRegistry.Set('uri', (value: string) => {
  // Accept URLs, relative paths, and file paths
  try {
    new URL(value);
    return true;
  } catch {
    // Check if it's a relative path (common for JSON schemas)
    if (
      value.includes('.json') ||
      value.includes('/') ||
      value.includes('\\')
    ) {
      return true;
    }
    // Check if it's an HTTP/HTTPS URL
    return /^https?:\/\/.+/.test(value);
  }
});

FormatRegistry.Set('date-time', (value: string) => {
  // ISO 8601 date-time format validation
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
  return dateTimeRegex.test(value) && !isNaN(Date.parse(value));
});

/**
 * JSON parser
 * @module validation/parsers/json
 * @description
 * Advanced JSON parsing with line number tracking and detailed error reporting.
 * Provides enhanced error messages for JSON syntax and validation errors.
 */

/**
 * JSON Document Parser - Handles parsing and validation of JSON report definitions
 */
export class JsonDocumentParser {
  private schema = ComponentDefinitionSchema;

  constructor() {
    // Schema is assigned above
  }

  /**
   * Parse JSON input (string or object) and validate against schema
   * Only supports unified ComponentDefinition structure where document IS a report component
   */
  public parse(jsonInput: string | object): ComponentDefinition {
    let parsedObject: unknown;

    // Step 1: Parse JSON if it's a string
    if (typeof jsonInput === 'string') {
      try {
        parsedObject = JSON.parse(jsonInput);
      } catch (error) {
        throw new JsonParsingError(
          'Invalid JSON syntax',
          this.extractJSONSyntaxError(error as Error, jsonInput)
        );
      }
    } else {
      parsedObject = jsonInput;
    }

    // Step 2: Validate it's a report component
    if (
      typeof parsedObject !== 'object' ||
      parsedObject === null ||
      !('name' in parsedObject) ||
      (parsedObject as any).name !== 'report'
    ) {
      throw new JsonValidationError(
        'Invalid document structure: Document must be a report component with name="report"',
        [
          {
            path: 'name',
            message: 'Document must be a report component with name="report"',
            code: 'INVALID_STRUCTURE',
          },
        ]
      );
    }

    // Step 3: Validate against schema
    if (!Value.Check(this.schema, parsedObject)) {
      const errors = [...Value.Errors(this.schema, parsedObject)];

      throw new JsonValidationError(
        'JSON validation failed',
        this.formatTypeBoxErrors(
          errors,
          typeof jsonInput === 'string'
            ? jsonInput
            : JSON.stringify(jsonInput, null, 2)
        )
      );
    }

    return parsedObject as ComponentDefinition;
  }

  /**
   * Validate JSON without throwing errors - returns ValidationResult
   */
  public validate(jsonInput: string | object): DocumentValidationResult {
    try {
      this.parse(jsonInput);
      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    } catch (error) {
      if (
        error instanceof JsonParsingError ||
        error instanceof JsonValidationError
      ) {
        return {
          valid: false,
          errors: error.validationErrors,
          warnings: [],
        };
      }

      // Unexpected error
      return {
        valid: false,
        errors: [
          {
            path: '',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown validation error',
            code: 'UNEXPECTED_ERROR',
          },
        ],
        warnings: [],
      };
    }
  }

  /**
   * Parse JSON file content with line number tracking
   */
  public parseWithLineNumbers(jsonString: string): ComponentDefinition {
    const lines = jsonString.split('\n');

    try {
      return this.parse(jsonString);
    } catch (error) {
      if (
        error instanceof JsonParsingError ||
        error instanceof JsonValidationError
      ) {
        // Enhance errors with line numbers
        const enhancedErrors = error.validationErrors.map((err) => ({
          ...err,
          ...this.findLineNumber(err.path, jsonString, lines),
        }));

        if (error instanceof JsonParsingError) {
          throw new JsonParsingError(error.message, enhancedErrors);
        } else {
          throw new JsonValidationError(error.message, enhancedErrors);
        }
      }
      throw error;
    }
  }

  /**
   * Extract JSON syntax error information
   */
  private extractJSONSyntaxError(
    error: Error,
    jsonString: string
  ): ValidationError[] {
    const message = error.message;

    // Try to extract position from error message
    const positionMatch =
      message.match(/position\s+(\d+)/i) ||
      message.match(/at\s+(\d+)/i) ||
      message.match(/character\s+(\d+)/i);

    let line = 0;
    let column = 0;

    if (positionMatch) {
      const position = parseInt(positionMatch[1], 10);
      const lines = jsonString.substring(0, position).split('\n');
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    }

    return [
      {
        path: '',
        message: `JSON syntax error: ${message}`,
        code: 'JSON_SYNTAX_ERROR',
        line: line || undefined,
        column: column || undefined,
        suggestions: [
          'Check for missing commas, brackets, or quotes',
          'Validate JSON syntax using a JSON validator',
          'Ensure all strings are properly quoted',
        ],
      },
    ];
  }

  /**
   * Format TypeBox validation errors into ValidationError format
   */
  private formatTypeBoxErrors(
    errors: ValueError[],
    originalJson: string
  ): ValidationError[] {
    return errors.map((error) => {
      const path = error.path || '';
      const lineInfo = this.findLineNumber(path, originalJson);

      return {
        path,
        message: this.formatTypeBoxErrorMessage(error),
        code: this.getErrorCode(error),
        line: lineInfo.line,
        column: lineInfo.column,
        suggestions: this.generateSuggestions(error),
      };
    });
  }

  /**
   * Format individual TypeBox error message
   */
  private formatTypeBoxErrorMessage(error: ValueError): string {
    const path = error.path ? `at "${error.path}"` : '';
    const message = error.message;

    // TypeBox provides descriptive messages, so we can use them directly
    // but enhance common patterns
    if (message.includes('Expected')) {
      return `${message} ${path}`;
    } else if (message.includes('Required property')) {
      return `${message} ${path}`;
    } else if (message.includes('Unexpected property')) {
      return `${message} ${path}`;
    } else if (message.includes('minimum')) {
      return `Value is too small ${path}. ${message}`;
    } else if (message.includes('maximum')) {
      return `Value is too big ${path}. ${message}`;
    } else {
      return `${message} ${path}`;
    }
  }

  /**
   * Get error code from TypeBox error
   */
  private getErrorCode(error: ValueError): string {
    const baseCode = String(error.type || 'VALIDATION_ERROR').toUpperCase();
    const path = error.path ? error.path.replace(/\//g, '_').toUpperCase() : '';
    return path ? `${baseCode}_${path}` : baseCode;
  }

  /**
   * Generate helpful suggestions based on error type
   */
  private generateSuggestions(error: ValueError): string[] {
    const suggestions: string[] = [];
    const message = error.message;

    // Parse TypeBox error messages to provide suggestions
    if (message.includes('Expected string')) {
      suggestions.push('Ensure the value is wrapped in quotes');
    } else if (message.includes('Expected number')) {
      suggestions.push('Remove quotes around numeric values');
    } else if (message.includes('Expected array')) {
      suggestions.push('Use square brackets [] for arrays');
    } else if (message.includes('Expected object')) {
      suggestions.push('Use curly braces {} for objects');
    } else if (message.includes('Expected literal')) {
      const match = message.match(/Expected literal (.+)/);
      if (match) {
        suggestions.push(`Use the exact value: ${match[1]}`);
      }
    } else if (message.includes('Unexpected property')) {
      suggestions.push('Remove unknown properties or check spelling');
      suggestions.push(
        'Refer to the JSON schema documentation for valid properties'
      );
    } else if (message.includes('Expected union')) {
      suggestions.push(
        'Check that the value matches one of the allowed formats'
      );
      suggestions.push('Verify the module type is spelled correctly');
    } else if (message.includes('minimum')) {
      const match = message.match(/minimum.*?(\d+)/);
      if (match) {
        if (message.includes('Array')) {
          suggestions.push(`Array must have at least ${match[1]} items`);
        } else {
          suggestions.push(`Value must be at least ${match[1]}`);
        }
      }
    } else if (message.includes('format') && message.includes('uri')) {
      suggestions.push(
        'Ensure the URL is valid and starts with http:// or https://'
      );
    }

    // Generic suggestions
    if (suggestions.length === 0) {
      suggestions.push('Check the JSON schema documentation for valid values');
      suggestions.push('Verify the property name and value format');
    }

    return suggestions;
  }

  /**
   * Find line and column number for a given JSON path
   */
  private findLineNumber(
    path: string,
    jsonString: string,
    lines?: string[]
  ): { line?: number; column?: number } {
    if (!path) {
      return {};
    }

    const jsonLines = lines || jsonString.split('\n');
    const pathParts = path.split('.');

    // Simple heuristic: find the line containing the property name
    for (let i = 0; i < jsonLines.length; i++) {
      const line = jsonLines[i];
      const lastPathPart = pathParts[pathParts.length - 1];

      // Look for property name in quotes
      if (line.includes(`"${lastPathPart}"`)) {
        const column = line.indexOf(`"${lastPathPart}"`) + 1;
        return {
          line: i + 1,
          column,
        };
      }
    }

    return {};
  }
}

/**
 * Custom error classes for better error handling
 */
export class JsonParsingError extends Error {
  public readonly validationErrors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'JsonParsingError';
    this.validationErrors = errors;
  }
}

export class JsonValidationError extends Error {
  public readonly validationErrors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'JsonValidationError';
    this.validationErrors = errors;
  }
}

/**
 * Utility functions for external use
 */

/**
 * Parse and validate JSON component definition
 * Only supports report components (documents)
 */
export function parseJsonComponent(
  jsonInput: string | object
): ComponentDefinition {
  const parser = new JsonDocumentParser();
  return parser.parse(jsonInput);
}

/**
 * Validate JSON component definition without throwing
 * Now uses unified validation
 */
export { validateJsonDocument as validateJsonComponent } from '../unified/document-validator';

/**
 * Parse JSON with enhanced line number error reporting
 * Only supports unified ComponentDefinition structure where document IS a report component
 */
export function parseJsonWithLineNumbers(
  jsonString: string
): ComponentDefinition {
  const parser = new JsonDocumentParser();
  return parser.parseWithLineNumbers(jsonString);
}

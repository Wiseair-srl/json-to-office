import type { TSchema } from '@sinclair/typebox';
import type { CustomComponent } from './createComponent';
import type { ReportComponentDefinition } from '../types';
import { resolveComponentVersion } from './version-resolver';
import {
  validateCustomComponentProps,
  validateDocument as validateDocumentUnified,
  type ValidationError,
  type ValidationResult,
} from '@json-to-office/shared-docx/validation/unified';

/**
 * Error thrown when attempting to register a component with a duplicate name
 */
export class DuplicateComponentError extends Error {
  public readonly componentName: string;
  public readonly code = 'DUPLICATE_COMPONENT';

  constructor(componentName: string) {
    super(
      `Cannot register component "${componentName}": a component with this name is already registered. ` +
        `Component names must be unique within a document generator.`
    );
    this.name = 'DuplicateComponentError';
    this.componentName = componentName;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DuplicateComponentError);
    }
  }
}

/**
 * Custom validation error class
 */
export class ComponentValidationError extends Error {
  public errors: ValidationError[];
  public props: unknown;

  constructor(errors: ValidationError[], props?: unknown) {
    const propsStr =
      props !== undefined ? `\nProps: ${JSON.stringify(props, null, 2)}` : '';
    const message = `Document validation failed:\n${errors
      .map((e) => `  ${e.path}: ${e.message}`)
      .join('\n')}${propsStr}`;
    super(message);
    this.name = 'ComponentValidationError';
    this.errors = errors;
    this.props = props;
  }
}

/**
 * Validate a component props against a schema.
 * Accepts a narrower interface — only needs { propsSchema }.
 */
export function validateComponentProps<TPropsSchema extends TSchema>(
  schema: { propsSchema: TPropsSchema },
  props: unknown
): ValidationResult<TPropsSchema> {
  return validateCustomComponentProps<TPropsSchema>(schema.propsSchema, props, {
    clean: true,
    applyDefaults: true,
  });
}

/**
 * Validate document and all custom components (version-aware)
 */
export function validateDocument(
  document: ReportComponentDefinition,
  customComponents: CustomComponent<any, any, any>[]
): ValidationResult {
  // First validate the document structure
  const documentResult = validateDocumentUnified(document, {
    clean: true,
    applyDefaults: true,
  });

  if (!documentResult.valid) {
    return documentResult;
  }

  // Then validate each custom component if present
  const errors: ValidationError[] = [];

  function validateComponents(components: any[], pathPrefix = 'children') {
    components.forEach((componentData, index) => {
      // Skip standard components (they have their own validation)
      const customComponent = customComponents.find(
        (cc) => cc.name === componentData.name
      );
      if (!customComponent) {
        return; // This is a standard component, skip validation here
      }

      // Resolve the correct version
      const versionEntry = resolveComponentVersion(
        customComponent.name,
        customComponent.versions,
        componentData.version
      );

      // Validate custom component against the resolved version's schema
      const validation = validateComponentProps(
        versionEntry,
        componentData.props
      );

      if (!validation.valid && validation.errors) {
        // Add component index to error paths
        const indexedErrors = validation.errors.map(
          (error: ValidationError) => ({
            ...error,
            path: `${pathPrefix}[${index}].${error.path}`,
          })
        );
        errors.push(...indexedErrors);
      }

      // Recursively validate nested children
      if (componentData.children && Array.isArray(componentData.children)) {
        validateComponents(
          componentData.children,
          `${pathPrefix}[${index}].children`
        );
      }
    });
  }

  if (document.children) {
    validateComponents(document.children);
  }

  return errors.length > 0
    ? { success: false, errors, valid: false }
    : { success: true, errors: [], valid: true };
}

/**
 * Validates component props and returns the typed props or throws.
 * Accepts a narrower interface — only needs { propsSchema }.
 */
export function getValidatedProps<TPropsSchema extends TSchema>(
  schema: { propsSchema: TPropsSchema },
  props: unknown
): TPropsSchema {
  const validation = validateComponentProps(schema, props);

  if (!validation.valid) {
    throw new ComponentValidationError(validation.errors || [], props);
  }

  return validation.data!;
}

// Re-export types from unified validation
export type {
  ValidationError,
  ValidationResult,
} from '@json-to-office/shared-docx/validation/unified';

// Export cleanComponentProps as an alias for getValidatedProps for backward compatibility
export const cleanComponentProps = getValidatedProps;

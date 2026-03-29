import type { ValidationError } from '../validation/unified';

/**
 * Error thrown when attempting to register a component with a duplicate name
 */
export class DuplicateComponentError extends Error {
  public readonly componentName: string;
  public readonly code = 'DUPLICATE_COMPONENT';

  constructor(componentName: string) {
    super(
      `Cannot register component "${componentName}": a component with this name is already registered. ` +
        'Component names must be unique within a document generator.'
    );
    this.name = 'DuplicateComponentError';
    this.componentName = componentName;

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

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
 * Error thrown when `preserveCustomComponents` lists names not registered on the generator.
 *
 * Listed names must match a component registered via `.addComponent()` — a typo is a
 * programmer error, so we throw before generation starts.
 */
export class UnknownPreservedComponentError extends Error {
  public readonly unknownNames: string[];
  public readonly registeredNames: string[];
  public readonly code = 'UNKNOWN_PRESERVED_COMPONENT';

  constructor(unknownNames: string[], registeredNames: string[]) {
    const unknownList = unknownNames.map((n) => `"${n}"`).join(', ');
    const registeredList = registeredNames.length
      ? registeredNames.map((n) => `"${n}"`).join(', ')
      : '(none)';
    super(
      `preserveCustomComponents lists unregistered component name(s): ${unknownList}. ` +
        `Registered components: ${registeredList}.`
    );
    this.name = 'UnknownPreservedComponentError';
    this.unknownNames = [...unknownNames];
    this.registeredNames = [...registeredNames];

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnknownPreservedComponentError);
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

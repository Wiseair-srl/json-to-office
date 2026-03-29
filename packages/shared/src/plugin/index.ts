// Component creation
export {
  createComponent,
  createVersion,
  type RenderContext,
  type RenderFunction,
  type ComponentVersion,
  type ComponentVersionMap,
  type CustomComponent,
} from './createComponent';

// Version resolution
export { resolveComponentVersion } from './version-resolver';

// Errors
export { DuplicateComponentError, ComponentValidationError } from './errors';

// Validation
export {
  validateAgainstSchema,
  validateCustomComponentProps,
  isValidationSuccess,
  getValidationSummary,
  type PluginValidationOptions,
  type PluginValidationResult,
  type ComponentValidationResult,
} from './validation';

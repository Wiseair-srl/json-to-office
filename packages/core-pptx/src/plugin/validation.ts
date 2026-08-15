import type { TSchema, Static } from '@sinclair/typebox';
import type { CustomComponent } from '@json-to-office/shared/plugin';
import type { PresentationComponentDefinition } from '../types';
import {
  resolveComponentVersion,
  validateCustomComponentProps,
  ComponentValidationError,
  type ComponentValidationResult,
} from '@json-to-office/shared/plugin';
import type { ValidationError } from '@json-to-office/shared';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';

// Re-export errors from shared
export {
  DuplicateComponentError,
  ComponentValidationError,
} from '@json-to-office/shared/plugin';
export type { ComponentValidationResult } from '@json-to-office/shared/plugin';
export type { ValidationError } from '@json-to-office/shared';

/**
 * Validate component props against a schema.
 */
export function validateComponentProps<TPropsSchema extends TSchema>(
  schema: { propsSchema: TPropsSchema },
  props: unknown,
  componentName?: string,
  opts?: { clean?: boolean; applyDefaults?: boolean }
): ComponentValidationResult<TPropsSchema> {
  return validateCustomComponentProps<TPropsSchema>(schema.propsSchema, props, {
    // Render-time cleaning remains the default. The document-validation path
    // passes clean:false so unknown custom props are rejected when the custom
    // schema declares additionalProperties:false.
    clean: opts?.clean ?? true,
    applyDefaults: opts?.applyDefaults ?? true,
    componentName,
  });
}

/**
 * Validate presentation and all custom components (version-aware).
 *
 * Standard nodes and tree structure are checked by the shared deep validator;
 * custom component props are then checked against their resolved version.
 */
export function validatePresentation(
  document: PresentationComponentDefinition,
  customComponents: CustomComponent<any, any, any>[],
  options?: { allowUnknownFields?: boolean }
): { valid: boolean; errors: ValidationError[] } {
  const knownCustomNames = new Set(customComponents.map((c) => c.name));

  // Validate all standard nodes and tree structure. Registered custom nodes
  // are deferred to the version-aware pass below, while their descendants are
  // still walked by the unified validator.
  const documentResult = validatePresentationDocument(document, {
    knownCustomNames,
    allowUnknownFields: options?.allowUnknownFields,
  });
  const errors: ValidationError[] = [...documentResult.errors];

  function validateComponents(components: any[], pathPrefix = 'children') {
    components.forEach((componentData, index) => {
      if (
        !componentData ||
        typeof componentData !== 'object' ||
        Array.isArray(componentData)
      ) {
        return;
      }

      const customComponent = customComponents.find(
        (cc) => cc.name === componentData.name
      );

      if (customComponent) {
        const versionEntry = resolveComponentVersion(
          customComponent.name,
          customComponent.versions,
          componentData.version
        );

        const validation = validateComponentProps(
          versionEntry,
          componentData.props,
          customComponent.name,
          { clean: options?.allowUnknownFields === true }
        );

        if (!validation.valid && validation.errors) {
          const indexedErrors = validation.errors.map(
            (error: ValidationError) => ({
              ...error,
              path: `${pathPrefix}[${index}].${error.path}`,
            })
          );
          errors.push(...indexedErrors);
        }
      }

      // Recurse into children (slides, containers, etc.)
      if (componentData.children && Array.isArray(componentData.children)) {
        validateComponents(
          componentData.children,
          `${pathPrefix}[${index}].children`
        );
      }
    });
  }

  if (document && Array.isArray(document.children)) {
    validateComponents(document.children);
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, errors: [] };
}

/**
 * Validates component props and returns typed props or throws.
 */
export function getValidatedProps<TPropsSchema extends TSchema>(
  schema: { propsSchema: TPropsSchema },
  props: unknown
): Static<TPropsSchema> {
  const validation = validateComponentProps(schema, props);

  if (!validation.valid) {
    throw new ComponentValidationError(validation.errors || [], props);
  }

  return validation.data!;
}

export const cleanComponentProps = getValidatedProps;

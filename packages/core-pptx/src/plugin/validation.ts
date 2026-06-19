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
import { collectImageSourceConflicts } from '@json-to-office/shared-pptx';

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
  componentName?: string
): ComponentValidationResult<TPropsSchema> {
  return validateCustomComponentProps<TPropsSchema>(schema.propsSchema, props, {
    clean: true,
    applyDefaults: true,
    componentName,
  });
}

/**
 * Validate presentation and all custom components (version-aware).
 *
 * Custom component props are checked version-aware. In addition, a structural
 * pass rejects image components that set more than one mutually-exclusive source
 * (`path`/`base64`/`svg`) — matching core-docx behavior so a multi-source payload
 * is a hard error rather than being silently resolved by runtime precedence.
 */
export function validatePresentation(
  document: PresentationComponentDefinition,
  customComponents: CustomComponent<any, any, any>[]
): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  // Structural rule the per-component schema can't express: image sources are
  // mutually exclusive. Runs unconditionally over the whole tree.
  errors.push(...collectImageSourceConflicts(document));

  function validateComponents(components: any[], pathPrefix = 'children') {
    components.forEach((componentData, index) => {
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
          customComponent.name
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

  if (document.children) {
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

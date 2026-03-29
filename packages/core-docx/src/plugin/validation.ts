import type { TSchema, Static } from '@sinclair/typebox';
import type { CustomComponent } from './createComponent';
import type { ReportComponentDefinition } from '../types';
import { resolveComponentVersion } from './version-resolver';
import {
  validateCustomComponentProps,
  ComponentValidationError,
  type ComponentValidationResult,
} from '@json-to-office/shared/plugin';
import {
  validateDocument as validateDocumentUnified,
  type ValidationError,
} from '@json-to-office/shared-docx/validation/unified';
import type { ValidationResult } from '@json-to-office/shared';

// Re-export errors from shared
export {
  DuplicateComponentError,
  ComponentValidationError,
} from '@json-to-office/shared/plugin';

/**
 * Validate a component props against a schema.
 * Accepts a narrower interface — only needs { propsSchema }.
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
 * Validate document and all custom components (version-aware)
 */
export function validateDocument(
  document: ReportComponentDefinition,
  customComponents: CustomComponent<any, any, any>[]
): ValidationResult & { success: boolean } {
  // First validate the document structure
  const documentResult = validateDocumentUnified(document, {
    clean: true,
    applyDefaults: true,
  });

  if (!documentResult.valid) {
    return { ...documentResult, success: false };
  }

  // Then validate each custom component if present
  const errors: ValidationError[] = [];

  function validateComponents(components: any[], pathPrefix = 'children') {
    components.forEach((componentData, index) => {
      const customComponent = customComponents.find(
        (cc) => cc.name === componentData.name
      );
      if (!customComponent) {
        return;
      }

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

// Re-export types
export type { ValidationError } from '@json-to-office/shared-docx/validation/unified';
export type { ComponentValidationResult } from '@json-to-office/shared/plugin';

export const cleanComponentProps = getValidatedProps;

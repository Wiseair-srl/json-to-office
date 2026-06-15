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
  UnknownPreservedComponentError,
} from '@json-to-office/shared/plugin';

/**
 * Validate a component props against a schema.
 * Accepts a narrower interface — only needs { propsSchema }.
 */
export function validateComponentProps<TPropsSchema extends TSchema>(
  schema: { propsSchema: TPropsSchema },
  props: unknown,
  componentName?: string,
  opts?: { clean?: boolean; applyDefaults?: boolean }
): ComponentValidationResult<TPropsSchema> {
  // `clean` defaults to true so the render path (getValidatedProps) keeps
  // normalizing props (strip unknown + apply defaults). The validation path
  // passes `clean: false` to reject unknown keys instead of silently dropping
  // them — strict unless the caller opts into allowUnknownFields.
  return validateCustomComponentProps<TPropsSchema>(schema.propsSchema, props, {
    clean: opts?.clean ?? true,
    applyDefaults: opts?.applyDefaults ?? true,
    componentName,
  });
}

/**
 * Validate document and all custom components (version-aware).
 *
 * Standard components (paragraph, section, …) are validated against their
 * schemas via the unified validator, which is told the registered custom names
 * so it neither rejects them as unknown nor checks them against a standard
 * schema. Custom component props are then validated version-aware below. Errors
 * from both passes are merged so a single call reports the whole document.
 */
export function validateDocument(
  document: ReportComponentDefinition,
  customComponents: CustomComponent<any, any, any>[],
  options?: { allowUnknownFields?: boolean }
): ValidationResult & { success: boolean } {
  const knownCustomNames = new Set(customComponents.map((c) => c.name));

  // Validate the standard-component structure (custom components deferred).
  const documentResult = validateDocumentUnified(document, {
    knownCustomNames,
    allowUnknownFields: options?.allowUnknownFields,
  });

  // Collect standard-structure errors, then append custom-component errors.
  const errors: ValidationError[] = [...(documentResult.errors || [])];

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
        customComponent.name,
        // Reject unknown custom props unless the caller allows them.
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

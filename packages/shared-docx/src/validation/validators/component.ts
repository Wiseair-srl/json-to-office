/**
 * Component validators
 * @module validation/validators/component
 * @description
 * Now uses unified validation system
 */

import {
  validateComponent as unifiedValidateComponent,
  validateComponentDefinition as unifiedValidateComponentDefinition,
  isStandardComponentName,
} from '../unified/component-validator';

// Re-export everything from unified component validator
export {
  validateComponent as validateComponentProps,
  validateComponentDefinition,
  validateComponents,
  validateCustomComponentProps,
  isStandardComponentName,
  // Type guards
  isReportProps,
  isSectionProps,
  isHeadingProps,
  isParagraphProps,
  isColumnsProps,
  isImageProps,
  isStatisticProps,
  isTableProps,
  isHeaderProps,
  isFooterProps,
  isListProps,
  isCustomComponentProps,
  type StandardComponentName,
} from '../unified/component-validator';

// For backward compatibility, provide safeValidateComponentProps
export function safeValidateComponentProps<T>(
  name: string,
  props: unknown
): { success: true; data: T } | { success: false; error: any[] } {
  // For non-standard types, use 'custom'
  const componentName = isStandardComponentName(name) ? name : 'custom';
  const result = unifiedValidateComponent(componentName, props);

  if (result.valid) {
    return { success: true, data: result.data as T };
  }

  return { success: false, error: result.errors || [] };
}

// For backward compatibility, provide safeValidateComponentDefinition
export function safeValidateComponentDefinition(
  component: unknown
): { success: true; data: any } | { success: false; error: any[] } {
  const result = unifiedValidateComponentDefinition(component);

  if (result.valid) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result.errors || [] };
}

// For backward compatibility, provide error formatting
export function getValidationErrors(props: unknown, name?: string): string[] {
  // For non-standard types, use 'custom'
  const componentName = name && isStandardComponentName(name) ? name : 'custom';
  const result = unifiedValidateComponent(componentName, props);

  if (result.valid) return [];

  return (result.errors || []).map((e: any) =>
    e.path ? `${e.path}: ${e.message}` : e.message
  );
}

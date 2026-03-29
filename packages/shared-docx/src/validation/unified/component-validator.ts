/**
 * Component validation implementation
 * Single source of truth for all component validation
 */

import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import { validateCustomComponentProps as sharedValidateCustomComponentProps } from '@json-to-office/shared/plugin';
import {
  ReportPropsSchema,
  SectionPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ColumnsPropsSchema,
  ImagePropsSchema,
  StatisticPropsSchema,
  TablePropsSchema,
  HeaderPropsSchema,
  FooterPropsSchema,
  ListPropsSchema,
  ComponentDefinitionSchema,
} from '../../schemas/components';
import { CustomComponentDefinitionSchema } from '../../schemas/custom-components';
import type { ComponentValidationResult, ValidationOptions } from './types';
import { validateAgainstSchema } from './base-validator';

// Map of standard component names to their schemas
const COMPONENT_SCHEMA_MAP = {
  report: ReportPropsSchema,
  section: SectionPropsSchema,
  heading: HeadingPropsSchema,
  paragraph: ParagraphPropsSchema,
  columns: ColumnsPropsSchema,
  image: ImagePropsSchema,
  statistic: StatisticPropsSchema,
  table: TablePropsSchema,
  header: HeaderPropsSchema,
  footer: FooterPropsSchema,
  list: ListPropsSchema,
  custom: CustomComponentDefinitionSchema,
} as const;

export type StandardComponentName = keyof typeof COMPONENT_SCHEMA_MAP;

/**
 * Validate a component configuration by type
 */
export function validateComponent<T extends StandardComponentName>(
  name: T,
  props: unknown,
  options?: ValidationOptions
): ComponentValidationResult<any> {
  const schema = COMPONENT_SCHEMA_MAP[name];

  if (!schema) {
    // Unknown component type, try custom component schema
    const customResult = validateAgainstSchema(
      CustomComponentDefinitionSchema,
      props,
      options
    );

    return {
      ...customResult,
      success: customResult.valid, // Add success for backward compatibility
      componentName: name,
      isCustomComponent: true,
    };
  }

  const result = validateAgainstSchema(schema, props, options);

  return {
    ...result,
    success: result.valid, // Add success for backward compatibility
    componentName: name,
    isCustomComponent: name === 'custom',
  };
}

/**
 * Validate a complete component definition (including nested children)
 */
export function validateComponentDefinition(
  component: unknown,
  options?: ValidationOptions
): ComponentValidationResult {
  const result = validateAgainstSchema(
    ComponentDefinitionSchema,
    component,
    options
  );

  // Add component-specific metadata
  const componentResult: ComponentValidationResult = {
    ...result,
  };

  if (result.valid && result.data) {
    const comp = result.data as any;
    componentResult.componentName = comp.name;
    componentResult.isCustomComponent = !isStandardComponentName(comp.name);
  }

  return componentResult;
}

/**
 * Validate a custom component configuration with a custom schema.
 * Delegates to @json-to-office/shared/plugin to avoid duplication.
 */
export function validateCustomComponentProps<T>(
  componentSchema: TSchema,
  config: unknown,
  options?: ValidationOptions
): ComponentValidationResult<T> {
  return sharedValidateCustomComponentProps<T>(
    componentSchema,
    config,
    options
  );
}

/**
 * Batch validate multiple components
 */
export function validateComponents(
  components: Array<{ name: string; props: unknown }>,
  options?: ValidationOptions
): ComponentValidationResult[] {
  return components.map(({ name, props }) => {
    if (isStandardComponentName(name)) {
      return validateComponent(name, props, options);
    }
    return validateComponent('custom', props, options);
  });
}

/**
 * Type guards for component names
 */
export function isStandardComponentName(
  name: string
): name is StandardComponentName {
  return name in COMPONENT_SCHEMA_MAP;
}

export function isReportProps(
  config: unknown
): config is Static<typeof ReportPropsSchema> {
  return Value.Check(ReportPropsSchema, config);
}

export function isSectionProps(
  config: unknown
): config is Static<typeof SectionPropsSchema> {
  return Value.Check(SectionPropsSchema, config);
}

export function isHeadingProps(
  config: unknown
): config is Static<typeof HeadingPropsSchema> {
  return Value.Check(HeadingPropsSchema, config);
}

export function isParagraphProps(
  config: unknown
): config is Static<typeof ParagraphPropsSchema> {
  return Value.Check(ParagraphPropsSchema, config);
}

export function isColumnsProps(
  config: unknown
): config is Static<typeof ColumnsPropsSchema> {
  return Value.Check(ColumnsPropsSchema, config);
}

export function isImageProps(
  config: unknown
): config is Static<typeof ImagePropsSchema> {
  return Value.Check(ImagePropsSchema, config);
}

export function isStatisticProps(
  config: unknown
): config is Static<typeof StatisticPropsSchema> {
  return Value.Check(StatisticPropsSchema, config);
}

export function isTableProps(
  config: unknown
): config is Static<typeof TablePropsSchema> {
  return Value.Check(TablePropsSchema, config);
}

export function isHeaderProps(
  config: unknown
): config is Static<typeof HeaderPropsSchema> {
  return Value.Check(HeaderPropsSchema, config);
}

export function isFooterProps(
  config: unknown
): config is Static<typeof FooterPropsSchema> {
  return Value.Check(FooterPropsSchema, config);
}

export function isListProps(
  config: unknown
): config is Static<typeof ListPropsSchema> {
  return Value.Check(ListPropsSchema, config);
}

export function isCustomComponentProps(
  config: unknown
): config is Static<typeof CustomComponentDefinitionSchema> {
  return Value.Check(CustomComponentDefinitionSchema, config);
}

/**
 * Create a component validator with default options
 */
export function createComponentValidator(defaultOptions?: ValidationOptions) {
  return {
    validate: (name: string, props: unknown, options?: ValidationOptions) => {
      if (isStandardComponentName(name)) {
        return validateComponent(name, props, {
          ...defaultOptions,
          ...options,
        });
      }
      return validateComponent('custom', props, {
        ...defaultOptions,
        ...options,
      });
    },
    validateDefinition: (component: unknown, options?: ValidationOptions) =>
      validateComponentDefinition(component, { ...defaultOptions, ...options }),
    validateCustom: <T>(
      schema: TSchema,
      config: unknown,
      options?: ValidationOptions
    ) =>
      validateCustomComponentProps<T>(schema, config, {
        ...defaultOptions,
        ...options,
      }),
  };
}

// Export convenient validators with common configurations
export const componentValidator = createComponentValidator({
  clean: true,
  applyDefaults: true,
});

export const strictComponentValidator = createComponentValidator({
  clean: false,
  applyDefaults: false,
  maxErrors: 10,
});

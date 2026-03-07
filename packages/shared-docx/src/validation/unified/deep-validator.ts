/**
 * Deep validation utilities for collecting ALL errors in nested structures
 * This bypasses TypeBox's union short-circuiting to provide comprehensive error reporting
 */

import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import type { ValidationError } from '@json-to-office/shared';
import {
  ReportPropsSchema,
  SectionPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  TablePropsSchema,
  ImagePropsSchema,
  ListPropsSchema,
  StatisticPropsSchema,
  ColumnsPropsSchema,
  HeaderPropsSchema,
  FooterPropsSchema,
} from '../../schemas/components';
import { CustomComponentDefinitionSchema } from '../../schemas/custom-components';
import { transformValueErrors } from './error-transformer';

// Map of component names to their schemas
const COMPONENT_SCHEMAS: Record<string, TSchema> = {
  report: ReportPropsSchema,
  section: SectionPropsSchema,
  heading: HeadingPropsSchema,
  paragraph: ParagraphPropsSchema,
  table: TablePropsSchema,
  image: ImagePropsSchema,
  list: ListPropsSchema,
  statistic: StatisticPropsSchema,
  columns: ColumnsPropsSchema,
  header: HeaderPropsSchema,
  footer: FooterPropsSchema,
  custom: CustomComponentDefinitionSchema,
};

/**
 * Deep validate a document to collect ALL errors, not just union-level errors
 */
export function deepValidateDocument(data: any): ValidationError[] {
  const allErrors: ValidationError[] = [];

  // Validate the document structure
  if (!data || typeof data !== 'object') {
    allErrors.push({
      path: 'root',
      message: 'Document must be an object',
      code: 'invalid_type',
    });
    return allErrors;
  }

  // Check name field
  if (!data.name) {
    allErrors.push({
      path: '/name',
      message: 'Missing required field "name"',
      code: 'required_property',
    });
  } else if (data.name !== 'report') {
    allErrors.push({
      path: '/name',
      message: `Invalid name "${data.name}". Expected "report"`,
      code: 'invalid_value',
    });
  }

  // Validate props section if present and name is report
  if (data.name === 'report' && data.props) {
    const propsErrors = validateComponentProps('report', data.props, '/props');
    allErrors.push(...propsErrors);
  }

  // Validate children array
  if (!data.children) {
    allErrors.push({
      path: '/children',
      message: 'Missing required field "children"',
      code: 'required_property',
    });
  } else if (!Array.isArray(data.children)) {
    allErrors.push({
      path: '/children',
      message: 'Field "children" must be an array',
      code: 'invalid_type',
    });
  } else {
    // Validate each child component
    data.children.forEach((child: any, index: number) => {
      const childPath = `/children/${index}`;

      if (!child || typeof child !== 'object') {
        allErrors.push({
          path: childPath,
          message: 'Component must be an object',
          code: 'invalid_type',
        });
        return;
      }

      // Check component name
      if (!child.name) {
        allErrors.push({
          path: `${childPath}/name`,
          message: 'Component missing required field "name"',
          code: 'required_property',
        });
        return;
      }

      // Validate component props based on name
      if (child.props) {
        const componentErrors = validateComponentProps(
          child.name,
          child.props,
          `${childPath}/props`
        );
        allErrors.push(...componentErrors);
      } else if (child.name !== 'custom') {
        // Most components require props
        allErrors.push({
          path: `${childPath}/props`,
          message: 'Component missing required field "props"',
          code: 'required_property',
        });
      }

      // Special handling for section components (recursive)
      if (child.name === 'section' && child.children) {
        if (!Array.isArray(child.children)) {
          allErrors.push({
            path: `${childPath}/children`,
            message: 'Section children must be an array',
            code: 'invalid_type',
          });
        } else {
          // Recursively validate nested components
          child.children.forEach((nestedChild: any, nestedIndex: number) => {
            const nestedChildPath = `${childPath}/children/${nestedIndex}`;
            if (!nestedChild || typeof nestedChild !== 'object') {
              allErrors.push({
                path: nestedChildPath,
                message: 'Nested component must be an object',
                code: 'invalid_type',
              });
              return;
            }

            if (!nestedChild.name) {
              allErrors.push({
                path: `${nestedChildPath}/name`,
                message: 'Nested component missing required field "name"',
                code: 'required_property',
              });
            } else {
              if (nestedChild.props) {
                const nestedErrors = validateComponentProps(
                  nestedChild.name,
                  nestedChild.props,
                  `${nestedChildPath}/props`
                );
                allErrors.push(...nestedErrors);
              } else if (nestedChild.name !== 'custom') {
                // Most components require props
                allErrors.push({
                  path: `${nestedChildPath}/props`,
                  message: 'Component missing required field "props"',
                  code: 'required_property',
                });
              }
            }
          });
        }
      }
    });
  }

  return allErrors;
}

/**
 * Validate a component's props against its schema
 */
function validateComponentProps(
  componentName: string,
  props: any,
  basePath: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Get the schema for this component
  const schema = COMPONENT_SCHEMAS[componentName];
  if (!schema) {
    // Unknown component type
    errors.push({
      path: basePath.replace('/props', '/name'),
      message: `Unknown component "${componentName}"`,
      code: 'unknown_component',
    });
    return errors;
  }

  // Use TypeBox to validate against the specific schema
  if (!Value.Check(schema, props)) {
    const valueErrors = [...Value.Errors(schema, props)];
    const transformedErrors = transformValueErrors(valueErrors, {
      maxErrors: 100,
    });

    // Adjust paths to be relative to the document root
    transformedErrors.forEach((error) => {
      // Combine base path with error path
      const fullPath =
        error.path === 'root'
          ? basePath
          : `${basePath}${error.path.startsWith('/') ? error.path : '/' + error.path}`;

      errors.push({
        ...error,
        path: fullPath,
      });
    });
  }

  return errors;
}

/**
 * Combine deep validation with standard validation
 */
export function comprehensiveValidateDocument(
  data: any,
  existingErrors: ValidationError[] = []
): ValidationError[] {
  // First, get deep validation errors
  const deepErrors = deepValidateDocument(data);

  // If we got specific errors from deep validation, prefer those
  if (deepErrors.length > 0) {
    // Filter out any generic "invalid component configurations" errors
    const filteredExisting = existingErrors.filter(
      (e) =>
        !e.message.includes('invalid module configurations') &&
        !e.message.includes('invalid component configurations')
    );

    // Combine and deduplicate
    const allErrors = [...filteredExisting, ...deepErrors];
    const uniqueErrors = deduplicateErrors(allErrors);

    return uniqueErrors;
  }

  // Otherwise return the existing errors
  return existingErrors;
}

/**
 * Deduplicate errors by path and message
 */
function deduplicateErrors(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  const unique: ValidationError[] = [];

  for (const error of errors) {
    const key = `${error.path}:${error.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(error);
    }
  }

  return unique;
}

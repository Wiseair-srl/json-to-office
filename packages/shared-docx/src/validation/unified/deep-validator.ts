/**
 * Deep validation utilities for collecting ALL errors in nested structures
 * This bypasses TypeBox's union short-circuiting to provide comprehensive error reporting
 */

import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import type { ValidationError } from '@json-to-office/shared';
import { STANDARD_COMPONENTS_REGISTRY } from '../../schemas/component-registry';
import { CustomComponentDefinitionSchema } from '../../schemas/custom-components';
import { transformValueErrors } from './error-transformer';

// Map of component names to their props schemas, sourced from the registry.
// This stays in sync as new standard components are added, so the document
// root ('docx') and every standard child component are recognized here.
const COMPONENT_SCHEMAS: Record<string, TSchema> = Object.fromEntries([
  ...STANDARD_COMPONENTS_REGISTRY.map((c) => [c.name, c.propsSchema]),
  ['custom', CustomComponentDefinitionSchema],
]);

// Root component names that may appear at the top of a document.
const ROOT_COMPONENT_NAMES = new Set(
  STANDARD_COMPONENTS_REGISTRY.filter((c) =>
    Boolean(c.special?.hasSchemaField)
  ).map((c) => c.name)
);

/**
 * Options that tune deep validation.
 *
 * `knownCustomNames` — names of registered plugin components. The deep
 * validator neither flags these as "unknown component" nor validates their
 * props here; the plugin layer validates custom props version-aware separately.
 *
 * `allowUnknownFields` — when true, unknown properties are stripped before the
 * per-component check instead of being rejected. The escape hatch for callers
 * migrating onto strict schemas.
 */
export interface DeepValidateOptions {
  knownCustomNames?: Set<string>;
  allowUnknownFields?: boolean;
}

// Image source fields that are mutually exclusive: exactly one may be set.
const IMAGE_SOURCE_FIELDS = ['path', 'base64', 'svg'] as const;

/**
 * Names of the image source fields that carry a non-empty value on a props object.
 */
export function presentImageSources(props: unknown): string[] {
  if (!props || typeof props !== 'object') return [];
  const p = props as Record<string, unknown>;
  return IMAGE_SOURCE_FIELDS.filter((f) => {
    const v = p[f];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Collect "more than one image source" conflicts anywhere in a document.
 *
 * `path`, `base64`, and `svg` are mutually exclusive on the image component, but
 * all three are optional fields on a single object schema — so a multi-source
 * payload passes TypeBox's structural check and would otherwise be silently
 * resolved by runtime precedence (svg > base64 > path). This walk runs
 * unconditionally and rejects such payloads. It traverses every nested value, so
 * images inside columns, table cells, text boxes, headers/footers, and sections
 * are all covered regardless of container shape.
 */
export function collectImageSourceConflicts(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  const visit = (node: any, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (node.name === 'image') {
      const present = presentImageSources(node.props);
      if (present.length > 1) {
        errors.push({
          path: `${path}/props`,
          message: `Image component accepts only one source, but found ${present
            .map((f) => `"${f}"`)
            .join(', ')}. Use exactly one of "path", "base64", or "svg".`,
          code: 'mutually_exclusive',
        });
      }
    }

    for (const key of Object.keys(node)) {
      visit(node[key], `${path}/${key}`);
    }
  };

  visit(data, '');
  return errors;
}

/**
 * Deep validate a document to collect ALL errors, not just union-level errors
 */
export function deepValidateDocument(
  data: any,
  opts: DeepValidateOptions = {}
): ValidationError[] {
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
  } else if (!ROOT_COMPONENT_NAMES.has(data.name)) {
    const expected = [...ROOT_COMPONENT_NAMES].map((n) => `"${n}"`).join(', ');
    allErrors.push({
      path: '/name',
      message: `Invalid name "${data.name}". Expected ${expected}`,
      code: 'invalid_value',
    });
  }

  // Validate props section when the key is present so explicit `null` (or any
  // falsy non-object) is checked against the component's schema instead of
  // silently passing.
  if (ROOT_COMPONENT_NAMES.has(data.name) && 'props' in data) {
    const propsErrors = validateComponentProps(
      data.name,
      data.props,
      '/props',
      opts
    );
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

      // Registered plugin components are validated version-aware by the plugin
      // layer; skip them here so they are neither flagged as unknown nor
      // checked against a standard schema.
      if (opts.knownCustomNames?.has(child.name)) {
        return;
      }

      // Validate props against the component's schema. When props is omitted,
      // validate an empty object so the schema decides whether props are
      // required (e.g. `section` needs none; `heading` requires text+level)
      // rather than assuming every component requires a props field.
      if (child.props != null) {
        allErrors.push(
          ...validateComponentProps(
            child.name,
            child.props,
            `${childPath}/props`,
            opts
          )
        );
      } else if (child.name !== 'custom') {
        allErrors.push(
          ...validateComponentProps(child.name, {}, `${childPath}/props`, opts)
        );
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
            } else if (opts.knownCustomNames?.has(nestedChild.name)) {
              // Registered plugin component — validated separately.
            } else if (nestedChild.props != null) {
              allErrors.push(
                ...validateComponentProps(
                  nestedChild.name,
                  nestedChild.props,
                  `${nestedChildPath}/props`,
                  opts
                )
              );
            } else if (nestedChild.name !== 'custom') {
              allErrors.push(
                ...validateComponentProps(
                  nestedChild.name,
                  {},
                  `${nestedChildPath}/props`,
                  opts
                )
              );
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
  basePath: string,
  opts: DeepValidateOptions = {}
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

  // When unknown fields are explicitly allowed, strip them before checking so
  // additionalProperties:false no longer rejects — required/typed fields are
  // still enforced.
  const toCheck = opts.allowUnknownFields
    ? Value.Clean(schema, Value.Clone(props))
    : props;

  // Use TypeBox to validate against the specific schema
  if (!Value.Check(schema, toCheck)) {
    const valueErrors = [...Value.Errors(schema, toCheck)];
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
 * Combine deep validation with standard validation.
 *
 * Deep validation produces precise, path-aware errors. TypeBox's discriminated-
 * union check, by contrast, often collapses any failure under the root document
 * into a single generic "Invalid component configuration for 'docx'" message at
 * `root` — useful as a signal that something is wrong, but actionable only via
 * the deep-validator's output. We always strip that catch-all so it doesn't
 * appear alongside (or, worse, instead of) the real diagnostics.
 */
export function comprehensiveValidateDocument(
  data: any,
  existingErrors: ValidationError[] = [],
  opts: DeepValidateOptions = {}
): ValidationError[] {
  const deepErrors = deepValidateDocument(data, opts);

  const filteredExisting = existingErrors.filter(
    (e) => !isGenericUnionCatchAll(e)
  );

  return deduplicateErrors([...filteredExisting, ...deepErrors]);
}

/**
 * Detect TypeBox's generic union/discriminator catch-all error at the document
 * root. These messages name the component type ('docx') but give no actionable
 * detail — the deep validator emits the actual path-level errors instead.
 */
function isGenericUnionCatchAll(error: ValidationError): boolean {
  const atRoot = !error.path || error.path === 'root' || error.path === '/';
  if (!atRoot) return false;
  const msg = error.message || '';
  return (
    /invalid (component|module) configurations?/i.test(msg) ||
    /invalid document structure/i.test(msg)
  );
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

/**
 * Deep validation utilities for collecting ALL errors in nested structures.
 *
 * Mirrors the docx deep validator: the recursive discriminated union
 * (PptxComponentDefinitionSchema) short-circuits on the first mismatch and
 * collapses failures into a generic root error, so this walk visits every
 * component in the tree and validates its props against the real per-component
 * schema, producing precise, path-aware errors.
 */

import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import type { ValidationError } from '@json-to-office/shared';
import { transformValueErrors } from '@json-to-office/shared';
import {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  getPptxStandardComponent,
} from '../../schemas/component-registry';

// Map of component names to their props schemas, sourced from the registry.
// This stays in sync as new standard components are added, so the presentation
// root ('pptx') and every standard child component are recognized here.
const COMPONENT_SCHEMAS: Record<string, TSchema> = Object.fromEntries(
  PPTX_STANDARD_COMPONENTS_REGISTRY.map((c) => [c.name, c.propsSchema])
);

// Root component names that may appear at the top of a presentation.
const ROOT_COMPONENT_NAMES = new Set(
  PPTX_STANDARD_COMPONENTS_REGISTRY.filter((c) =>
    Boolean(c.special?.hasSchemaField)
  ).map((c) => c.name)
);

// Top-level keys allowed on a component object. The recursive union enforces
// this via additionalProperties:false; the walk re-checks it so a typo like
// "porps" is reported at a precise path instead of a generic union failure.
const COMPONENT_OBJECT_KEYS = new Set([
  'name',
  'id',
  'enabled',
  'props',
  'children',
]);
const ROOT_OBJECT_KEYS = new Set([...COMPONENT_OBJECT_KEYS, '$schema']);

/**
 * Options that tune deep validation.
 *
 * `knownCustomNames` — names of registered plugin components. The deep
 * validator neither flags these as "unknown component" nor validates their
 * props here; the plugin layer validates custom props separately.
 *
 * `allowUnknownFields` — when true, unknown properties are stripped before the
 * per-component check instead of being rejected. The escape hatch for callers
 * migrating onto strict schemas.
 */
export interface DeepValidateOptions {
  knownCustomNames?: Set<string>;
  allowUnknownFields?: boolean;
}

/**
 * Deep validate a presentation to collect ALL errors, not just union-level errors.
 */
export function deepValidatePresentation(
  data: any,
  opts: DeepValidateOptions = {}
): ValidationError[] {
  const allErrors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    allErrors.push({
      path: 'root',
      message: 'Presentation must be an object',
      code: 'invalid_type',
    });
    return allErrors;
  }

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

  for (const key of Object.keys(data)) {
    if (!ROOT_OBJECT_KEYS.has(key)) {
      allErrors.push({
        path: `/${key}`,
        message: `Unknown field "${key}" on the root component`,
        code: 'unknown_field',
      });
    }
  }

  // Validate props when the key is present so explicit `null` (or any falsy
  // non-object) is checked against the component's schema instead of silently
  // passing.
  if (ROOT_COMPONENT_NAMES.has(data.name) && 'props' in data) {
    allErrors.push(
      ...validateComponentProps(data.name, data.props, '/props', opts)
    );
  }

  // The root requires a children array (the slides); nested containers may
  // legitimately omit theirs.
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
  }

  walkComponentTree(data, '', opts, allErrors);

  return allErrors;
}

/**
 * Recursively validate every component nested under `node`.
 *
 * Walks two kinds of child position to any depth:
 *  - the `children` array — `pptx` holds slides, `slide` holds content
 *    components. The registry's `allowedChildren` narrows what each container
 *    accepts, and leaf components must not carry children at all; and
 *  - a slide's `props.placeholders` record — added dynamically by the
 *    component registry on top of the static SlidePropsSchema, so its values
 *    are not covered by the slide's own props validation and this walk is
 *    their only checker.
 *
 * The node's own props are NOT validated here — the caller validates the root
 * props, and every entry is validated as it is visited.
 */
function walkComponentTree(
  node: any,
  path: string,
  opts: DeepValidateOptions,
  errors: ValidationError[]
): void {
  if (!node || typeof node !== 'object') return;

  const validateEntry = (child: any, childPath: string): void => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      errors.push({
        path: childPath,
        message: 'Component must be an object',
        code: 'invalid_type',
      });
      return;
    }
    if (typeof child.name !== 'string' || child.name.length === 0) {
      errors.push({
        path: `${childPath}/name`,
        message: 'Component missing required field "name"',
        code: 'required_property',
      });
      return;
    }

    // Registered plugin components are validated by the plugin layer; skip
    // their props and subtree so they are neither double-validated nor
    // misreported as unknown.
    if (opts.knownCustomNames?.has(child.name)) return;

    for (const key of Object.keys(child)) {
      if (!COMPONENT_OBJECT_KEYS.has(key)) {
        errors.push({
          path: `${childPath}/${key}`,
          message: `Unknown field "${key}" on component "${child.name}"`,
          code: 'unknown_field',
        });
      }
    }

    // Validate props against the component's schema. When props is omitted,
    // validate an empty object so the schema decides whether props are
    // required (e.g. `slide` needs none; `text` requires text).
    const propsPath = `${childPath}/props`;
    if (child.props != null) {
      errors.push(
        ...validateComponentProps(child.name, child.props, propsPath, opts)
      );
    } else {
      errors.push(...validateComponentProps(child.name, {}, propsPath, opts));
    }

    const def = getPptxStandardComponent(child.name);
    if (def && !def.hasChildren && child.children != null) {
      errors.push({
        path: `${childPath}/children`,
        message: `Component "${child.name}" does not accept children`,
        code: 'invalid_value',
      });
      return;
    }

    // Recurse so arbitrarily nested containers are covered.
    walkComponentTree(child, childPath, opts, errors);
  };

  const parentDef = getPptxStandardComponent(node.name);

  // A slide's `placeholders` record maps placeholder names to full components
  // ({ "title": { "name": "text", ... } }). The static SlidePropsSchema does
  // not include the field (it is injected with the recursive ref at schema
  // generation time), so validateComponentProps strips it before checking the
  // slide's own props — each value is validated here instead.
  if (node.name === 'slide' && node.props && typeof node.props === 'object') {
    const placeholders = node.props.placeholders;
    if (
      placeholders &&
      typeof placeholders === 'object' &&
      !Array.isArray(placeholders)
    ) {
      for (const [key, child] of Object.entries(placeholders)) {
        validateEntry(child, `${path}/props/placeholders/${key}`);
      }
    } else if (placeholders != null) {
      errors.push({
        path: `${path}/props/placeholders`,
        message:
          'Field "placeholders" must be an object mapping placeholder names to components',
        code: 'invalid_type',
      });
    }
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child: any, i: number) => {
      const childPath = `${path}/children/${i}`;
      // Enforce the registry's container narrowing (pptx → slide,
      // slide → content) for known components; unknown names are already
      // reported by validateComponentProps inside validateEntry.
      if (
        parentDef?.allowedChildren &&
        child &&
        typeof child === 'object' &&
        typeof child.name === 'string' &&
        getPptxStandardComponent(child.name) &&
        !parentDef.allowedChildren.includes(child.name)
      ) {
        const expected = parentDef.allowedChildren
          .map((n) => `"${n}"`)
          .join(', ');
        errors.push({
          path: `${childPath}/name`,
          message: `Component "${child.name}" is not allowed inside "${node.name}". Expected ${expected}`,
          code: 'invalid_value',
        });
      }
      validateEntry(child, childPath);
    });
  } else if (node.children != null && path !== '') {
    // `children` is present but not an array on a nested container. The root's
    // `children` is already checked by deepValidatePresentation (skipped here
    // via `path !== ''` so it is not reported twice).
    errors.push({
      path: `${path}/children`,
      message: 'Field "children" must be an array',
      code: 'invalid_type',
    });
  }
}

/**
 * Validate a component's props against its schema.
 */
function validateComponentProps(
  componentName: string,
  props: any,
  basePath: string,
  opts: DeepValidateOptions = {}
): ValidationError[] {
  const errors: ValidationError[] = [];

  const schema = COMPONENT_SCHEMAS[componentName];
  if (!schema) {
    // Unknown component type. `basePath` always ends in `/props`; anchor the
    // swap to the end so a nested path like `…/props/placeholders/title/props`
    // becomes `…/props/placeholders/title/name` rather than mangling an
    // earlier `/props`.
    errors.push({
      path: basePath.replace(/\/props$/, '/name'),
      message: `Unknown component "${componentName}"`,
      code: 'unknown_component',
    });
    return errors;
  }

  // A slide's `placeholders` field is injected at schema-generation time and
  // absent from the static props schema; its values are walked separately, so
  // strip it here to avoid a false additionalProperties rejection.
  let toCheck = props;
  if (
    componentName === 'slide' &&
    props &&
    typeof props === 'object' &&
    'placeholders' in props
  ) {
    const rest = { ...props };
    delete rest.placeholders;
    toCheck = rest;
  }

  // When unknown fields are explicitly allowed, strip them before checking so
  // additionalProperties:false no longer rejects — required/typed fields are
  // still enforced.
  if (opts.allowUnknownFields) {
    toCheck = Value.Clean(schema, Value.Clone(toCheck));
  }

  if (!Value.Check(schema, toCheck)) {
    const valueErrors = [...Value.Errors(schema, toCheck)];
    const transformedErrors = transformValueErrors(valueErrors, {
      maxErrors: 100,
    });

    // Adjust paths to be relative to the document root
    transformedErrors.forEach((error) => {
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
 * union check, by contrast, often collapses any failure under the root into a
 * single generic "Invalid component configuration for 'pptx'" message at
 * `root` — useful as a signal that something is wrong, but actionable only via
 * the deep-validator's output. We always strip that catch-all so it doesn't
 * appear alongside (or, worse, instead of) the real diagnostics.
 */
export function comprehensiveValidatePresentation(
  data: any,
  existingErrors: ValidationError[] = [],
  opts: DeepValidateOptions = {}
): ValidationError[] {
  const deepErrors = deepValidatePresentation(data, opts);

  const filteredExisting = existingErrors.filter(
    (e) => !isGenericUnionCatchAll(e)
  );

  return deduplicateErrors([...filteredExisting, ...deepErrors]);
}

/**
 * Detect TypeBox's generic union/discriminator catch-all error at the document
 * root. These messages name the component type ('pptx') but give no actionable
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
 * Deduplicate errors by path and message.
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

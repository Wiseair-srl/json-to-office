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

// Components that accept a paragraph-style `indent` prop with the mutually
// exclusive hanging/firstLine pair.
const INDENT_COMPONENT_NAMES = new Set(['paragraph', 'heading']);

/**
 * Collect "hanging and firstLine both set" indent conflicts anywhere in a
 * document.
 *
 * `hanging` and `firstLine` are mutually exclusive on `props.indent` (they both
 * map to the same w:ind axis — Word keeps only one), but each is an optional
 * field on a single object schema, so a payload carrying both passes TypeBox's
 * structural check. Like the image-source walk above, this runs unconditionally
 * and traverses every nested value, so paragraphs inside columns, table cells,
 * text boxes, headers/footers, and sections are all covered.
 */
export function collectIndentConflicts(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  const visit = (node: any, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (INDENT_COMPONENT_NAMES.has(node.name)) {
      const indent = node.props?.indent;
      if (
        indent &&
        typeof indent === 'object' &&
        indent.hanging !== undefined &&
        indent.firstLine !== undefined
      ) {
        errors.push({
          path: `${path}/props/indent`,
          message:
            'Indent accepts either "hanging" or "firstLine", not both. Use exactly one of the two.',
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
 * Collect "notes declared on a revised paragraph" conflicts anywhere in a
 * document.
 *
 * `revision` renders a paragraph's text from its segments as literal runs, so a
 * `[^id]` marker inside them never resolves and the declared note body is never
 * written. The combination is not expressible either: `InsertedTextRun` and
 * `DeletedTextRun` wrap exactly one `TextRun` built from their own options, so
 * `docx` offers no way to put a footnote reference inside `w:ins` / `w:del`
 * without reaching past its public API.
 *
 * Each half is an independent optional field, so a payload carrying both passes
 * TypeBox's structural check. Like the image-source and indent walks above,
 * this runs unconditionally and traverses every nested value, so paragraphs
 * inside columns, table cells, text boxes, headers/footers and sections are all
 * covered.
 */
export function collectNoteRevisionConflicts(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  const visit = (node: any, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    // A paragraph revised directly, or a table cell whose own revision drives
    // the runs of the paragraph inside it — both render the text from segments,
    // so neither can resolve a marker.
    const revisedNotes: { notes: unknown; path: string }[] = [];
    if (node.name === 'paragraph' && node.props?.revision) {
      for (const kind of ['footnotes', 'endnotes'] as const) {
        revisedNotes.push({
          notes: node.props[kind],
          path: `${path}/props/${kind}`,
        });
      }
    }
    if (node.revision && node.content?.name === 'paragraph') {
      for (const kind of ['footnotes', 'endnotes'] as const) {
        revisedNotes.push({
          notes: node.content.props?.[kind],
          path: `${path}/content/props/${kind}`,
        });
      }
    }

    for (const { notes, path: notesPath } of revisedNotes) {
      if (Array.isArray(notes) && notes.length > 0) {
        const kind = notesPath.endsWith('endnotes') ? 'endnotes' : 'footnotes';
        errors.push({
          path: notesPath,
          message:
            `"revision" and "${kind}" cannot apply to the same text. Tracked-change ` +
            'text renders literally, so note markers inside it are not resolved and the ' +
            'note bodies would be dropped. Move the notes to text without a revision.',
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
 * Collect `text-box` requests for a shape rendering that a shape cannot honour,
 * anywhere in a document.
 *
 * `renderAs: 'shape'` emits a WPS DrawingML shape, and two of its limits are
 * decidable from the props alone:
 *
 * - **Size.** A shape carries an absolute extent and has no autofit, so a box
 *   without both `width` and `height` has no size to render at.
 * - **Border style.** docx's outline options carry width, cap, compound and
 *   fill but no `a:prstDash`, so a dash pattern cannot be expressed at all; the
 *   `compoundLine` that could stand in for `double` is emitted as the enum key
 *   (`cmpd="DOUBLE"`) rather than the OOXML value.
 *
 * Both are independently optional fields, so the combination passes TypeBox's
 * structural check. Reporting them here rather than warning at render time puts
 * the fault where the author can fix it — the renderer's own guards degrade to
 * the table rendering, which is silent in an editor that only shows the result.
 *
 * Like the walks above this runs unconditionally over every nested value, so a
 * text box inside columns, a table cell, a header/footer or another text box is
 * covered too. The third render-time fallback — content that renders as a table
 * rather than a paragraph — is deliberately absent: it depends on what the
 * children render to, which no static walk can know.
 */
const UNDASHABLE_BORDER_STYLES = new Set(['dashed', 'dotted', 'double']);

export function collectTextBoxShapeConflicts(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  const visit = (node: any, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (node.name === 'text-box' && node.props?.renderAs === 'shape') {
      const missing = (['width', 'height'] as const).filter(
        (axis) => node.props[axis] === undefined
      );
      if (missing.length > 0) {
        errors.push({
          path: `${path}/props/${missing[0]}`,
          message:
            `A text-box with renderAs "shape" requires ${missing.join(' and ')}: a shape ` +
            'has no autofit, so its size cannot be derived from its content. Give it an ' +
            'explicit size, or use renderAs "table", which grows to fit.',
          code: 'required',
        });
      }

      const border = node.props.style?.border;
      if (border && typeof border === 'object') {
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          const style = border[side]?.style;
          if (
            typeof style === 'string' &&
            UNDASHABLE_BORDER_STYLES.has(style)
          ) {
            errors.push({
              path: `${path}/props/style/border/${side}/style`,
              message:
                `A text-box with renderAs "shape" cannot draw a "${style}" border: a shape ` +
                'outline carries no dash pattern. Use "solid", or use renderAs "table", ' +
                'which draws every border style.',
              code: 'unsupported_value',
            });
          }
        }
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

  // Validate the children array. The root component requires one; nested
  // containers may legitimately omit it.
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

  // Deep-validate the props of every component anywhere in the tree.
  //
  // The earlier implementation only re-validated the root's direct children
  // and one level of `section` children. Two whole-tree blind spots followed:
  //   1. component props nested inside `text-box`/`columns` children — the
  //      content of every container lives in the shared `children` field, so
  //      anything below the first level went unchecked; and
  //   2. the `header`/`footer` paragraph regions, which the section schema
  //      types loosely as an array of `Type.Any()` (or the `'linkToPrevious'`
  //      literal) — so their entries' props are never checked by the
  //      per-section validation.
  // The in-editor (Monaco) validator runs the generated JSON Schema over the
  // entire document, so it flags both. This walk brings the CLI to parity.
  walkComponentTree(data, '', opts, allErrors);

  return allErrors;
}

/**
 * Recursively validate the props of every component nested under `node`.
 *
 * Walks two kinds of child position to any depth:
 *  - the `children` array — the universal container field shared by `docx`,
 *    `section`, `columns` and `text-box` (added by the component registry), so
 *    a bad prop inside a `text-box` or `columns` child is caught however deeply
 *    it is nested; and
 *  - the `header` / `footer` paragraph regions under `props` — typed only
 *    loosely on the section schema (an array of `Type.Any()`, or the
 *    `'linkToPrevious'` literal, which is skipped), so their entries are not
 *    deep-checked by the parent's per-component validation.
 *
 * The node's own props are NOT validated here — the caller validates the root
 * props, and every entry is validated as it is visited. `table` and `list`
 * nest their components inside their own recursive props schemas, so those are
 * already covered by `validateComponentProps` and are intentionally not
 * re-walked here.
 */
function walkComponentTree(
  node: any,
  path: string,
  opts: DeepValidateOptions,
  errors: ValidationError[]
): void {
  if (!node || typeof node !== 'object') return;

  // `strictStructure` controls whether a malformed entry (not an object, or
  // missing `name`) is reported here. It is ON for positions the per-component
  // schema leaves unchecked — the `children` array (a sibling field, never seen
  // by props validation) and the `header`/`footer` regions (typed `Type.Any()`
  // on the static section schema) — so the walk is their only structural
  // checker and must match the whole-tree schema the editor runs. It is OFF for
  // `table` cell content, whose structure the table's own props schema already
  // validates; there the walk only adds the prop-constraint errors the loose
  // cell-content ref misses, so reporting structure too would double-report.
  const validateEntry = (
    child: any,
    childPath: string,
    strictStructure: boolean
  ): void => {
    if (!child || typeof child !== 'object') {
      if (strictStructure) {
        errors.push({
          path: childPath,
          message: 'Component must be an object',
          code: 'invalid_type',
        });
      }
      return;
    }
    if (typeof child.name !== 'string' || child.name.length === 0) {
      if (strictStructure) {
        errors.push({
          path: `${childPath}/name`,
          message: 'Component missing required field "name"',
          code: 'required_property',
        });
      }
      return;
    }

    // Registered plugin components are validated version-aware by the plugin
    // layer; skip their props and subtree so they are neither double-validated
    // nor misreported as unknown.
    if (opts.knownCustomNames?.has(child.name)) return;

    // Validate props against the component's schema. When props is omitted,
    // validate an empty object so the schema decides whether props are
    // required (e.g. `section` needs none; `heading` requires text+level).
    if (child.props != null) {
      errors.push(
        ...validateComponentProps(
          child.name,
          child.props,
          `${childPath}/props`,
          opts
        )
      );
    } else if (child.name !== 'custom') {
      errors.push(
        ...validateComponentProps(child.name, {}, `${childPath}/props`, opts)
      );
    }

    // Recurse so arbitrarily nested containers are covered.
    walkComponentTree(child, childPath, opts, errors);
  };

  // header/footer entries are validated strictly: the static section schema
  // types them as `Type.Any()`, so the editor's whole-tree schema (where they
  // resolve to the component union) is stricter than the per-component check —
  // the walk closes that gap, flagging non-component entries too. A bare
  // `'linkToPrevious'` value is not an array, so it is skipped here.
  for (const region of ['header', 'footer'] as const) {
    const entries = node.props?.[region];
    if (Array.isArray(entries)) {
      entries.forEach((child: any, i: number) =>
        validateEntry(child, `${path}/props/${region}/${i}`, true)
      );
    }
  }

  // `table` nests its cell content under `props` (not the shared `children`
  // field), and the static table schema types that content loosely — the
  // cell-content ref accepts any props object, just like the `Type.Any()`
  // header/footer above. So a bad prop deep in a cell (e.g. `font.size` over the
  // cap) slips past the per-component table check; walk each content component
  // so its props are validated against the real schema. Structural problems
  // with a cell are already reported by the table's own props validation, hence
  // the lenient (`false`) entry check to avoid double-reporting.
  if (node.name === 'table' && Array.isArray(node.props?.columns)) {
    node.props.columns.forEach((col: any, c: number) => {
      if (!col || typeof col !== 'object') return;
      const base = `${path}/props/columns/${c}`;
      const headerContent = col.header?.content;
      if (headerContent && typeof headerContent === 'object') {
        validateEntry(headerContent, `${base}/header/content`, false);
      }
      if (Array.isArray(col.cells)) {
        col.cells.forEach((cell: any, r: number) => {
          const content = cell?.content;
          if (content && typeof content === 'object') {
            validateEntry(content, `${base}/cells/${r}/content`, false);
          }
        });
      }
    });
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child: any, i: number) =>
      validateEntry(child, `${path}/children/${i}`, true)
    );
  } else if (node.children != null && path !== '') {
    // `children` is present but not an array on a nested container. The root's
    // `children` is already checked by deepValidateDocument (skipped here via
    // `path !== ''` so it is not reported twice); this branch covers every
    // deeper container (`section`/`columns`/`text-box`) the old one-level walk
    // never reached. Without it a malformed subtree slips through as valid:
    // TypeBox reports only a generic catch-all (which we strip), so an empty
    // error set would otherwise flip the document back to `valid`.
    errors.push({
      path: `${path}/children`,
      message: 'Field "children" must be an array',
      code: 'invalid_type',
    });
  }
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
    // Unknown component type. `basePath` always ends in `/props`; anchor the
    // swap to the end so a nested region path like `…/props/header/0/props`
    // becomes `…/props/header/0/name` rather than mangling an earlier `/props`.
    errors.push({
      path: basePath.replace(/\/props$/, '/name'),
      message: `Unknown component "${componentName}"`,
      code: 'unknown_component',
    });
    return errors;
  }

  // A props schema may be a union — `visual` is one, discriminated on
  // `renderMode`. Checking the union itself collapses every nested complaint
  // into one generic failure at `/props`, which is the opposite of what deep
  // validation is for, so the branch the author clearly meant is resolved
  // first and the errors are collected against that.
  const branch = selectPropsBranch(schema, props);

  // When unknown fields are explicitly allowed, strip them before checking so
  // additionalProperties:false no longer rejects — required/typed fields are
  // still enforced.
  const toCheck = opts.allowUnknownFields
    ? Value.Clean(branch, Value.Clone(props))
    : props;

  // Use TypeBox to validate against the specific schema
  if (!Value.Check(branch, toCheck)) {
    const valueErrors = [...Value.Errors(branch, toCheck)];
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
 * The branch of a union props schema that an author's props were written
 * against.
 *
 * Resolved by literal discriminator first — a branch stating `renderMode:
 * "native"` claims props that say so, and disclaims props that do not. When no
 * single branch claims them (an unknown discriminator, or none at all), the
 * one that complains least is used: a specific list of what is wrong beats a
 * single "does not match any of the expected formats" every time.
 *
 * A non-union schema is returned untouched, so this costs nothing for the
 * components that are plain objects.
 */
function selectPropsBranch(schema: TSchema, props: unknown): TSchema {
  const branches = (schema as { anyOf?: TSchema[] }).anyOf;
  if (!Array.isArray(branches) || branches.length === 0) return schema;

  const claimed = branches.filter((branch) => claimsProps(branch, props));
  if (claimed.length === 1) return claimed[0]!;

  const candidates = claimed.length > 1 ? claimed : branches;
  let best = candidates[0]!;
  let fewest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const count = [...Value.Errors(candidate, props)].length;
    if (count < fewest) {
      fewest = count;
      best = candidate;
    }
  }
  return best;
}

/** True when every literal-valued property of `branch` agrees with `props`. */
function claimsProps(branch: TSchema, props: unknown): boolean {
  const properties = (branch as { properties?: Record<string, TSchema> })
    .properties;
  if (!properties) return false;
  const required = new Set(
    ((branch as { required?: string[] }).required ?? []) as string[]
  );
  const value = (props ?? {}) as Record<string, unknown>;

  for (const [key, propertySchema] of Object.entries(properties)) {
    const literal = (propertySchema as { const?: unknown }).const;
    if (literal === undefined) continue;
    const present = value[key] !== undefined;
    if (!present) {
      if (required.has(key)) return false;
      continue;
    }
    if (value[key] !== literal) return false;
  }
  return true;
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
    /invalid component configurations?/i.test(msg) ||
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

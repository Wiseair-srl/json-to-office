import { Kind, type TSchema } from '@sinclair/typebox';
import type { ValidationError } from '@json-to-office/shared';
import { NATIVE_RENDER_MODE } from './components/visual';

export const DOCX_RENDERER_IDS = ['docxjs', 'office-open'] as const;
export type DocxRendererId = (typeof DOCX_RENDERER_IDS)[number];
export const DEFAULT_DOCX_RENDERER_ID: DocxRendererId = 'docxjs';

/** The element kinds a native `visual` can hold. */
const NATIVE_VISUAL_ELEMENTS: ReadonlySet<string> = new Set([
  'text',
  'shape',
  'image',
]);

/**
 * The exported JSON-Schema definition name for one renderer's component union.
 *
 * One name per renderer, never a shared one. The two views differ wherever a
 * backend cannot draw something, so a single definition would hand every
 * position that goes through it — a section header or footer, a table cell's
 * content, `componentDefaults` — whichever view the exporter happened to walk
 * last, and give a schema-driven editor the wrong diagnostics for the other
 * renderer.
 */
export function docxComponentDefinitionName(renderer: DocxRendererId): string {
  return `ComponentDefinition_${renderer}`;
}

/**
 * Derive one renderer view from the canonical props schema.
 *
 * The canonical schema is the union of everything any backend can express, so
 * a profile is a *subtraction*: the branches and fields this renderer cannot
 * draw are removed, which is what makes a schema-driven editor offer only what
 * the chosen backend will actually render.
 */
export function docxPropsSchemaForRenderer(
  componentName: string,
  schema: TSchema,
  renderer: DocxRendererId
): TSchema {
  const copy = cloneSchema(schema);
  nameComponentPlaceholders(copy, docxComponentDefinitionName(renderer));

  if (componentName === 'visual' && renderer !== 'office-open') {
    // Only `office-open` draws a native group, so every other backend sees the
    // raster branch alone — a plain object rather than a union, which is what
    // gives an editor one unambiguous completion set.
    return firstUnionBranch(copy) ?? copy;
  }

  if (renderer === 'office-open') pruneThreadFields(copy);
  return copy;
}

/** Static renderer-profile diagnostics used by CLI/library validation. */
export function collectDocxRendererErrors(data: unknown): ValidationError[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const root = data as Record<string, any>;
  const renderer = root.renderer ?? DEFAULT_DOCX_RENDERER_ID;

  if (!DOCX_RENDERER_IDS.includes(renderer)) {
    return [
      {
        path: '/renderer',
        message: `Invalid renderer "${String(renderer)}". Expected "docxjs" or "office-open".`,
        code: 'invalid_value',
      },
    ];
  }

  const errors: ValidationError[] = [];
  const isOfficeOpen = renderer === 'office-open';

  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;

    if (isOfficeOpen) {
      const comment = object.comment;
      if (comment && typeof comment === 'object' && !Array.isArray(comment)) {
        const value = comment as Record<string, unknown>;
        for (const field of ['replies', 'resolved'] as const) {
          if (value[field] !== undefined) {
            errors.push({
              path: `${path}/comment/${field}`,
              message: `The "office-open" renderer does not support comment threads.`,
              code: 'unsupported_renderer_feature',
            });
          }
        }
      }
    }

    if (object.name === 'visual') {
      collectVisualErrors(object, `${path}`, isOfficeOpen, errors);
    }

    // A schema-driven editor already refuses `chart` outside office-open —
    // the component is absent from that branch entirely. This is the same
    // rule stated where a caller reaches validation without the schema, and
    // it names the path of the node rather than the document, so the error
    // lands on the component the author has to move or drop.
    if (object.name === 'chart' && !isOfficeOpen) {
      errors.push({
        path: `${path}/name`,
        message:
          'Only the "office-open" renderer draws a native chart. Set the document\'s "renderer" to "office-open", or use "highcharts" to render one as an image.',
        code: 'unsupported_renderer_feature',
      });
    }

    for (const [key, value] of Object.entries(object)) {
      if (key !== 'renderer') visit(value, `${path}/${key}`);
    }
  };

  visit(root, '');
  return errors;
}

/**
 * Native-mode rules for one `visual` node.
 *
 * Two separate concerns, and both have to name a path an editor can jump to.
 * A backend that cannot draw a group must reject the mode itself, at
 * `props/renderMode`. A backend that can must still reject element kinds that
 * have no native form — otherwise a `chart` inside a native visual would
 * validate and then vanish, which is exactly the failure mode strictness
 * exists to prevent.
 */
function collectVisualErrors(
  node: Record<string, unknown>,
  path: string,
  isOfficeOpen: boolean,
  errors: ValidationError[]
): void {
  const props = node.props;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return;
  const value = props as Record<string, unknown>;
  if (value.renderMode !== NATIVE_RENDER_MODE) return;

  if (!isOfficeOpen) {
    errors.push({
      path: `${path}/props/renderMode`,
      message:
        'Only the "office-open" renderer draws a native visual. Set the document\'s "renderer" to "office-open", or drop "renderMode" to rasterize.',
      code: 'unsupported_renderer_feature',
    });
    return;
  }

  const elements = value.elements;
  if (!Array.isArray(elements)) return;
  elements.forEach((element, index) => {
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      return;
    }
    const name = (element as Record<string, unknown>).name;
    if (typeof name !== 'string' || NATIVE_VISUAL_ELEMENTS.has(name)) return;
    errors.push({
      path: `${path}/props/elements/${index}/name`,
      message:
        `A native visual cannot draw "${name}". Native mode holds "text", ` +
        '"shape" and "image"; use renderMode "raster" for anything else.',
      code: 'unsupported_renderer_feature',
    });
  });
}

/** The first branch of a union schema, if this is one. */
function firstUnionBranch(schema: TSchema): TSchema | undefined {
  const branches = (schema as { anyOf?: TSchema[] }).anyOf;
  return Array.isArray(branches) && branches.length > 0
    ? branches[0]
    : undefined;
}

function pruneThreadFields(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(pruneThreadFields);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const schema = node as Record<PropertyKey, any>;
  const properties = schema.properties as Record<string, TSchema> | undefined;
  if (
    properties?.text &&
    properties?.author &&
    (properties.replies || properties.resolved) &&
    typeof schema.description === 'string' &&
    schema.description.includes('Word review comment')
  ) {
    delete properties.replies;
    delete properties.resolved;
    const required = schema.required as string[] | undefined;
    if (required) {
      schema.required = required.filter(
        (key) => key !== 'replies' && key !== 'resolved'
      );
    }
  }
  for (const key of Reflect.ownKeys(schema)) {
    pruneThreadFields(schema[key]);
  }
}

/**
 * Point a renderer's props at that renderer's component definition.
 *
 * A position that holds arbitrary components but is built from a *static*
 * schema carries an untyped item instead of a live recursive ref —
 * `componentDefaults.section.header` is the one that matters, because
 * `ComponentDefaultsSchema` is shared with the theme and so cannot be handed
 * the recursion. The export pass used to resolve those against one hard-coded
 * name; naming them here, while the renderer is still known and the schema is
 * still this renderer's private clone, is what keeps the two views apart.
 */
function nameComponentPlaceholders(
  node: unknown,
  definitionName: string
): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => nameComponentPlaceholders(entry, definitionName));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const schema = node as Record<PropertyKey, any>;

  if (
    schema.type === 'array' &&
    schema.items &&
    typeof schema.items === 'object' &&
    Object.keys(schema.items).length === 0 &&
    schema.items[Kind] === 'Any'
  ) {
    // A bare name, the same shape `Type.Recursive` emits for its own self
    // reference. `fixSchemaReferences` resolves both to `#/definitions/...`.
    schema.items = { $ref: definitionName };
  }

  for (const key of Reflect.ownKeys(schema)) {
    nameComponentPlaceholders(schema[key], definitionName);
  }
}

function cloneSchema<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneSchema) as T;
  if (!value || typeof value !== 'object') return value;
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value as object)) {
    copy[key] = cloneSchema((value as any)[key]);
  }
  return copy;
}

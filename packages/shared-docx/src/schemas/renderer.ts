import type { TSchema } from '@sinclair/typebox';
import type { ValidationError } from '@json-to-office/shared';

export const DOCX_RENDERER_IDS = ['docxjs', 'office-open'] as const;
export type DocxRendererId = (typeof DOCX_RENDERER_IDS)[number];
export const DEFAULT_DOCX_RENDERER_ID: DocxRendererId = 'docxjs';

/** Derive one renderer view from the canonical props schema. */
export function docxPropsSchemaForRenderer(
  schema: TSchema,
  renderer: DocxRendererId
): TSchema {
  const copy = cloneSchema(schema);
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
  if (renderer !== 'office-open') return [];

  const errors: ValidationError[] = [];
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
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
    for (const [key, value] of Object.entries(object)) {
      if (key !== 'renderer') visit(value, `${path}/${key}`);
    }
  };

  visit(root, '');
  return errors;
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

function cloneSchema<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneSchema) as T;
  if (!value || typeof value !== 'object') return value;
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value as object)) {
    copy[key] = cloneSchema((value as any)[key]);
  }
  return copy;
}

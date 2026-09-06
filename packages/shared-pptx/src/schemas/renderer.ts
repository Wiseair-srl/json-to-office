import type { TSchema } from '@sinclair/typebox';
import type { ValidationError } from '@json-to-office/shared';

export const PPTX_RENDERER_IDS = ['pptxgenjs', 'office-open'] as const;
export type PptxRendererId = (typeof PPTX_RENDERER_IDS)[number];
export const DEFAULT_PPTX_RENDERER_ID: PptxRendererId = 'pptxgenjs';

/**
 * The exported JSON-Schema definition name for one renderer's component
 * union. One name per renderer, as for DOCX: TypeBox's own ordinals (`T4`,
 * `T5`) shift with how many recursive schemas the process built before this
 * one, and the block-body authoring schemas are derived by name from the
 * definition they narrow.
 */
export function pptxComponentDefinitionName(renderer: PptxRendererId): string {
  return `PptxComponentDefinition_${renderer}`;
}

/**
 * Renderer-specific view of one canonical component props schema.
 *
 * This is intentionally a pruning pass rather than a second schema tree. The
 * compiler capability gate remains authoritative for requirements that depend
 * on resolved assets or expanded custom components.
 */
export function pptxPropsSchemaForRenderer(
  componentName: string,
  schema: TSchema,
  renderer: PptxRendererId
): TSchema {
  const copy = cloneSchema(schema);
  const properties = objectProperties(copy);

  if (renderer === 'pptxgenjs') {
    if (componentName === 'slide') delete properties?.transition;
    return copy;
  }

  switch (componentName) {
    case 'image':
      for (const key of ['svg', 'sizing', 'rotate', 'rounding', 'hyperlink']) {
        delete properties?.[key];
      }
      break;
    case 'shape':
      delete properties?.flipV;
      break;
    case 'table':
      for (const key of [
        'autoPage',
        'autoPageRepeatHeader',
        'margin',
        'borderRadius',
      ]) {
        delete properties?.[key];
      }
      pruneOfficeOpenTableCells(copy);
      break;
  }

  syncRequired(copy);
  return copy;
}

/** Static renderer-profile diagnostics used by CLI/library validation. */
export function collectPptxRendererErrors(data: unknown): ValidationError[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const root = data as Record<string, any>;
  const renderer = root.renderer ?? DEFAULT_PPTX_RENDERER_ID;

  if (!PPTX_RENDERER_IDS.includes(renderer)) {
    return [
      {
        path: '/renderer',
        message: `Invalid renderer "${String(renderer)}". Expected "pptxgenjs" or "office-open".`,
        code: 'invalid_value',
      },
    ];
  }

  const errors: ValidationError[] = [];
  const unsupported = (path: string, feature: string): void => {
    errors.push({
      path,
      message: `The "${renderer}" renderer does not support ${feature}.`,
      code: 'unsupported_renderer_feature',
    });
  };

  const visit = (node: any, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    const props = node.props;
    if (renderer === 'pptxgenjs') {
      if (node.name === 'slide' && props?.transition !== undefined) {
        unsupported(`${path}/props/transition`, 'slide transitions');
      }
    } else {
      // Every chart type but one. `@office-open` spells a bubble series as
      // `xValues`/`yValues`/`bubbleSize` rather than categories and values,
      // and there is no unambiguous reading of a category label as a numeric
      // x — so it is refused rather than guessed at. Reaching the backend with
      // the wrong shape throws a TypeError from inside it, which is the worst
      // of the three outcomes.
      if (node.name === 'chart' && props?.type === 'bubble') {
        unsupported(`${path}/props/type`, 'bubble charts');
      }
      if (node.name === 'image') {
        const fields: Record<string, string> = {
          svg: 'SVG images',
          sizing: 'image cropping',
          rotate: 'image transforms',
          rounding: 'image rounding',
          hyperlink: 'element hyperlinks',
        };
        for (const [field, feature] of Object.entries(fields)) {
          if (props?.[field] !== undefined) {
            unsupported(`${path}/props/${field}`, feature);
          }
        }
      }
      if (node.name === 'shape' && props?.flipV !== undefined) {
        unsupported(`${path}/props/flipV`, 'vertical flipping');
      }
      if (node.name === 'table') {
        const fields: Record<string, string> = {
          autoPage: 'table auto-pagination',
          autoPageRepeatHeader: 'table auto-pagination',
          margin: 'table insets',
          borderRadius: 'rounded table corners',
        };
        for (const [field, feature] of Object.entries(fields)) {
          if (props?.[field] !== undefined) {
            unsupported(`${path}/props/${field}`, feature);
          }
        }
        if (Array.isArray(props?.rows)) {
          props.rows.forEach((row: unknown[], rowIndex: number) => {
            if (!Array.isArray(row)) return;
            row.forEach((cell, cellIndex) => {
              if (!cell || typeof cell !== 'object') return;
              for (const [field, feature] of [
                ['colspan', 'merged table cells'],
                ['rowspan', 'merged table cells'],
                ['margin', 'table insets'],
              ] as const) {
                if ((cell as Record<string, unknown>)[field] !== undefined) {
                  unsupported(
                    `${path}/props/rows/${rowIndex}/${cellIndex}/${field}`,
                    feature
                  );
                }
              }
            });
          });
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key !== 'renderer') visit(value, `${path}/${key}`);
    }
  };

  visit(root, '');
  return errors;
}

function pruneOfficeOpenTableCells(schema: TSchema): void {
  const rows = objectProperties(schema)?.rows as any;
  const cellUnion = rows?.items?.items;
  const branches = cellUnion?.anyOf;
  if (!Array.isArray(branches)) return;
  for (const branch of branches) {
    const properties = objectProperties(branch);
    if (!properties?.text) continue;
    delete properties.colspan;
    delete properties.rowspan;
    delete properties.margin;
    syncRequired(branch);
  }
}

function objectProperties(
  schema: unknown
): Record<string, TSchema> | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  return (schema as { properties?: Record<string, TSchema> }).properties;
}

function syncRequired(schema: TSchema): void {
  const properties = objectProperties(schema);
  const required = (schema as { required?: string[] }).required;
  if (!properties || !required) return;
  const next = required.filter((key) => key in properties);
  if (next.length > 0) (schema as { required?: string[] }).required = next;
  else delete (schema as { required?: string[] }).required;
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

/**
 * flattenVisuals — desugar `visual` components to plain `image` components ahead
 * of time, producing a portable, service-free `.docx.json`.
 *
 * The normal pipeline rasterizes `visual` nodes at render time via
 * `services.pptx`. This transform does the same desugaring offline: walk the
 * document tree, rasterize each `visual` with the supplied rasterizer, and
 * replace it with `{ name: 'image', props: { base64, ... } }`. The result builds
 * with no rasterization service configured — handy for shipping documents that
 * generate on hosts without LibreOffice/poppler.
 *
 * The walk covers every place the docx model can hold a child component, not
 * just `children`: section `props.header`/`props.footer`, and table
 * `props.columns[].cells[].content` / `props.columns[].header.content`.
 */

import {
  clampVisualDpi,
  DEFAULT_VISUAL_DPI,
  type PptxRasterizer,
} from '@json-to-office/shared';
import type { VisualProps } from '@json-to-office/shared-docx';
import {
  buildVisualPresentation,
  visualToImageProps,
} from '../components/visual';

const DEFAULT_CONCURRENCY = 4;

export interface FlattenVisualsOptions {
  /** Rasterizer that turns a single-slide pptx presentation into a PNG. */
  rasterize: PptxRasterizer;
  /** Default DPI applied when a `visual` does not specify one (default 200). */
  dpi?: number;
  /** Max concurrent rasterizations (default 4). */
  concurrency?: number;
}

interface FlattenCtx {
  rasterize: PptxRasterizer;
  dpi?: number;
  limit: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Minimal promise pool bounding concurrent rasterizations. */
function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max)
      await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/**
 * Return a deep copy of `doc` with every `visual` node replaced by the `image`
 * node it rasterizes to. Visuals rasterize with bounded concurrency. A
 * `visual` with `enabled: false` is left untouched (it's filtered out at render
 * anyway, so rasterizing it would be wasted work). Non-visual nodes are copied
 * structurally and otherwise unchanged.
 */
export async function flattenVisuals<T = unknown>(
  doc: T,
  options: FlattenVisualsOptions
): Promise<T> {
  const ctx: FlattenCtx = {
    rasterize: options.rasterize,
    dpi: options.dpi,
    limit: createLimiter(
      Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
    ),
  };
  return (await flattenNode(doc, ctx)) as T;
}

async function rasterizeVisual(
  obj: Record<string, unknown>,
  ctx: FlattenCtx
): Promise<Record<string, unknown>> {
  const props = obj.props as VisualProps;
  const dpi = clampVisualDpi(props.dpi ?? ctx.dpi ?? DEFAULT_VISUAL_DPI);
  const result = await ctx.limit(() =>
    ctx.rasterize({ presentation: buildVisualPresentation(props), dpi })
  );
  const image: Record<string, unknown> = {
    name: 'image',
    props: visualToImageProps(props, result.base64DataUri),
  };
  // Preserve identity/visibility metadata from the original node.
  if (obj.id !== undefined) image.id = obj.id;
  if (obj.enabled !== undefined) image.enabled = obj.enabled;
  return image;
}

async function flattenNode(node: unknown, ctx: FlattenCtx): Promise<unknown> {
  if (Array.isArray(node)) {
    return Promise.all(node.map((n) => flattenNode(n, ctx)));
  }
  if (!node || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;

  // Replace an enabled visual with its rasterized image. A disabled visual is
  // left as-is (filtered at render; rasterizing it would be wasted work).
  if (obj.name === 'visual' && obj.props && obj.enabled !== false) {
    return rasterizeVisual(obj, ctx);
  }

  const next: Record<string, unknown> = { ...obj };

  if (Array.isArray(obj.children)) {
    next.children = await flattenNode(obj.children, ctx);
  }

  if (obj.props && typeof obj.props === 'object') {
    const props = obj.props as Record<string, unknown>;
    let propsChanged = false;
    const nextProps: Record<string, unknown> = { ...props };

    // Section header/footer: arrays of component definitions (or a literal
    // 'linkToPrevious' string, which flattenNode returns unchanged).
    for (const key of ['header', 'footer'] as const) {
      if (Array.isArray(props[key])) {
        nextProps[key] = await flattenNode(props[key], ctx);
        propsChanged = true;
      }
    }

    // Table columns: each cell's `content` and the column header's `content`
    // hold a component definition (or a string).
    if (Array.isArray(props.columns)) {
      nextProps.columns = await Promise.all(
        (props.columns as unknown[]).map((col) => flattenColumn(col, ctx))
      );
      propsChanged = true;
    }

    if (propsChanged) next.props = nextProps;
  }

  return next;
}

async function flattenColumn(col: unknown, ctx: FlattenCtx): Promise<unknown> {
  if (!col || typeof col !== 'object') return col;
  const column = col as Record<string, unknown>;
  const nextCol: Record<string, unknown> = { ...column };

  const header = column.header as Record<string, unknown> | undefined;
  if (header && typeof header === 'object' && 'content' in header) {
    nextCol.header = {
      ...header,
      content: await flattenNode(header.content, ctx),
    };
  }

  if (Array.isArray(column.cells)) {
    nextCol.cells = await Promise.all(
      (column.cells as unknown[]).map(async (cell) => {
        if (cell && typeof cell === 'object' && 'content' in cell) {
          const c = cell as Record<string, unknown>;
          return { ...c, content: await flattenNode(c.content, ctx) };
        }
        return cell;
      })
    );
  }

  return nextCol;
}

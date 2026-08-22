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
  type PptxBatchRasterizer,
  type RasterizeFontFace,
} from '@json-to-office/shared';
import type { VisualProps } from '@json-to-office/shared-docx';
import {
  buildVisualPresentation,
  visualRasterKey,
  visualToImageProps,
} from '../components/visual';
import { createLimiter } from '../utils/promiseLimiter';
import { transformComponents, withNodeIdentity } from './componentTransform';
import { prerasterizeVisuals } from './prerasterizeVisuals';

const DEFAULT_CONCURRENCY = 4;

export interface FlattenVisualsOptions {
  /** Rasterizer that turns a single-slide pptx presentation into a PNG. */
  rasterize: PptxRasterizer;
  /**
   * Batch rasterizer (#153). When provided, all visuals are collected and
   * rasterized together up front; `rasterize` remains the per-visual
   * fallback for batch failures and anything the collection missed.
   */
  rasterizeBatch?: PptxBatchRasterizer;
  /** Default DPI applied when a `visual` does not specify one (default 200). */
  dpi?: number;
  /** Max concurrent rasterizations (default 4). */
  concurrency?: number;
  /**
   * Directory that relative asset paths inside visuals resolve against —
   * the document's own directory. Absent → the rasterizer's cwd (#142).
   */
  baseDir?: string;
  /**
   * Font faces staged for each visual's LibreOffice render. Without these a
   * flattened document bakes in fontless PNGs permanently — the flatten
   * output is a portable, service-free `.docx.json`, so there is no second
   * chance to re-rasterize with the right fonts.
   */
  fonts?: readonly RasterizeFontFace[];
}

interface FlattenCtx {
  rasterize: PptxRasterizer;
  dpi?: number;
  baseDir?: string;
  fonts?: readonly RasterizeFontFace[];
  limit: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Return a deep copy of `doc` with every `visual` node replaced by the `image`
 * node it rasterizes to. With `rasterizeBatch`, visuals are pre-rasterized in
 * batches and the tree walk resolves from the batch results; otherwise (and
 * for any batch miss) visuals rasterize per-node with bounded concurrency. A
 * `visual` with `enabled: false` is left untouched (it's filtered out at render
 * anyway, so rasterizing it would be wasted work). Non-visual nodes are copied
 * structurally and otherwise unchanged.
 */
export async function flattenVisuals<T = unknown>(
  doc: T,
  options: FlattenVisualsOptions
): Promise<T> {
  let rasterize = options.rasterize;

  if (options.rasterizeBatch) {
    // The pre-pass keys results exactly like the walk below computes its
    // requests (in-process semantics: no serverUrl), so hits are exact. A
    // pre-pass failure must not fail the flatten — misses below rasterize
    // per-visual exactly as they did before batching existed.
    const preRasterized = await prerasterizeVisuals(
      doc,
      {
        render: options.rasterize,
        renderBatch: options.rasterizeBatch,
        dpi: options.dpi,
      },
      {
        baseDir: options.baseDir,
        concurrency: options.concurrency,
        fonts: options.fonts,
      }
    ).catch(() => new Map<string, never>());
    rasterize = async (request) => {
      const hit = preRasterized.get(
        visualRasterKey(request.presentation, request.dpi)
      );
      if (hit) {
        if (!hit.ok) throw new Error(hit.error);
        return {
          base64DataUri: hit.base64DataUri,
          width: hit.width,
          height: hit.height,
        };
      }
      return options.rasterize(request);
    };
  }

  const ctx: FlattenCtx = {
    rasterize,
    dpi: options.dpi,
    baseDir: options.baseDir,
    fonts: options.fonts,
    limit: createLimiter(
      Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
    ),
  };
  return transformComponents(doc, async (node) =>
    // A disabled visual is left as-is: it is filtered out at render anyway, so
    // rasterizing it would be wasted work.
    node.name === 'visual' && node.enabled !== false
      ? rasterizeVisual(node, ctx)
      : undefined
  );
}

async function rasterizeVisual(
  obj: Record<string, unknown>,
  ctx: FlattenCtx
): Promise<Record<string, unknown>> {
  const props = obj.props as VisualProps;
  const dpi = clampVisualDpi(props.dpi ?? ctx.dpi ?? DEFAULT_VISUAL_DPI);
  const result = await ctx.limit(() =>
    ctx.rasterize({
      presentation: buildVisualPresentation(props),
      dpi,
      baseDir: ctx.baseDir,
      ...(ctx.fonts?.length ? { fonts: [...ctx.fonts] } : {}),
    })
  );
  return withNodeIdentity(obj, {
    name: 'image',
    props: visualToImageProps(props, result.base64DataUri),
  });
}

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
 */

import type { PptxRasterizer } from '@json-to-office/shared';
import type { VisualProps } from '@json-to-office/shared-docx';
import {
  buildVisualPresentation,
  visualToImageProps,
} from '../components/visual';

const DEFAULT_DPI = 200;

export interface FlattenVisualsOptions {
  /** Rasterizer that turns a single-slide pptx presentation into a PNG. */
  rasterize: PptxRasterizer;
  /** Default DPI applied when a `visual` does not specify one (default 200). */
  dpi?: number;
}

/**
 * Return a deep copy of `doc` with every `visual` node replaced by the `image`
 * node it rasterizes to. Visuals are processed sequentially to avoid spawning
 * many LibreOffice processes at once. Non-visual nodes are untouched.
 */
export async function flattenVisuals<T = unknown>(
  doc: T,
  options: FlattenVisualsOptions
): Promise<T> {
  return (await flattenNode(doc, options)) as T;
}

async function flattenNode(
  node: unknown,
  options: FlattenVisualsOptions
): Promise<unknown> {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) out.push(await flattenNode(item, options));
    return out;
  }

  if (!node || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;

  if (obj.name === 'visual' && obj.props) {
    const props = obj.props as VisualProps;
    const dpi = props.dpi ?? options.dpi ?? DEFAULT_DPI;
    const result = await options.rasterize({
      presentation: buildVisualPresentation(props),
      dpi,
    });
    const image: Record<string, unknown> = {
      name: 'image',
      props: visualToImageProps(props, result.base64DataUri),
    };
    // Preserve identity/visibility metadata from the original node.
    if (obj.id !== undefined) image.id = obj.id;
    if (obj.enabled !== undefined) image.enabled = obj.enabled;
    return image;
  }

  if (Array.isArray(obj.children)) {
    return { ...obj, children: await flattenNode(obj.children, options) };
  }

  return node;
}

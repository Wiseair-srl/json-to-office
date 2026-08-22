/**
 * The `visual` component: a free-canvas graphic authored as a single pptx
 * slide.
 *
 * Nothing here renders a document. A visual has no OOXML form of its own — an
 * injected rasterization service (`services.pptx`) draws the slide into a PNG
 * and it becomes a plain `image`, exactly as a `highcharts` becomes one. What
 * lives here is the presentation that gets sent, the identity that keys the
 * batch, and the image props the result desugars to.
 */

import { createHash } from 'crypto';
import { isNodeEnvironment } from '../utils/environment';
import { resolveServiceUrl, postJsonToService } from '../utils/serviceClient';

import type { VisualProps } from '@json-to-office/shared-docx';
import type {
  PptxServiceConfig,
  PptxRasterizeResult,
  RasterizeFontFace,
} from '@json-to-office/shared';

export const DEFAULT_RASTERIZE_SERVER_URL = 'http://localhost:7802';
/** 1 inch = 96 CSS pixels — used to size the embedded image at its physical canvas size. */
const PIXELS_PER_INCH = 96;

/**
 * Build a single-slide pptx presentation component definition from visual props.
 * The shape mirrors a normal `.pptx.json` document so the pptx engine renders
 * it unchanged. Exported for reuse by the `flattenVisuals` transform.
 */
export function buildVisualPresentation(
  props: VisualProps
): Record<string, unknown> {
  const { canvas, elements } = props;

  const presentationProps: Record<string, unknown> = {
    slideWidth: canvas.width,
    slideHeight: canvas.height,
  };
  if (canvas.theme) presentationProps.theme = canvas.theme;

  const slideProps: Record<string, unknown> = {};
  if (canvas.background) slideProps.background = canvas.background;

  return {
    name: 'pptx',
    props: presentationProps,
    children: [
      {
        name: 'slide',
        props: slideProps,
        children: elements ?? [],
      },
    ],
  };
}

/**
 * Where an image sits on the page, and how big it is.
 *
 * The authoring surface of the `image` component a visual desugars into, so
 * this is the shape a visual's placement props have to land in.
 */
export interface ImageOptions {
  caption?: string;
  width?: number | string;
  height?: number | string;
  widthRelativeTo?: 'content' | 'page';
  heightRelativeTo?: 'content' | 'page';
  alignment?: 'left' | 'center' | 'right';
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
  floating?: {
    horizontalPosition?: {
      relative?: 'character' | 'column' | 'margin' | 'page' | 'text';
      align?: 'left' | 'center' | 'right' | 'inside' | 'outside';
      offset?: number | string;
    };
    verticalPosition?: {
      relative?: 'margin' | 'page' | 'paragraph' | 'line' | 'text';
      align?: 'top' | 'center' | 'bottom' | 'inside' | 'outside';
      offset?: number | string;
    };
    wrap?: {
      // 'tight', 'around', 'through' are VML-style; only 'none', 'square', 'topAndBottom' are supported for images
      type: 'none' | 'square' | 'topAndBottom' | 'around' | 'tight' | 'through';
      side?: 'bothSides' | 'left' | 'right' | 'largest';
      margins?: {
        top?: number | string;
        bottom?: number | string;
        left?: number | string;
        right?: number | string;
      };
    };
    allowOverlap?: boolean;
    behindDocument?: boolean;
    lockAnchor?: boolean;
    layoutInCell?: boolean;
    zIndex?: number;
    rotation?: number;
    visibility?: 'hidden' | 'inherit';
  };
  // Keep paragraph with next paragraph
  keepNext?: boolean;
  // Keep all lines of paragraph together
  keepLines?: boolean;
}

/**
 * Default rendered width (px) for a visual: its physical canvas inches, so a
 * 6×4 canvas prints 6×4 unless `width` overrides.
 */
export function defaultVisualWidthPx(props: VisualProps): number {
  return Math.round(props.canvas.width * PIXELS_PER_INCH);
}

/**
 * Shared image-placement options derived from a visual's props. Used by BOTH
 * desugaring paths — the generation pre-pass and the offline flatten transform
 * — so the two cannot drift: width default, alignment default, caption,
 * spacing, floating and the keep flags all live here once.
 */
export function visualToImageOptions(props: VisualProps): ImageOptions {
  return {
    width: props.width ?? defaultVisualWidthPx(props),
    ...(props.height !== undefined && { height: props.height }),
    alignment: props.alignment ?? 'center',
    ...(props.caption !== undefined && { caption: props.caption }),
    ...(props.spacing !== undefined && { spacing: props.spacing }),
    ...(props.floating !== undefined && { floating: props.floating }),
    ...(props.keepNext !== undefined && { keepNext: props.keepNext }),
    ...(props.keepLines !== undefined && { keepLines: props.keepLines }),
  };
}

/**
 * Map visual props to the `image` props they desugar to (used by the
 * `flattenVisuals` transform to produce a portable, service-free document).
 */
export function visualToImageProps(
  props: VisualProps,
  base64DataUri: string
): Record<string, unknown> {
  return {
    base64: base64DataUri,
    ...visualToImageOptions(props),
    ...(props.alt !== undefined && { alt: props.alt }),
  };
}

/**
 * Identity of one visual rasterization: content + resolution + (for HTTP
 * services) the target server. Keys the per-document pre-rasterization map
 * (#153); the pre-pass and the render-time lookup MUST use this one function
 * so the two sides cannot drift.
 *
 * FONTS ARE DELIBERATELY NOT PART OF THIS KEY. The map is built and consumed
 * inside a single `renderDocument` call, which has exactly one font set, so
 * the pre-pass and the render-time lookup can never disagree about fonts.
 * The load-bearing font key is the RASTERIZER's on-disk cache key, which is
 * process-wide and shared across documents and users — see `fontsDigest` in
 * jto-cli's pptx-rasterizer.ts.
 */
export function visualRasterKey(
  presentation: unknown,
  dpi: number,
  serverUrl?: string
): string {
  return createHash('sha256')
    .update(JSON.stringify({ p: presentation, d: dpi, u: serverUrl ?? null }))
    .digest('hex');
}

/**
 * The serverUrl that actually differentiates a visual's rasterization. An
 * in-process `render` callback takes precedence over any serverUrl —
 * per-visual or config — so overrides only matter when rasterization would
 * go over HTTP. Deliberately keyed on `render` alone (NOT `renderBatch`):
 * per-visual fallbacks always go through `rasterizeVisualSlide`, which only
 * consults `render`, and pre-pass inclusion must match what a fallback would
 * actually do or the same visual could rasterize against two different
 * services depending on cache luck.
 */
export function effectiveVisualServerUrl(
  props: VisualProps,
  serviceConfig: PptxServiceConfig | undefined
): string | undefined {
  if (serviceConfig?.render) return undefined;
  return props.serverUrl;
}

/**
 * Rasterize a single-slide presentation to a PNG via the configured service.
 * An in-process `render` callback takes precedence over an HTTP `serverUrl`.
 * Exported for the pre-rasterization pass, whose per-visual fallback must
 * behave exactly like render-time rasterization.
 */
export async function rasterizeVisualSlide(
  presentation: Record<string, unknown>,
  dpi: number,
  propsServerUrl: string | undefined,
  serviceConfig: PptxServiceConfig | undefined,
  baseDir: string | undefined,
  /**
   * Document fonts staged for the rasterizer's LibreOffice launch. Added
   * conditionally below so a fontless document's request body stays exactly
   * what it was before fonts existed.
   */
  fonts?: readonly RasterizeFontFace[]
): Promise<PptxRasterizeResult> {
  if (!isNodeEnvironment()) {
    throw new Error(
      'Visual rasterization requires a Node.js environment. ' +
        'It is not available in browser environments.'
    );
  }

  // In-process renderer wins (ideal for tests and single-process hosts).
  if (serviceConfig?.render) {
    return serviceConfig.render({
      presentation,
      dpi,
      baseDir,
      ...(fonts?.length ? { fonts: [...fonts] } : {}),
    });
  }

  const serverUrl = resolveServiceUrl(
    propsServerUrl,
    serviceConfig?.serverUrl,
    DEFAULT_RASTERIZE_SERVER_URL
  );

  const response = await postJsonToService({
    url: serverUrl,
    path: '/rasterize',
    body: {
      presentation,
      dpi,
      ...(baseDir !== undefined && { baseDir }),
      ...(fonts?.length ? { fonts } : {}),
    },
    headers: serviceConfig?.headers,
    serviceLabel: 'PPTX rasterization service',
    onUnreachable: (url, cause) =>
      `PPTX rasterization service is not reachable at ${url}. ` +
      'Configure services.pptx with a `render` callback or a running `serverUrl`.\n' +
      `Cause: ${cause}`,
  });

  let result: PptxRasterizeResult;
  try {
    result = (await response.json()) as PptxRasterizeResult;
  } catch {
    throw new Error(
      'PPTX rasterization service returned a non-JSON response (expected { base64DataUri, width, height }).'
    );
  }
  if (!result?.base64DataUri) {
    throw new Error(
      'PPTX rasterization service returned a malformed response (missing base64DataUri).'
    );
  }
  return result;
}

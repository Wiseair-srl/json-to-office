/**
 * Visual Component
 *
 * Renders a free-canvas graphic authored as a single pptx slide and embeds it
 * as a rasterized PNG. The slide is rendered to an image by an injected
 * rasterization service (`services.pptx`) — exactly the way the `highcharts`
 * component offloads chart rendering to an export server — then desugars to a
 * plain `image`.
 */

import { createHash } from 'crypto';
import { Paragraph, Table } from 'docx';
import {
  ComponentDefinition,
  RenderContext,
  isVisualComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { createImage, type ImageOptions } from '../core/content';
import { isNodeEnvironment } from '../utils/environment';
import { getBaseDir } from '../utils/generationContext';
import { resolveServiceUrl, postJsonToService } from '../utils/serviceClient';

import type { VisualProps } from '@json-to-office/shared-docx';
import {
  clampVisualDpi,
  DEFAULT_VISUAL_DPI,
  type PptxServiceConfig,
  type PptxRasterizeResult,
  type RasterizeFontFace,
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
 * Default rendered width (px) for a visual: its physical canvas inches, so a
 * 6×4 canvas prints 6×4 unless `width` overrides.
 */
export function defaultVisualWidthPx(props: VisualProps): number {
  return Math.round(props.canvas.width * PIXELS_PER_INCH);
}

/**
 * Shared image-placement options derived from a visual's props. Used by BOTH
 * the render-time createImage call and the flatten transform so the two
 * desugaring paths can't drift (width default, alignment default, caption,
 * spacing, floating, keepNext/keepLines all live here once).
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

/**
 * Render visual component
 */
export async function renderVisualComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName?: string,
  context?: RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!isVisualComponent(component)) return [];

  const props = component.props as VisualProps;
  const serviceConfig = context?.services?.pptx;

  const presentation = buildVisualPresentation(props);
  const dpi = clampVisualDpi(
    props.dpi ?? serviceConfig?.dpi ?? DEFAULT_VISUAL_DPI
  );

  // The per-document pre-pass batch-rasterizes visuals ahead of rendering
  // (#153). A hit uses those pixels; a recorded per-visual failure surfaces
  // here, where the error is attributable to this component. Any miss falls
  // through to per-visual rasterization, so the pre-pass can never make a
  // render worse than the sequential path.
  const preRasterized = context?.visualRasterResults?.get(
    visualRasterKey(
      presentation,
      dpi,
      effectiveVisualServerUrl(props, serviceConfig)
    )
  );

  let result: PptxRasterizeResult;
  if (preRasterized) {
    if (!preRasterized.ok) throw new Error(preRasterized.error);
    result = preRasterized;
  } else {
    // Relative asset paths inside the visual's nested presentation must
    // resolve against the same base directory as the docx document itself —
    // the rasterizer runs in another process/cwd (#142).
    result = await rasterizeVisualSlide(
      presentation,
      dpi,
      props.serverUrl,
      serviceConfig,
      getBaseDir(),
      context?.visualFonts
    );
  }

  // Size and placement options are derived once in visualToImageOptions (shared
  // with the flatten transform): default width = canvas physical inches; height
  // left unset so aspect ratio is preserved from the PNG.
  return await createImage(
    result.base64DataUri,
    theme,
    themeName,
    visualToImageOptions(props)
  );
}

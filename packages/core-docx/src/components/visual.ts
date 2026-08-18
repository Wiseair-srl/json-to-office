/**
 * Visual Component
 *
 * Renders a free-canvas graphic authored as a single pptx slide and embeds it
 * as a rasterized PNG. The slide is rendered to an image by an injected
 * rasterization service (`services.pptx`) — exactly the way the `highcharts`
 * component offloads chart rendering to an export server — then desugars to a
 * plain `image`.
 */

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
} from '@json-to-office/shared';

const DEFAULT_RASTERIZE_SERVER_URL = 'http://localhost:7802';
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
 * Rasterize a single-slide presentation to a PNG via the configured service.
 * An in-process `render` callback takes precedence over an HTTP `serverUrl`.
 */
async function rasterize(
  presentation: Record<string, unknown>,
  dpi: number,
  propsServerUrl: string | undefined,
  serviceConfig: PptxServiceConfig | undefined,
  baseDir: string | undefined
): Promise<PptxRasterizeResult> {
  if (!isNodeEnvironment()) {
    throw new Error(
      'Visual rasterization requires a Node.js environment. ' +
        'It is not available in browser environments.'
    );
  }

  // In-process renderer wins (ideal for tests and single-process hosts).
  if (serviceConfig?.render) {
    return serviceConfig.render({ presentation, dpi, baseDir });
  }

  const serverUrl = resolveServiceUrl(
    propsServerUrl,
    serviceConfig?.serverUrl,
    DEFAULT_RASTERIZE_SERVER_URL
  );

  const response = await postJsonToService({
    url: serverUrl,
    path: '/rasterize',
    body: { presentation, dpi, ...(baseDir !== undefined && { baseDir }) },
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

  // Relative asset paths inside the visual's nested presentation must
  // resolve against the same base directory as the docx document itself —
  // the rasterizer runs in another process/cwd (#142).
  const result = await rasterize(
    presentation,
    dpi,
    props.serverUrl,
    serviceConfig,
    getBaseDir()
  );

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

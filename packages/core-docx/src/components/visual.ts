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
import { createImage } from '../core/content';
import { isNodeEnvironment } from '../utils/environment';

import type { VisualProps } from '@json-to-office/shared-docx';
import type {
  PptxServiceConfig,
  PptxRasterizeResult,
} from '@json-to-office/shared';

const DEFAULT_RASTERIZE_SERVER_URL = 'http://localhost:7802';
const DEFAULT_DPI = 200;
/** 1 inch = 96 CSS pixels — used to size the embedded image at its physical canvas size. */
const PIXELS_PER_INCH = 96;

/**
 * Build a single-slide pptx presentation component definition from visual props.
 * The shape mirrors a normal `.pptx.json` document so the pptx engine renders
 * it unchanged.
 */
function buildPresentation(props: VisualProps): Record<string, unknown> {
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

function getServerUrl(propsUrl?: string, servicesUrl?: string): string {
  const raw = propsUrl || servicesUrl || DEFAULT_RASTERIZE_SERVER_URL;
  return raw.startsWith('http') ? raw : `http://${raw}`;
}

/**
 * Rasterize a single-slide presentation to a PNG via the configured service.
 * An in-process `render` callback takes precedence over an HTTP `serverUrl`.
 */
async function rasterize(
  presentation: Record<string, unknown>,
  dpi: number,
  propsServerUrl: string | undefined,
  serviceConfig: PptxServiceConfig | undefined
): Promise<PptxRasterizeResult> {
  if (!isNodeEnvironment()) {
    throw new Error(
      'Visual rasterization requires a Node.js environment. ' +
        'It is not available in browser environments.'
    );
  }

  // In-process renderer wins (ideal for tests and single-process hosts).
  if (serviceConfig?.render) {
    return serviceConfig.render({ presentation, dpi });
  }

  const serverUrl = getServerUrl(propsServerUrl, serviceConfig?.serverUrl);

  const requestBody = { presentation, dpi };

  const resolvedHeaders =
    typeof serviceConfig?.headers === 'function'
      ? await serviceConfig.headers(requestBody)
      : serviceConfig?.headers;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...resolvedHeaders,
  };

  const response = await fetch(`${serverUrl}/rasterize`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }).catch((error) => {
    throw new Error(
      `PPTX rasterization service is not reachable at ${serverUrl}. ` +
        'Configure services.pptx with a `render` callback or a running `serverUrl`.\n' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok) {
    throw new Error(
      `PPTX rasterization service returned ${response.status}: ${response.statusText}`
    );
  }

  const result = (await response.json()) as PptxRasterizeResult;
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

  const presentation = buildPresentation(props);
  const dpi = props.dpi ?? serviceConfig?.dpi ?? DEFAULT_DPI;

  const result = await rasterize(
    presentation,
    dpi,
    props.serverUrl,
    serviceConfig
  );

  // Default the rendered size to the canvas physical inches so a 6×4 canvas
  // prints 6×4; an explicit width/height (px or %) overrides. Height is left
  // unset by default so aspect ratio is preserved from the PNG.
  const renderWidth =
    props.width ?? Math.round(props.canvas.width * PIXELS_PER_INCH);

  return await createImage(result.base64DataUri, theme, themeName, {
    caption: props.caption,
    width: renderWidth,
    height: props.height,
    alignment: props.alignment ?? 'center',
    spacing: props.spacing,
    floating: props.floating,
    keepNext: props.keepNext,
    keepLines: props.keepLines,
  });
}

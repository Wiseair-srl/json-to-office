/**
 * Highcharts Component Renderer (PPTX)
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, PipelineWarning } from '../types';
import type { PptxHighchartsProps } from '@json-to-office/shared-pptx';
import type { HighchartsServiceConfig } from '@json-to-office/shared';
import { isNodeEnvironment } from '../utils/environment';
import { resolveColor, DEFAULT_CHART_THEME_COLORS } from '../utils/color';

const PX_PER_INCH = 96;
const DEFAULT_EXPORT_SERVER_URL = 'http://localhost:7801';

function getExportServerUrl(propsUrl?: string, servicesUrl?: string): string {
  const raw = propsUrl || servicesUrl || DEFAULT_EXPORT_SERVER_URL;
  return raw.startsWith('http') ? raw : `http://${raw}`;
}

/**
 * Generate chart via Highcharts Export Server
 */
async function generateChart(
  config: PptxHighchartsProps,
  servicesConfig?: HighchartsServiceConfig
): Promise<{ base64DataUri: string; width: number; height: number }> {
  if (!isNodeEnvironment()) {
    throw new Error(
      'Highcharts export server requires a Node.js environment. ' +
        'Chart generation is not available in browser environments.'
    );
  }

  const serverUrl = getExportServerUrl(
    config.serverUrl,
    servicesConfig?.serverUrl
  );

  const requestBody = {
    infile: config.options,
    type: 'png',
    b64: true,
    scale: config.scale,
    // Forward resources verbatim only when present so the payload stays
    // byte-identical to before for callers that omit it.
    ...(config.resources ? { resources: config.resources } : {}),
  };

  const resolvedHeaders =
    typeof servicesConfig?.headers === 'function'
      ? await servicesConfig.headers(requestBody)
      : servicesConfig?.headers;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...resolvedHeaders,
  };

  const response = await fetch(`${serverUrl}/export`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }).catch((error) => {
    throw new Error(
      `Highcharts Export Server is not running at ${serverUrl}. ` +
        'Start it with: npx highcharts-export-server --enableServer true\n' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok) {
    throw new Error(
      `Highcharts export server returned ${response.status}: ${response.statusText}`
    );
  }

  const base64Data = await response.text();

  return {
    base64DataUri: `data:image/png;base64,${base64Data}`,
    width: config.options.chart?.width ?? 960,
    height: config.options.chart?.height ?? 720,
  };
}

/**
 * When the Highcharts config sets no top-level `colors`, series render in the
 * Highcharts default palette (blue-first) and ignore the document theme. Inject
 * the theme's chart palette (same tokens as the native `chart` component) so
 * both chart paths follow the theme by default. Explicit `colors` always wins.
 */
function withThemeColors(
  props: PptxHighchartsProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): PptxHighchartsProps {
  if (!props.options || props.options.colors || !theme?.colors) return props;
  const palette = DEFAULT_CHART_THEME_COLORS.map(
    (token) => `#${resolveColor(token, theme, warnings)}`
  );
  return {
    ...props,
    options: { ...props.options, colors: palette },
  };
}

export async function renderHighchartsComponent(
  slide: PptxGenJS.Slide,
  props: PptxHighchartsProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[],
  servicesConfig?: HighchartsServiceConfig
): Promise<void> {
  const chart = await generateChart(
    withThemeColors(props, theme, warnings),
    servicesConfig
  );

  const w = props.w ?? chart.width / PX_PER_INCH;
  const h = props.h ?? chart.height / PX_PER_INCH;

  slide.addImage({
    data: chart.base64DataUri,
    x: props.x ?? 0,
    y: props.y ?? 0,
    w,
    h,
  } as any);
}

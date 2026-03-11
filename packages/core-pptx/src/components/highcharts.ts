/**
 * Highcharts Component Renderer (PPTX)
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig } from '../types';
import type { PptxHighchartsProps } from '@json-to-office/shared-pptx';
import { isNodeEnvironment } from '../utils/environment';

const PX_PER_INCH = 96;
const DEFAULT_EXPORT_SERVER_URL = 'http://localhost:7801';

function getExportServerUrl(propsUrl?: string): string {
  return propsUrl || process.env.HIGHCHARTS_SERVER_URL || DEFAULT_EXPORT_SERVER_URL;
}

/**
 * Generate chart via Highcharts Export Server
 */
async function generateChart(
  config: PptxHighchartsProps
): Promise<{ base64DataUri: string; width: number; height: number }> {
  if (!isNodeEnvironment()) {
    throw new Error(
      'Highcharts export server requires a Node.js environment. ' +
        'Chart generation is not available in browser environments.'
    );
  }

  const serverUrl = getExportServerUrl(config.serverUrl);

  const response = await fetch(`${serverUrl}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      infile: config.options,
      type: 'png',
      b64: true,
      scale: config.scale,
    }),
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
    width: config.options.chart.width,
    height: config.options.chart.height,
  };
}

export async function renderHighchartsComponent(
  slide: PptxGenJS.Slide,
  props: PptxHighchartsProps,
  _theme: PptxThemeConfig
): Promise<void> {
  const chart = await generateChart(props);

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

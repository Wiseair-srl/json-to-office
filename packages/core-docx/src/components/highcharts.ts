/**
 * Highcharts Component
 * Standard component for generating charts using Highcharts Export Server
 */

import { Paragraph, Table } from 'docx';
import {
  ComponentDefinition,
  RenderContext,
  isHighchartsComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { createImage } from '../core/content';
import { isNodeEnvironment } from '../utils/environment';
import { resolveServiceUrl, postJsonToService } from '../utils/serviceClient';

// Import only the types we actually use from shared package
import type { HighchartsProps } from '@json-to-office/shared-docx';
import type { HighchartsServiceConfig } from '@json-to-office/shared';

// Re-export HighchartsProps for backward compatibility
export type { HighchartsProps } from '@json-to-office/shared-docx';

/**
 * Chart generation result
 */
export interface ChartGenerationResult {
  base64DataUri: string;
  width: number;
  height: number;
}

const DEFAULT_EXPORT_SERVER_URL = 'http://localhost:7801';

/**
 * Generate chart using Highcharts Export Server
 */
async function generateChart(
  config: HighchartsProps,
  servicesConfig?: HighchartsServiceConfig
): Promise<ChartGenerationResult> {
  // Only run in Node.js environments
  if (!isNodeEnvironment()) {
    throw new Error(
      'Highcharts export server requires a Node.js environment. ' +
        'Chart generation is not available in browser environments.'
    );
  }

  const serverUrl = resolveServiceUrl(
    config.serverUrl,
    servicesConfig?.serverUrl,
    DEFAULT_EXPORT_SERVER_URL
  );

  const requestBody: Record<string, unknown> = {
    infile: config.options,
    type: 'png',
    b64: true,
    scale: config.scale,
  };

  const response = await postJsonToService({
    url: serverUrl,
    path: '/export',
    body: requestBody,
    headers: servicesConfig?.headers,
    serviceLabel: 'Highcharts export server',
    onUnreachable: (url, cause) =>
      `Highcharts Export Server is not running at ${url}. ` +
      'Start it with: npx highcharts-export-server --enableServer true\n' +
      `Cause: ${cause}`,
  });

  const base64Data = await response.text();
  const base64DataUri = `data:image/png;base64,${base64Data}`;
  const width = config.options.chart.width;
  const height = config.options.chart.height;

  return {
    base64DataUri,
    width,
    height,
  };
}

/**
 * Render highcharts component
 */
export async function renderHighchartsComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context?: RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!isHighchartsComponent(component)) return [];

  const config = component.props as HighchartsProps;

  // Generate the chart
  const chartResult = await generateChart(
    config,
    context?.services?.highcharts
  );

  // If either config.width or config.height is provided, use config dimensions only
  // Otherwise fall back to chart dimensions
  const hasConfigDimensions =
    config.width !== undefined || config.height !== undefined;
  const renderWidth = hasConfigDimensions ? config.width : chartResult.width;
  const renderHeight = hasConfigDimensions ? config.height : chartResult.height;

  // Add chart image using the image component with base64 data URI
  const imageParagraphs = await createImage(
    chartResult.base64DataUri,
    theme,
    themeName,
    {
      width: renderWidth,
      height: renderHeight,
      alignment: 'center',
    }
  );

  return imageParagraphs;
}

/**
 * Highcharts Component
 * Standard component for generating charts using Highcharts Export Server at localhost:7801
 */

import { Paragraph, Table } from 'docx';
import { ComponentDefinition, isHighchartsComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createImage } from '../core/content';
import { isNodeEnvironment } from '../utils/environment';

// Import only the types we actually use from shared package
import type { HighchartsProps } from '@json-to-office/shared-docx';

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

/**
 * Generate chart using local Highcharts Export Server at localhost:7801
 */
async function generateChart(
  config: HighchartsProps
): Promise<ChartGenerationResult> {
  // Only run in Node.js environments
  if (!isNodeEnvironment()) {
    throw new Error(
      'Highcharts export server requires a Node.js environment. ' +
        'Chart generation is not available in browser environments.'
    );
  }

  try {
    // Build request body with optional scale
    const requestBody: Record<string, unknown> = {
      infile: config.options,
      type: 'png',
      b64: true,
      scale: config.scale,
    };

    // Call the export server at localhost:7801 using native fetch
    const response = await fetch('http://localhost:7801/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `Highcharts export server returned ${response.status}: ${response.statusText}`
      );
    }

    // Get the base64 string from response
    const base64Data = await response.text();

    // Format as data URI for PNG
    const base64DataUri = `data:image/png;base64,${base64Data}`;

    // Extract width and height from options
    const width = config.options.chart.width;
    const height = config.options.chart.height;

    return {
      base64DataUri,
      width,
      height,
    };
  } catch (error) {
    // Fallback to placeholder if export server is not available
    throw new Error(
      'Highcharts export server not available at localhost:7801, using placeholder image.\n' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Render highcharts component
 */
export async function renderHighchartsComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  _themeName: string
): Promise<(Paragraph | Table)[]> {
  if (!isHighchartsComponent(component)) return [];

  const config = component.props as HighchartsProps;

  try {
    // Generate the chart
    const chartResult = await generateChart(config);

    // If either config.width or config.height is provided, use config dimensions only
    // Otherwise fall back to chart dimensions
    const hasConfigDimensions =
      config.width !== undefined || config.height !== undefined;
    const renderWidth = hasConfigDimensions ? config.width : chartResult.width;
    const renderHeight = hasConfigDimensions
      ? config.height
      : chartResult.height;

    // Add chart image using the image component with base64 data URI
    const imageParagraphs = await createImage(
      chartResult.base64DataUri,
      theme,
      {
        width: renderWidth,
        height: renderHeight,
        alignment: 'center',
      }
    );

    return imageParagraphs;
  } catch (error) {
    // Return empty array on error (error is already logged in generateChart)
    console.error(
      'Error rendering chart:',
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

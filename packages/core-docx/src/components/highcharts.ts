/**
 * The `highcharts` component: a chart drawn by an export server.
 *
 * Nothing here renders a document. A chart has no OOXML form of its own — it
 * becomes a PNG and then an `image` — so what lives here is the request the
 * export server needs, the theme palette that goes into it, and the image props
 * the result desugars to.
 */

import { ThemeConfig } from '../styles';
import { resolveColor } from '../styles/utils/colorUtils';
import { isNodeEnvironment } from '../utils/environment';
import { resolveServiceUrl, postJsonToService } from '../utils/serviceClient';

// Import only the types we actually use from shared package
import type { HighchartsProps } from '@json-to-office/shared-docx';
import type { HighchartsServiceConfig } from '@json-to-office/shared';
import { DEFAULT_CHART_THEME_COLORS } from '@json-to-office/shared';

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
    // Forward resources verbatim only when present so the payload stays
    // byte-identical to before for callers that omit it.
    ...(config.resources ? { resources: config.resources } : {}),
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
 * Turn one theme color value into a `#RRGGBB` string, or undefined when it
 * cannot be resolved. The theme schema lets a color be another token's name
 * (`"accent4": "primary"`), so a bare `#` prefix would post "#primary" to the
 * export server; `resolveColor` walks the reference chain and throws on
 * anything unresolvable, which we treat as an unset slot.
 */
function toChartColor(value: string, theme: ThemeConfig): string | undefined {
  // Literal hex passes through untouched — resolveColor would upper-case it,
  // and it rejects the bare (no '#') form the schema still accepts.
  if (/^#?[0-9A-Fa-f]{6}$/.test(value)) {
    return value.startsWith('#') ? value : `#${value}`;
  }
  try {
    return `#${resolveColor(value, theme)}`;
  } catch {
    return undefined;
  }
}

/**
 * When the Highcharts config sets no top-level `colors`, series render in the
 * Highcharts default palette (blue-first) and ignore the document theme. Inject
 * the theme's chart palette — the same token list PPTX charts resolve — as
 * series colors so charts follow the theme by default. accent4-6 are optional
 * in the theme schema; slots the theme leaves unset are skipped, in both
 * formats, so the palette never carries gaps or repeats and Highcharts wraps
 * the shorter list (see DEFAULT_CHART_THEME_COLORS). Explicit `colors` always
 * wins.
 */
function withThemeColors(
  config: HighchartsProps,
  theme: ThemeConfig
): HighchartsProps {
  const options = config.options as Record<string, unknown> | undefined;
  if (!options || options.colors || !theme?.colors) return config;
  const themeColors = theme.colors as Record<string, string | undefined>;
  const palette = DEFAULT_CHART_THEME_COLORS.map((token) => {
    const value = themeColors[token];
    return typeof value === 'string' && value.length > 0
      ? toChartColor(value, theme)
      : undefined;
  }).filter((c): c is string => c !== undefined);
  if (palette.length === 0) return config;
  return {
    ...config,
    options: { ...config.options, colors: palette },
  };
}

/**
 * Map a chart's props to the `image` props it desugars to.
 *
 * Shared by the render-time component and the DocxIR desugaring pass so the two
 * cannot drift on the one decision that is not obvious: an explicit `width` or
 * `height` on the component replaces the chart's own canvas size outright,
 * rather than merging with it — stating one and inheriting the other would
 * distort the chart.
 */
export async function renderChartToImageProps(
  props: HighchartsProps,
  theme: ThemeConfig,
  servicesConfig?: HighchartsServiceConfig
): Promise<Record<string, unknown>> {
  const config = withThemeColors(props, theme);
  const chart = await generateChart(config, servicesConfig);

  const hasConfigDimensions =
    config.width !== undefined || config.height !== undefined;

  return {
    base64: chart.base64DataUri,
    width: hasConfigDimensions ? config.width : chart.width,
    height: hasConfigDimensions ? config.height : chart.height,
    alignment: 'center',
  };
}

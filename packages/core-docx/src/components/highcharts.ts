/**
 * The `highcharts` component: a chart drawn by an export server.
 *
 * Nothing here renders a document. A chart has no OOXML form of its own — it
 * becomes a PNG and then an `image` — so what lives here is the request the
 * export server needs, the theme palette that goes into it, and the image props
 * the result desugars to.
 */

import { ThemeConfig } from '../styles';
import { chartPaletteValues, resolveColor } from '../styles/utils/colorUtils';
import { getPageSetup } from '../styles/utils/layoutUtils';
import { isNodeEnvironment } from '../utils/environment';
import { resolveServiceUrl, postJsonToService } from '../utils/serviceClient';

// Import only the types we actually use from shared package
import type { HighchartsProps } from '@json-to-office/shared-docx';
import {
  chartFamilyResolver,
  chartPointsPerPixel,
  POINTS_PER_PIXEL_96DPI,
  withChartFontFaceCss,
  withChartTypography,
  type ChartTypography,
  type HighchartsServiceConfig,
  type RasterizeFontFace,
} from '@json-to-office/shared';

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
 * the shorter list (see DEFAULT_CHART_THEME_COLORS). A theme declaring
 * `palette.chart` supplies that list instead, in its own order. Explicit
 * `colors` always wins.
 */
function withThemeColors(
  config: HighchartsProps,
  theme: ThemeConfig
): HighchartsProps {
  const options = config.options as Record<string, unknown> | undefined;
  if (!options || options.colors || !theme?.colors) return config;
  const palette = chartPaletteValues(theme).flatMap((value) => {
    const color = toChartColor(value, theme);
    return color ? [color] : [];
  });
  if (palette.length === 0) return config;
  return {
    ...config,
    options: { ...config.options, colors: palette },
  };
}

/** Twips to points. */
const POINTS_PER_TWIP = 1 / 20;
/** Points per image pixel: `image` places a pixel count at 96 dpi. */
const POINTS_PER_PIXEL = POINTS_PER_PIXEL_96DPI;

/**
 * The width, in points, the chart's image takes on the page — the same rule
 * the `image` it desugars to applies: a number is pixels at 96 dpi, a
 * percentage is of the content width, and a height alone scales the width
 * with it. Undefined when nothing places it, which the caller reads as 96 dpi.
 */
function placedWidthPt(
  config: HighchartsProps,
  theme: ThemeConfig
): number | undefined {
  const { width, height } = config;
  const chart = config.options.chart;
  if (typeof width === 'number') return width * POINTS_PER_PIXEL;
  if (typeof width === 'string') {
    const page = getPageSetup(theme);
    const contentWidthPt =
      (page.size.width - page.margin.left - page.margin.right) *
      POINTS_PER_TWIP;
    return (parseFloat(width) / 100) * contentWidthPt;
  }
  if (typeof height === 'number' && chart.height > 0) {
    return (height / chart.height) * chart.width * POINTS_PER_PIXEL;
  }
  return undefined;
}

function toHex(token: string, theme: ThemeConfig): string {
  return `#${resolveColor(token, theme)}`;
}

/**
 * The document's type, read off the resolved theme. `chartLabel` and `source`
 * are the roles a theme declares for exactly this (see the shared design
 * system); without them the labels sit one point under the body and the
 * source one under that, which is where a report sets them anyway. The title
 * takes the heading face at the `heading3` size, the level a figure title
 * reads as on the page.
 */
function themeChartTypography(theme: ThemeConfig): ChartTypography {
  const styles = (theme.styles ?? {}) as Record<
    string,
    | {
        size?: number;
        bold?: boolean;
        fontWeight?: number;
      }
    | undefined
  >;
  const family = chartFamilyResolver(theme);
  const bodyPt = styles.normal?.size ?? theme.fonts.body.size ?? 11;
  const label = styles.chartLabel;
  const heading = styles.heading3;
  const labelPt = label?.size ?? Math.max(bodyPt - 1, 6);
  return {
    bodyFamily: family(theme.fonts.body.family),
    headingFamily: family(theme.fonts.heading.family),
    textColor: toHex('textPrimary', theme),
    mutedColor: toHex('textSecondary', theme),
    labelPt,
    labelWeight: label?.fontWeight ?? (label?.bold ? 700 : undefined),
    titlePt: heading?.size ?? bodyPt + 2,
    titleWeight:
      heading?.fontWeight ?? (heading?.bold === false ? undefined : 700),
    sourcePt: styles.source?.size ?? Math.max(labelPt - 1, 6),
  };
}

/**
 * Set the chart in the document's type: family, sizes and ink written beneath
 * whatever the author styled, scaled to the width the image is placed at.
 */
function withThemeTypography(
  config: HighchartsProps,
  theme: ThemeConfig
): HighchartsProps {
  if (!theme?.fonts?.body?.family || !theme.fonts.heading?.family) {
    return config;
  }
  return {
    ...config,
    options: withChartTypography(
      config.options,
      themeChartTypography(theme),
      chartPointsPerPixel(
        config.options.chart.width,
        placedWidthPt(config, theme)
      )
    ) as HighchartsProps['options'],
  };
}

/**
 * Hand the export server the bytes of every staged face of the families the
 * chart is set in, as `@font-face` rules ahead of the author's own CSS, so a
 * registered font draws from the document's bytes rather than from a
 * lookalike. Nothing is added when no face matches: a document set in safe
 * fonts posts the same body it always did.
 */
function withChartFontFaces(
  config: HighchartsProps,
  theme: ThemeConfig,
  faces: readonly RasterizeFontFace[] | undefined
): HighchartsProps {
  if (!faces?.length || !theme?.fonts) return config;
  return withChartFontFaceCss(config, faces, [
    theme.fonts.body.family,
    theme.fonts.heading.family,
  ]);
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
  servicesConfig?: HighchartsServiceConfig,
  chartFonts?: readonly RasterizeFontFace[]
): Promise<Record<string, unknown>> {
  const config = withChartFontFaces(
    withThemeTypography(withThemeColors(props, theme), theme),
    theme,
    chartFonts
  );
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

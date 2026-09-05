/**
 * The document's typography, expressed as Highcharts options.
 *
 * A `highcharts` component is a PNG drawn by a browser that has never seen the
 * document, so nothing about the page's type reaches the chart on its own: the
 * axis labels, title and legend come out in the export server's default face
 * at Highcharts' own sizes, visibly foreign to the prose around them. The
 * palette already carries (see `chart-palette.ts`); this carries the type.
 *
 * Format-neutral on purpose. Each core reads its own theme shape into a
 * `ChartTypography` — family, colours and sizes in document points — and this
 * module turns that into the option paths Highcharts styles text through. An
 * explicit author value keeps winning, property by property, exactly as
 * `options.colors` does.
 *
 * Sizes are converted from points to chart pixels through the scale the chart
 * is placed at: a 900px chart set into a 450pt measure shrinks by half, so a
 * label that must read as 9pt on the page is drawn at 18px.
 */

import type { RasterizeFontFace } from '../types/services';

export interface ChartTypography {
  /** CSS `font-family` for everything not styled otherwise (see `cssFontFamily`). */
  bodyFamily: string;
  /** CSS `font-family` for the chart title. */
  headingFamily: string;
  /** `#RRGGBB` for the title, legend and data labels. */
  textColor: string;
  /** `#RRGGBB` for axis text, subtitle, caption and credits. */
  mutedColor: string;
  /** Axis labels, axis titles, legend, subtitle and data labels, in points. */
  labelPt: number;
  /** Weight for legend items and data labels; Highcharts' own default when unset. */
  labelWeight?: number;
  /** Chart title, in points. */
  titlePt: number;
  /** Chart title weight; Highcharts' own default when unset. */
  titleWeight?: number;
  /** Credits (the source line) and caption, in points. */
  sourcePt: number;
}

/** Points per CSS pixel at the 96 dpi both formats assume for an unplaced chart. */
const POINTS_PER_PIXEL_96DPI = 0.75;

/**
 * How many document points one chart pixel occupies once the image is placed.
 * Unknown or degenerate widths fall back to 96 dpi, the size an unscaled
 * chart has in both formats.
 */
export function chartPointsPerPixel(
  chartWidthPx: number,
  placedWidthPt: number | undefined
): number {
  if (
    !Number.isFinite(chartWidthPx) ||
    chartWidthPx <= 0 ||
    placedWidthPt === undefined ||
    !Number.isFinite(placedWidthPt) ||
    placedWidthPt <= 0
  ) {
    return POINTS_PER_PIXEL_96DPI;
  }
  return placedWidthPt / chartWidthPx;
}

const SERIF_FAMILIES = new Set(['georgia', 'times new roman', 'cambria']);
const MONO_FAMILIES = new Set(['consolas', 'courier new', 'menlo', 'monaco']);

type FontCategory = 'sans' | 'serif' | 'mono' | 'display' | 'handwriting';

/**
 * A CSS `font-family` list: the family, quoted, then the generic it belongs
 * to — from the registry category when the font is registered, from the
 * SAFE_FONTS list otherwise — so a face the export server lacks degrades to
 * the right shape rather than to the browser's default.
 */
export function cssFontFamily(family: string, category?: FontCategory): string {
  const generic =
    category === 'serif'
      ? 'serif'
      : category === 'mono'
        ? 'monospace'
        : category === 'handwriting'
          ? 'cursive'
          : category === undefined && SERIF_FAMILIES.has(family.toLowerCase())
            ? 'serif'
            : category === undefined && MONO_FAMILIES.has(family.toLowerCase())
              ? 'monospace'
              : 'sans-serif';
  return `"${family.replace(/["\\]/g, '\\$&')}", ${generic}`;
}

type Options = Record<string, unknown>;

function isPlainObject(value: unknown): value is Options {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `defaults` beneath `authored`: an authored key is never replaced. */
function fill(authored: unknown, defaults: Options): Options {
  const base: Options = isPlainObject(authored) ? { ...authored } : {};
  for (const [key, value] of Object.entries(defaults)) {
    if (value === undefined) continue;
    const current = base[key];
    if (current === undefined) {
      base[key] = isPlainObject(value) ? fill(undefined, value) : value;
    } else if (isPlainObject(current) && isPlainObject(value)) {
      base[key] = fill(current, value);
    }
  }
  return base;
}

/** Highcharts axes may be one object or an array of them. */
function fillAxis(authored: unknown, defaults: Options): unknown {
  if (Array.isArray(authored)) {
    return authored.map((axis) => fill(axis, defaults));
  }
  return fill(authored, defaults);
}

function weight(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/**
 * The document's typography written into every Highcharts option path that
 * styles text, beneath whatever the author set. `ptPerPx` is the placement
 * scale from `chartPointsPerPixel`.
 */
export function withChartTypography<T extends Options>(
  options: T,
  typography: ChartTypography,
  ptPerPx: number
): T {
  const px = (points: number): string =>
    `${Math.round((points / ptPerPx) * 10) / 10}px`;
  const labelPx = px(typography.labelPt);
  const sourcePx = px(typography.sourcePt);
  const mutedText = { fontSize: labelPx, color: typography.mutedColor };
  const mutedSource = { fontSize: sourcePx, color: typography.mutedColor };
  const labelText = {
    fontSize: labelPx,
    color: typography.textColor,
    fontWeight: weight(typography.labelWeight),
  };
  const axis = { labels: { style: mutedText }, title: { style: mutedText } };

  return {
    ...options,
    chart: fill(options.chart, {
      style: { fontFamily: typography.bodyFamily },
    }),
    title: fill(options.title, {
      style: {
        fontFamily: typography.headingFamily,
        fontSize: px(typography.titlePt),
        fontWeight: weight(typography.titleWeight),
        color: typography.textColor,
      },
    }),
    subtitle: fill(options.subtitle, { style: mutedText }),
    caption: fill(options.caption, { style: mutedSource }),
    xAxis: fillAxis(options.xAxis, axis),
    yAxis: fillAxis(options.yAxis, axis),
    legend: fill(options.legend, { itemStyle: labelText }),
    plotOptions: fill(options.plotOptions, {
      series: { dataLabels: { style: labelText } },
    }),
    credits: fill(options.credits, { style: mutedSource }),
  };
}

const FONT_FORMATS: Record<
  NonNullable<RasterizeFontFace['format']>,
  { mime: string; format: string }
> = {
  ttf: { mime: 'font/ttf', format: 'truetype' },
  otf: { mime: 'font/otf', format: 'opentype' },
  woff: { mime: 'font/woff', format: 'woff' },
  woff2: { mime: 'font/woff2', format: 'woff2' },
};

/**
 * `@font-face` rules for the faces of `families`, inlined as data URIs, so an
 * export server draws a registered font from the same bytes the document
 * stages rather than from whatever its host happens to have installed. The
 * bytes go only to the export server, which already receives every data
 * point of the chart. Empty when no face matches.
 */
export function chartFontFaceCss(
  faces: readonly RasterizeFontFace[],
  families: readonly string[]
): string {
  const wanted = new Set(families.map((family) => family.toLowerCase()));
  return faces
    .filter((face) => wanted.has(face.family.toLowerCase()))
    .map((face) => {
      const { mime, format } = FONT_FORMATS[face.format ?? 'ttf'];
      return (
        `@font-face{font-family:"${face.family.replace(/["\\]/g, '\\$&')}";` +
        `font-weight:${face.weight};font-style:${face.italic ? 'italic' : 'normal'};` +
        `src:url(data:${mime};base64,${face.data}) format("${format}")}`
      );
    })
    .join('\n');
}

/**
 * Chart Component Renderer — native PowerPoint charts via pptxgenjs slide.addChart()
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, PipelineWarning } from '../types';
import { resolveColor, definedChartColorTokens } from '../utils/color';
import { applyFontWeight } from '../utils/fontAliasContext';
import { warn, W } from '../utils/warn';

interface ChartDataSeries {
  name?: string;
  labels?: string[];
  values?: number[];
  sizes?: number[];
}

interface ChartComponentProps {
  type: string;
  data: ChartDataSeries[];

  showLegend?: boolean;
  showTitle?: boolean;
  showValue?: boolean;
  showPercent?: boolean;
  showLabel?: boolean;
  showSerName?: boolean;

  title?: string;
  titleFontSize?: number;
  titleColor?: string;
  titleFontFace?: string;
  titleFontWeight?: number;

  chartColors?: string[];

  dataBorder?: { pt: number; color: string };

  legendPos?: string;
  legendFontSize?: number;
  legendFontFace?: string;
  legendFontWeight?: number;
  legendColor?: string;

  catAxisTitle?: string;
  catAxisHidden?: boolean;
  catAxisLabelRotate?: number;
  catAxisLabelFontSize?: number;
  catAxisLabelColor?: string;
  catAxisLabelFontFace?: string;
  catAxisLabelFontWeight?: number;
  catGridLine?: { style?: string; size?: number; color?: string };

  valAxisTitle?: string;
  valAxisHidden?: boolean;
  valAxisMinVal?: number;
  valAxisMaxVal?: number;
  valAxisLabelFormatCode?: string;
  valAxisMajorUnit?: number;
  valAxisLabelColor?: string;
  valAxisLabelFontFace?: string;
  valAxisLabelFontWeight?: number;
  valAxisLabelFontSize?: number;
  valGridLine?: { style?: string; size?: number; color?: string };
  catAxisLineShow?: boolean;
  valAxisLineShow?: boolean;

  barDir?: string;
  barGrouping?: string;
  barGapWidthPct?: number;
  barOverlapPct?: number;

  lineSmooth?: boolean;
  lineDataSymbol?: string;
  lineSize?: number;
  lineDataSymbolSize?: number;

  firstSliceAng?: number;
  holeSize?: number;

  radarStyle?: string;

  dataLabelColor?: string;
  dataLabelFontSize?: number;
  dataLabelFontFace?: string;
  dataLabelFontWeight?: number;
  dataLabelFontBold?: boolean;
  dataLabelPosition?: string;

  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
}

// Map our type strings to pptxgenjs CHART_NAME values
const CHART_TYPE_MAP: Record<string, string> = {
  area: 'area',
  bar: 'bar',
  bar3D: 'bar3D',
  bubble: 'bubble',
  doughnut: 'doughnut',
  line: 'line',
  pie: 'pie',
  radar: 'radar',
  scatter: 'scatter',
};

function resolveGridLine(
  gridLine: { style?: string; size?: number; color?: string },
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  if (gridLine.style !== undefined) resolved.style = gridLine.style;
  if (gridLine.size !== undefined) resolved.size = gridLine.size;
  if (gridLine.color !== undefined)
    resolved.color = resolveColor(gridLine.color, theme, warnings);
  return resolved;
}

export function renderChartComponent(
  slide: PptxGenJS.Slide,
  props: ChartComponentProps,
  theme: PptxThemeConfig,
  _pptx: PptxGenJS,
  warnings?: PipelineWarning[]
): void {
  const chartType = CHART_TYPE_MAP[props.type];
  if (!chartType) {
    warn(warnings, W.UNKNOWN_CHART_TYPE, `Unknown chart type: ${props.type}`, {
      component: 'chart',
    });
    return;
  }

  // Validate data
  if (!props.data || props.data.length === 0) {
    warn(warnings, W.CHART_NO_DATA, 'Chart component has no data series', {
      component: 'chart',
    });
    return;
  }
  for (const series of props.data) {
    if (!series.labels || !series.values) {
      warn(
        warnings,
        W.CHART_INVALID_SERIES,
        `Chart series "${series.name ?? '(unnamed)'}" missing labels or values`,
        { component: 'chart' }
      );
      return;
    }
  }
  if (
    (chartType === 'pie' || chartType === 'doughnut') &&
    props.data.length > 1
  ) {
    warn(
      warnings,
      W.CHART_MULTI_SERIES,
      `${props.type} chart has ${props.data.length} series — only the first will render`,
      { component: 'chart' }
    );
  }

  // Build data array
  const data = props.data.map((series) => {
    const d: Record<string, unknown> = {};
    if (series.name !== undefined) d.name = series.name;
    if (series.labels) d.labels = series.labels;
    if (series.values) d.values = series.values;
    if (series.sizes) d.sizes = series.sizes;
    return d;
  });

  // Build chart options
  const opts: Record<string, unknown> = {};

  // Position
  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  // Colors — resolve semantic names to hex, following any token-to-token
  // reference the theme sets up. The implicit palette skips tokens the theme
  // leaves unset or leaves unresolvable (DOCX does the same); an explicit
  // chartColors entry naming one keeps the loud fallback + warning. Only hex
  // reaches pptxgenjs: it answers a stray token name with black. An empty list
  // is left unset rather than passed on — pptxgenjs indexes `chartColors[i % 0]`
  // and paints every series black, so its own palette is the better fallback.
  const colorSources = props.chartColors ?? definedChartColorTokens(theme);
  if (colorSources.length > 0) {
    opts.chartColors = colorSources.map((c) =>
      resolveColor(c, theme, warnings)
    );
  }

  // Auto-default chart text colors from theme to prevent dark-on-dark / light-on-light
  const themeTextColor = resolveColor('text', theme, warnings);
  opts.titleColor = props.titleColor
    ? resolveColor(props.titleColor, theme, warnings)
    : themeTextColor;
  opts.legendColor = props.legendColor
    ? resolveColor(props.legendColor, theme, warnings)
    : themeTextColor;
  opts.catAxisLabelColor = props.catAxisLabelColor
    ? resolveColor(props.catAxisLabelColor, theme, warnings)
    : themeTextColor;
  opts.valAxisLabelColor = props.valAxisLabelColor
    ? resolveColor(props.valAxisLabelColor, theme, warnings)
    : themeTextColor;
  if (props.valAxisLabelFontSize !== undefined)
    opts.valAxisLabelFontSize = props.valAxisLabelFontSize;
  if (props.catAxisLineShow !== undefined)
    opts.catAxisLineShow = props.catAxisLineShow;
  if (props.valAxisLineShow !== undefined)
    opts.valAxisLineShow = props.valAxisLineShow;

  // Data element border (bars/slices/areas)
  if (props.dataBorder !== undefined) {
    opts.dataBorder = {
      pt: props.dataBorder.pt,
      color: resolveColor(props.dataBorder.color, theme, warnings),
    };
  }

  // Label fonts — the chart analogue of the run-level `fontFace`/`fontWeight`
  // seam in text.ts. PowerPoint chart labels carry no numeric weight, so a
  // non-RIBBI weight only survives as a synthesized sub-family name ("Inter"
  // at 300 → "Inter Light"); 400/700 stay on the family and use the slot's
  // bold toggle. A weight with no sibling face falls back to the theme body
  // font, the same family a plain text component would have inherited.
  //
  // `boldKey` is the pptxgenjs bold companion for the slot, or undefined for
  // the legend, which has none — see the warn below.
  const applyLabelFont = (
    faceKey: string,
    boldKey: string | undefined,
    face: string | undefined,
    weight: number | undefined
  ): void => {
    if (weight === undefined) {
      if (face !== undefined) opts[faceKey] = face;
      return;
    }
    const w = applyFontWeight({
      family: face ?? theme.fonts?.body,
      fontWeight: weight,
    });
    if (w.fontFace !== undefined) opts[faceKey] = w.fontFace;
    if (boldKey !== undefined) {
      // Assign even when false: an explicit weight has to win over a bold
      // toggle set alongside it (`dataLabelFontBold` is the only such prop).
      opts[boldKey] = w.bold === true;
    } else if (w.bold === true) {
      warn(
        warnings,
        W.CHART_FONT_WEIGHT_DROPPED,
        `Chart ${faceKey} weight ${weight} renders as Regular — PowerPoint gives the legend no bold toggle, and only non-RIBBI weights resolve to a sub-family face`,
        { component: 'chart' }
      );
    }
  };

  // Display toggles
  if (props.showLegend !== undefined) opts.showLegend = props.showLegend;
  if (props.showTitle !== undefined) opts.showTitle = props.showTitle;
  if (props.showValue !== undefined) opts.showValue = props.showValue;
  if (props.showPercent !== undefined) opts.showPercent = props.showPercent;
  if (props.showLabel !== undefined) opts.showLabel = props.showLabel;
  if (props.showSerName !== undefined) opts.showSerName = props.showSerName;

  // Title
  if (props.title !== undefined) opts.title = props.title;
  if (props.titleFontSize !== undefined)
    opts.titleFontSize = props.titleFontSize;
  applyLabelFont(
    'titleFontFace',
    'titleBold',
    props.titleFontFace,
    props.titleFontWeight
  );

  // Legend
  if (props.legendPos !== undefined) opts.legendPos = props.legendPos;
  if (props.legendFontSize !== undefined)
    opts.legendFontSize = props.legendFontSize;
  applyLabelFont(
    'legendFontFace',
    undefined,
    props.legendFontFace,
    props.legendFontWeight
  );

  // Category axis
  if (props.catAxisTitle !== undefined) {
    opts.catAxisTitle = props.catAxisTitle;
    opts.showCatAxisTitle = true;
  }
  if (props.catAxisHidden !== undefined)
    opts.catAxisHidden = props.catAxisHidden;
  if (props.catAxisLabelRotate !== undefined)
    opts.catAxisLabelRotate = props.catAxisLabelRotate;
  if (props.catAxisLabelFontSize !== undefined)
    opts.catAxisLabelFontSize = props.catAxisLabelFontSize;
  applyLabelFont(
    'catAxisLabelFontFace',
    'catAxisLabelFontBold',
    props.catAxisLabelFontFace,
    props.catAxisLabelFontWeight
  );
  if (props.catGridLine !== undefined)
    opts.catGridLine = resolveGridLine(props.catGridLine, theme, warnings);

  // Value axis
  if (props.valAxisTitle !== undefined) {
    opts.valAxisTitle = props.valAxisTitle;
    opts.showValAxisTitle = true;
  }
  if (props.valAxisHidden !== undefined)
    opts.valAxisHidden = props.valAxisHidden;
  if (props.valAxisMinVal !== undefined)
    opts.valAxisMinVal = props.valAxisMinVal;
  if (props.valAxisMaxVal !== undefined)
    opts.valAxisMaxVal = props.valAxisMaxVal;
  if (props.valAxisLabelFormatCode !== undefined)
    opts.valAxisLabelFormatCode = props.valAxisLabelFormatCode;
  if (props.valAxisMajorUnit !== undefined)
    opts.valAxisMajorUnit = props.valAxisMajorUnit;
  applyLabelFont(
    'valAxisLabelFontFace',
    'valAxisLabelFontBold',
    props.valAxisLabelFontFace,
    props.valAxisLabelFontWeight
  );
  if (props.valGridLine !== undefined)
    opts.valGridLine = resolveGridLine(props.valGridLine, theme, warnings);

  // Bar-specific
  if (props.barDir !== undefined) opts.barDir = props.barDir;
  if (props.barGrouping !== undefined) opts.barGrouping = props.barGrouping;
  if (props.barGapWidthPct !== undefined)
    opts.barGapWidthPct = props.barGapWidthPct;
  if (props.barOverlapPct !== undefined)
    opts.barOverlapPct = props.barOverlapPct;

  // Line-specific
  if (props.lineSmooth !== undefined) opts.lineSmooth = props.lineSmooth;
  if (props.lineDataSymbol !== undefined)
    opts.lineDataSymbol = props.lineDataSymbol;
  if (props.lineSize !== undefined) opts.lineSize = props.lineSize;
  if (props.lineDataSymbolSize !== undefined)
    opts.lineDataSymbolSize = props.lineDataSymbolSize;

  // Pie/doughnut
  if (props.firstSliceAng !== undefined)
    opts.firstSliceAng = props.firstSliceAng;
  if (props.holeSize !== undefined) opts.holeSize = props.holeSize;

  // Radar
  if (props.radarStyle !== undefined) opts.radarStyle = props.radarStyle;

  // Data labels
  opts.dataLabelColor = props.dataLabelColor
    ? resolveColor(props.dataLabelColor, theme, warnings)
    : themeTextColor;
  if (props.dataLabelFontSize !== undefined)
    opts.dataLabelFontSize = props.dataLabelFontSize;
  if (props.dataLabelFontBold !== undefined)
    opts.dataLabelFontBold = props.dataLabelFontBold;
  applyLabelFont(
    'dataLabelFontFace',
    'dataLabelFontBold',
    props.dataLabelFontFace,
    props.dataLabelFontWeight
  );
  if (props.dataLabelPosition !== undefined)
    opts.dataLabelPosition = props.dataLabelPosition;

  slide.addChart(chartType as any, data as any[], opts as any);
}

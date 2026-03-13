/**
 * Chart Component Renderer — native PowerPoint charts via pptxgenjs slide.addChart()
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig } from '../types';
import { resolveColor } from '../utils/color';

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

  chartColors?: string[];

  legendPos?: string;
  legendFontSize?: number;
  legendFontFace?: string;
  legendColor?: string;

  catAxisTitle?: string;
  catAxisHidden?: boolean;
  catAxisLabelRotate?: number;
  catAxisLabelFontSize?: number;

  valAxisTitle?: string;
  valAxisHidden?: boolean;
  valAxisMinVal?: number;
  valAxisMaxVal?: number;
  valAxisLabelFormatCode?: string;
  valAxisMajorUnit?: number;

  barDir?: string;
  barGrouping?: string;
  barGapWidthPct?: number;

  lineSmooth?: boolean;
  lineDataSymbol?: string;
  lineSize?: number;

  firstSliceAng?: number;
  holeSize?: number;

  radarStyle?: string;

  dataLabelColor?: string;
  dataLabelFontSize?: number;
  dataLabelFontFace?: string;
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

const DEFAULT_THEME_COLORS = ['primary', 'secondary', 'accent', 'accent4', 'accent5', 'accent6'];

export function renderChartComponent(
  slide: PptxGenJS.Slide,
  props: ChartComponentProps,
  theme: PptxThemeConfig,
  _pptx: PptxGenJS
): void {
  const chartType = CHART_TYPE_MAP[props.type];
  if (!chartType) {
    console.warn(`Unknown chart type: ${props.type}`);
    return;
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

  // Colors — resolve semantic names to hex
  const colorSources = props.chartColors ?? DEFAULT_THEME_COLORS;
  opts.chartColors = colorSources.map((c) => resolveColor(c, theme));

  // Display toggles
  if (props.showLegend !== undefined) opts.showLegend = props.showLegend;
  if (props.showTitle !== undefined) opts.showTitle = props.showTitle;
  if (props.showValue !== undefined) opts.showValue = props.showValue;
  if (props.showPercent !== undefined) opts.showPercent = props.showPercent;
  if (props.showLabel !== undefined) opts.showLabel = props.showLabel;
  if (props.showSerName !== undefined) opts.showSerName = props.showSerName;

  // Title
  if (props.title !== undefined) opts.title = props.title;
  if (props.titleFontSize !== undefined) opts.titleFontSize = props.titleFontSize;
  if (props.titleColor !== undefined) opts.titleColor = resolveColor(props.titleColor, theme);
  if (props.titleFontFace !== undefined) opts.titleFontFace = props.titleFontFace;

  // Legend
  if (props.legendPos !== undefined) opts.legendPos = props.legendPos;
  if (props.legendFontSize !== undefined) opts.legendFontSize = props.legendFontSize;
  if (props.legendFontFace !== undefined) opts.legendFontFace = props.legendFontFace;
  if (props.legendColor !== undefined) opts.legendColor = resolveColor(props.legendColor, theme);

  // Category axis
  if (props.catAxisTitle !== undefined) {
    opts.catAxisTitle = props.catAxisTitle;
    opts.showCatAxisTitle = true;
  }
  if (props.catAxisHidden !== undefined) opts.catAxisHidden = props.catAxisHidden;
  if (props.catAxisLabelRotate !== undefined) opts.catAxisLabelRotate = props.catAxisLabelRotate;
  if (props.catAxisLabelFontSize !== undefined) opts.catAxisLabelFontSize = props.catAxisLabelFontSize;

  // Value axis
  if (props.valAxisTitle !== undefined) {
    opts.valAxisTitle = props.valAxisTitle;
    opts.showValAxisTitle = true;
  }
  if (props.valAxisHidden !== undefined) opts.valAxisHidden = props.valAxisHidden;
  if (props.valAxisMinVal !== undefined) opts.valAxisMinVal = props.valAxisMinVal;
  if (props.valAxisMaxVal !== undefined) opts.valAxisMaxVal = props.valAxisMaxVal;
  if (props.valAxisLabelFormatCode !== undefined) opts.valAxisLabelFormatCode = props.valAxisLabelFormatCode;
  if (props.valAxisMajorUnit !== undefined) opts.valAxisMajorUnit = props.valAxisMajorUnit;

  // Bar-specific
  if (props.barDir !== undefined) opts.barDir = props.barDir;
  if (props.barGrouping !== undefined) opts.barGrouping = props.barGrouping;
  if (props.barGapWidthPct !== undefined) opts.barGapWidthPct = props.barGapWidthPct;

  // Line-specific
  if (props.lineSmooth !== undefined) opts.lineSmooth = props.lineSmooth;
  if (props.lineDataSymbol !== undefined) opts.lineDataSymbol = props.lineDataSymbol;
  if (props.lineSize !== undefined) opts.lineSize = props.lineSize;

  // Pie/doughnut
  if (props.firstSliceAng !== undefined) opts.firstSliceAng = props.firstSliceAng;
  if (props.holeSize !== undefined) opts.holeSize = props.holeSize;

  // Radar
  if (props.radarStyle !== undefined) opts.radarStyle = props.radarStyle;

  // Data labels
  if (props.dataLabelColor !== undefined) opts.dataLabelColor = resolveColor(props.dataLabelColor, theme);
  if (props.dataLabelFontSize !== undefined) opts.dataLabelFontSize = props.dataLabelFontSize;
  if (props.dataLabelFontFace !== undefined) opts.dataLabelFontFace = props.dataLabelFontFace;
  if (props.dataLabelFontBold !== undefined) opts.dataLabelFontBold = props.dataLabelFontBold;
  if (props.dataLabelPosition !== undefined) opts.dataLabelPosition = props.dataLabelPosition;

  slide.addChart(chartType as any, data as any[], opts as any);
}

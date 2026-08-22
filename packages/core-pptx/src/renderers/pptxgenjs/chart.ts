/**
 * PptxIR charts → PptxGenJS.
 *
 * Pure vocabulary translation. Every colour, font family, bold toggle and
 * palette entry was resolved by the compiler, so nothing here consults a theme
 * or decides a default.
 */

import type PptxGenJS from 'pptxgenjs';
import type {
  PptxIrChartAxis,
  PptxIrChartElement,
  PptxIrChartGridLine,
  PptxIrChartLabelFont,
  PptxIrChartValueAxis,
} from '../../ir/types';
import { emuToInches } from '../../ir/units';

type Opts = Record<string, unknown>;

export function emitChart(
  slide: PptxGenJS.Slide,
  element: PptxIrChartElement
): void {
  const data = element.series.map((series) => {
    const entry: Opts = {};
    if (series.name !== undefined) entry.name = series.name;
    if (series.labels) entry.labels = series.labels;
    if (series.values) entry.values = series.values;
    if (series.sizes) entry.sizes = series.sizes;
    return entry;
  });

  slide.addChart(
    element.chartType as never,
    data as never,
    chartOpts(element) as never
  );
}

function chartOpts(element: PptxIrChartElement): Opts {
  const { options: o, transform } = element;
  const opts: Opts = {
    x: emuToInches(transform.xEmu),
    y: emuToInches(transform.yEmu),
    w: emuToInches(transform.widthEmu),
    h: emuToInches(transform.heightEmu),
  };

  if (o.colors.length > 0) opts.chartColors = [...o.colors];

  assignDefined(opts, {
    showLegend: o.showLegend,
    showTitle: o.showTitle,
    showValue: o.showValue,
    showPercent: o.showPercent,
    showLabel: o.showLabel,
    showSerName: o.showSeriesName,
    title: o.title,
    legendPos: o.legendPosition,
    barDir: o.barDirection,
    barGrouping: o.barGrouping,
    barGapWidthPct: o.barGapWidthPercent,
    barOverlapPct: o.barOverlapPercent,
    lineSmooth: o.lineSmooth,
    lineDataSymbol: o.lineDataSymbol,
    lineSize: o.lineSize,
    lineDataSymbolSize: o.lineDataSymbolSize,
    firstSliceAng: o.firstSliceAngle,
    holeSize: o.holeSize,
    radarStyle: o.radarStyle,
    dataLabelPosition: o.dataLabelPosition,
  });

  applyLabelFont(opts, o.titleFont, {
    face: 'titleFontFace',
    bold: 'titleBold',
    size: 'titleFontSize',
    color: 'titleColor',
  });
  applyLabelFont(opts, o.legendFont, {
    face: 'legendFontFace',
    size: 'legendFontSize',
    color: 'legendColor',
  });
  applyLabelFont(opts, o.dataLabelFont, {
    face: 'dataLabelFontFace',
    bold: 'dataLabelFontBold',
    size: 'dataLabelFontSize',
    color: 'dataLabelColor',
  });

  applyAxis(opts, o.categoryAxis, {
    title: 'catAxisTitle',
    showTitle: 'showCatAxisTitle',
    hidden: 'catAxisHidden',
    labelRotate: 'catAxisLabelRotate',
    gridLine: 'catGridLine',
    showLine: 'catAxisLineShow',
    face: 'catAxisLabelFontFace',
    bold: 'catAxisLabelFontBold',
    size: 'catAxisLabelFontSize',
    color: 'catAxisLabelColor',
  });

  applyValueAxis(opts, o.valueAxis);

  if (o.dataBorder) {
    opts.dataBorder = {
      pt: o.dataBorder.widthPoints,
      color: o.dataBorder.color.hex,
    };
  }

  return opts;
}

interface LabelFontKeys {
  face: string;
  /** Absent for the legend, which has no bold toggle in PowerPoint. */
  bold?: string;
  size: string;
  color: string;
}

function applyLabelFont(
  opts: Opts,
  font: PptxIrChartLabelFont,
  keys: LabelFontKeys
): void {
  if (font.fontFamily !== undefined) opts[keys.face] = font.fontFamily;
  if (font.bold !== undefined && keys.bold) opts[keys.bold] = font.bold;
  if (font.fontSize !== undefined) opts[keys.size] = font.fontSize;
  if (font.color) opts[keys.color] = font.color.hex;
}

interface AxisKeys extends LabelFontKeys {
  title: string;
  showTitle: string;
  hidden: string;
  labelRotate: string;
  gridLine: string;
  showLine: string;
}

function applyAxis(opts: Opts, axis: PptxIrChartAxis, keys: AxisKeys): void {
  if (axis.title !== undefined) {
    opts[keys.title] = axis.title;
    opts[keys.showTitle] = true;
  }
  if (axis.hidden !== undefined) opts[keys.hidden] = axis.hidden;
  if (axis.labelRotate !== undefined) opts[keys.labelRotate] = axis.labelRotate;
  if (axis.showLine !== undefined) opts[keys.showLine] = axis.showLine;
  if (axis.gridLine) opts[keys.gridLine] = gridLineOpts(axis.gridLine);
  applyLabelFont(opts, axis.labelFont, keys);
}

function applyValueAxis(opts: Opts, axis: PptxIrChartValueAxis): void {
  applyAxis(opts, axis, {
    title: 'valAxisTitle',
    showTitle: 'showValAxisTitle',
    hidden: 'valAxisHidden',
    labelRotate: 'valAxisLabelRotate',
    gridLine: 'valGridLine',
    showLine: 'valAxisLineShow',
    face: 'valAxisLabelFontFace',
    bold: 'valAxisLabelFontBold',
    size: 'valAxisLabelFontSize',
    color: 'valAxisLabelColor',
  });
  assignDefined(opts, {
    valAxisMinVal: axis.minValue,
    valAxisMaxVal: axis.maxValue,
    valAxisMajorUnit: axis.majorUnit,
    valAxisLabelFormatCode: axis.labelFormatCode,
  });
}

function gridLineOpts(gridLine: PptxIrChartGridLine): Opts {
  const opts: Opts = {};
  if (gridLine.style !== undefined) opts.style = gridLine.style;
  if (gridLine.size !== undefined) opts.size = gridLine.size;
  if (gridLine.color) opts.color = gridLine.color.hex;
  return opts;
}

function assignDefined(target: Opts, values: Opts): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) target[key] = value;
  }
}

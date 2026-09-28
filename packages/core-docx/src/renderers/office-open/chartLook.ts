/**
 * Word's Insert Chart look, stated for office-open's charts.
 *
 * On the docx.js renderer `ChartRun` writes a chart the way Word's Insert
 * Chart does: value gridlines and a category axis line in a tint of Text 1,
 * no tick marks, Word's bar gaps, straight lines with round markers, slice
 * borders in Background 1, a doughnut with a hole. `@office-open/docx` states
 * none of it, and each reader fills the gap its own way — cross ticks, dark
 * axis lines, no gridlines, curved lines, a doughnut with no hole — while two
 * of the gaps misdraw the data: a scatter chart's x values go in as text, so a
 * reader plots them at 1, 2, 3…, and an untitled chart gets a title invented
 * from its lone series' name, which also rescales its value axis.
 *
 * So office-open writes the look docx.js writes, and a chart draws the same on
 * either renderer; `__tests__/chart-cross-backend.test.ts` holds the two to
 * it, element by element. The look lives here, in one place, in two halves:
 * what the backend passes through (`seriesLook`, per series — it hands each
 * series object to the part whole) and what is spliced into the part
 * afterwards (`plotLook`), since the backend drops every chart-level option
 * but eight.
 *
 * The tints are theme references, as Word writes them, not colours: the
 * gridlines follow the document theme's Text 1 on both renderers.
 */

import type {
  ChartAxisEdits,
  ChartColor,
  ChartPartInput,
  ChartStroke,
} from '@json-to-office/shared/rendering';
import type { DocxIrChartRun, DocxIrChartType } from '../../ir/types';
import { scatterX } from '../../ir/chartValues';

/** Word's gridline and axis-line tint: Text 1 at 15%. */
const TEXT_1_TINT: ChartColor = { scheme: 'tx1', lumMod: 15000, lumOff: 85000 };

/** A scatter chart's axis lines, a shade darker: Text 1 at 25%. */
const SCATTER_AXIS_TINT: ChartColor = {
  scheme: 'tx1',
  lumMod: 25000,
  lumOff: 75000,
};

/** Every gridline and axis line is 0.75pt. */
const HAIRLINE_POINTS = 0.75;

const GRIDLINES: NonNullable<ChartAxisEdits['gridLine']> = {
  size: HAIRLINE_POINTS,
  color: TEXT_1_TINT,
};

const AXIS_LINE: ChartStroke = {
  widthPoints: HAIRLINE_POINTS,
  color: TEXT_1_TINT,
};

/** Tick marks off, labels beside the axis. */
const NO_TICKS: ChartAxisEdits = {
  majorTickMark: 'none',
  minorTickMark: 'none',
  tickLabelPosition: 'nextTo',
};

/** A line series: 2.25pt, round caps and joins (1.5pt on a scatter chart). */
const LINE_SERIES: Pick<
  ChartPartInput,
  'lineWidthPoints' | 'lineCap' | 'lineJoin' | 'markerLineWidthPoints'
> = {
  lineWidthPoints: 2.25,
  lineCap: 'rnd',
  lineJoin: 'round',
  markerLineWidthPoints: HAIRLINE_POINTS,
};

/** Round markers, size 5, on every line, radar and scatter series. */
const MARKER = { symbol: 'circle', size: 5 } as const;

/**
 * What each series object carries to the backend, which passes it through
 * whole: the marker, a line that is not smoothed, and bars that keep their
 * colour below zero.
 *
 * `c:smooth` has to be stated: with none, Word and LibreOffice both draw a
 * line chart's series as a curve through its points.
 */
export function seriesLook(
  chartType: DocxIrChartType
): Record<string, unknown> {
  switch (chartType) {
    case 'line':
    case 'scatter':
      return { marker: MARKER, smooth: false };
    case 'radar':
      return { marker: MARKER };
    case 'column':
    case 'bar':
      return { invertIfNegative: false };
    default:
      return {};
  }
}

/** The axes: where each sits, its gridlines, ticks and line. */
function axesLook(
  chartType: DocxIrChartType
): Pick<ChartPartInput, 'categoryAxis' | 'valueAxis'> {
  switch (chartType) {
    case 'column':
    case 'bar':
    case 'line':
    case 'area': {
      // A bar chart lies on its side: categories up the left, values along
      // the bottom.
      const horizontal = chartType === 'bar';
      return {
        categoryAxis: {
          position: horizontal ? 'l' : 'b',
          ...NO_TICKS,
          line: AXIS_LINE,
        },
        valueAxis: {
          position: horizontal ? 'b' : 'l',
          gridLine: GRIDLINES,
          ...NO_TICKS,
          lineVisible: false,
          crossBetween: chartType === 'area' ? 'midCat' : 'between',
        },
      };
    }
    case 'radar':
      // Spokes and rings: gridlines on both axes, and crossed ticks.
      return {
        categoryAxis: {
          position: 'b',
          gridLine: GRIDLINES,
          ...NO_TICKS,
          majorTickMark: 'cross',
          line: AXIS_LINE,
        },
        valueAxis: {
          position: 'l',
          gridLine: GRIDLINES,
          ...NO_TICKS,
          majorTickMark: 'cross',
          line: AXIS_LINE,
          crossBetween: 'between',
        },
      };
    case 'scatter': {
      // Both axes are value axes, X first; Word draws Y gridlines only.
      const line: ChartStroke = { ...AXIS_LINE, color: SCATTER_AXIS_TINT };
      return {
        categoryAxis: {
          position: 'b',
          ...NO_TICKS,
          line,
          crossBetween: 'midCat',
        },
        valueAxis: {
          position: 'l',
          gridLine: GRIDLINES,
          ...NO_TICKS,
          line,
          crossBetween: 'midCat',
        },
      };
    }
    default:
      return {};
  }
}

/**
 * Everything of the look the splice writes, for one chart.
 *
 * Axis edits come back whole, for `chartParts.ts` to merge its axis titles
 * into.
 */
export function plotLook(chart: DocxIrChartRun): Partial<ChartPartInput> {
  const common: Partial<ChartPartInput> = {
    ...axesLook(chart.chartType),
    autoTitleDeleted: !(chart.title && chart.showTitle !== false),
    plotAreaUnfilled: true,
  };

  switch (chart.chartType) {
    case 'column':
      return { ...common, dataBorder: 'none', gapWidth: 219, overlap: -27 };
    case 'bar':
      return { ...common, dataBorder: 'none', gapWidth: 182, overlap: 0 };
    case 'area':
      return { ...common, dataBorder: 'none' };
    case 'line':
      return { ...common, ...LINE_SERIES, lineMarkers: true };
    case 'radar':
      return { ...common, ...LINE_SERIES, radarStyle: 'marker' };
    case 'scatter': {
      const labels = chart.series[0]?.labels ?? [];
      return {
        ...common,
        ...LINE_SERIES,
        lineWidthPoints: 1.5,
        scatterStyle: 'lineMarker',
        scatterXValues: labels.map((_, index) => scatterX(labels, index)),
      };
    }
    case 'pie':
    case 'doughnut':
      return {
        ...common,
        dataBorder: { widthPoints: 1.5, color: { scheme: 'lt1' } },
        firstSliceAngle: 0,
        ...(chart.chartType === 'doughnut' ? { holeSize: 50 } : {}),
      };
    default:
      return common;
  }
}

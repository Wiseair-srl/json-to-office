/**
 * A native chart on the docx.js renderer: `DocxIrChartRun` → docx 9.8's
 * `ChartRun`.
 *
 * `ChartRun` writes the whole of a chart — the `c:chartSpace` part, its
 * relationship and the workbook "Edit Data" opens — so this layer only
 * translates vocabulary. Parity with office-open is on content and placement:
 * data, series order and names, series colours, every text element's face,
 * size, colour and weight, the title and axis titles, the legend, the extent
 * and the anchor, and a chart area with no fill and no border. The plot's
 * internals — gridlines, tick marks, axis lines, bar gaps — follow what Word
 * writes for a chart made with Insert Chart, which is what `ChartRun`
 * defaults to; `docs/architecture/office-renderer-ir.md` records each
 * difference from office-open.
 *
 * The chart-wide font carries no size in `ChartRun` (`Omit<ChartFont,
 * "size">`), so every text element states its own. A new text element — data
 * labels, a data table — has to do the same, or Word draws it at 9pt.
 *
 * `docx/charts` is loaded when `render()` starts rather than with the package:
 * see `docxSubpath.ts`. Only types come from it statically.
 */

import type { IFloating, ParagraphChild } from 'docx';
import type {
  ChartAxis,
  ChartFont,
  ChartLegendPosition,
  ChartRunOptions,
  ChartValueAxis,
} from 'docx/charts';
import { assertNever } from '@json-to-office/shared/rendering';
import type { DocxIrChartLegendPosition, DocxIrChartRun } from '../../ir/types';
import { scatterX } from '../../ir/chartValues';
import { emuToPixels } from '../../ir/units';
import { chartTextRoles, type ChartTextRole } from '../chartText';
import { docxSubpath } from './docxSubpath';

const charts = docxSubpath('docx/charts', 'chart', () => import('docx/charts'));

/**
 * Load `docx/charts`, once per process. Never rejects: a docx without the
 * entry fails only a document that draws a chart, when it is emitted.
 * `render()` awaits it; a caller of `buildDocument` with charts must too.
 */
export function loadDocxCharts(): Promise<void> {
  return charts.load();
}

/** IR legend positions, in `ChartRun`'s words. */
const LEGEND_POSITION: Readonly<
  Record<DocxIrChartLegendPosition, ChartLegendPosition>
> = {
  b: 'bottom',
  l: 'left',
  r: 'right',
  t: 'top',
  tr: 'topRight',
};

/** One text role as a chart font: face, size, colour and weight, all stated. */
function chartFont(role: ChartTextRole): ChartFont {
  return {
    name: role.fontFamily,
    size: role.fontSize,
    color: role.color,
    bold: role.bold ?? false,
  };
}

/**
 * `DocxIrChartRun` → `ChartRunOptions`.
 *
 * Pure, and exported for tests: asserting on options is far cheaper than
 * unzipping a chart part.
 */
export function chartRunOptions(
  chart: DocxIrChartRun,
  floating?: IFloating
): ChartRunOptions {
  const roles = chartTextRoles(chart.textFont);
  const text = chartFont(roles.text);
  const axisTitle = chartFont(roles.axisTitle);

  const palette = chart.colors;
  const colorAt = (index: number): string | undefined =>
    palette.length > 0 ? palette[index % palette.length] : undefined;
  const withColor = (index: number): { color?: string } => {
    const color = colorAt(index);
    return color ? { color } : {};
  };
  // Office-open's default name for an unnamed series, which `ChartRun`
  // requires.
  const seriesName = (index: number): string =>
    chart.series[index].name ?? `Series ${index + 1}`;
  // One category axis, drawn from the first series' labels: the compiler has
  // refused a chart whose series disagree about them.
  const categories = chart.series[0]?.labels ?? [];

  const axis = (title: string | undefined): ChartAxis & ChartValueAxis => ({
    ...(title ? { title: { text: title, font: axisTitle } } : {}),
    font: text,
  });

  const common = {
    ...(chart.title && chart.showTitle !== false
      ? { title: { text: chart.title, font: chartFont(roles.title) } }
      : {}),
    legend:
      chart.showLegend === false
        ? (false as const)
        : {
            position: LEGEND_POSITION[chart.legendPosition ?? 'b'],
            font: text,
          },
    font: { name: roles.text.fontFamily, color: roles.text.color },
    // Office-open's chart space is unfilled and unbordered; `ChartRun`'s
    // default is Word's white fill and grey border.
    chartArea: { fill: 'none', border: 'none' as const },
    transformation: {
      width: emuToPixels(chart.widthEmu),
      height: emuToPixels(chart.heightEmu),
    },
    // Without an authored description `ChartRun` describes the chart from
    // its data, which is deterministic; the name stays empty, as it is on
    // every other drawing this renderer writes.
    ...(chart.altText
      ? { altText: { name: '', description: chart.altText } }
      : {}),
    ...(floating ? { floating } : {}),
  };

  switch (chart.chartType) {
    case 'column':
    case 'bar':
    case 'area':
    case 'line':
      return {
        ...common,
        type: chart.chartType,
        categories,
        ...(chart.chartType === 'line' ? { markers: true } : {}),
        series: chart.series.map((entry, index) => ({
          name: seriesName(index),
          values: entry.values,
          ...withColor(index),
        })),
        categoryAxis: axis(chart.categoryAxisTitle),
        valueAxis: axis(chart.valueAxisTitle),
      } as ChartRunOptions;

    case 'pie':
    case 'doughnut':
      // No axes, so no axis titles: the compiler warns when there are some.
      // Colours go per slice, on every ring of a doughnut.
      return {
        ...common,
        type: chart.chartType,
        categories,
        series: chart.series.map((entry, index) => ({
          name: seriesName(index),
          values: entry.values,
          ...(palette.length > 0
            ? { colors: entry.values.map((_, point) => colorAt(point)) }
            : {}),
        })),
      } as ChartRunOptions;

    case 'radar':
      return {
        ...common,
        type: 'radar',
        categories,
        markers: true,
        series: chart.series.map((entry, index) => ({
          name: seriesName(index),
          values: entry.values,
          ...withColor(index),
        })),
        categoryAxis: axis(chart.categoryAxisTitle),
        valueAxis: axis(chart.valueAxisTitle),
      };

    case 'scatter':
      // Each point's x is its label read as a number (`chartValues.ts`).
      // Word's scatter draws Y gridlines only.
      return {
        ...common,
        type: 'scatter',
        markers: true,
        lines: 'straight',
        series: chart.series.map((entry, index) => ({
          name: seriesName(index),
          points: entry.values.map((y, point) => ({
            x: scatterX(entry.labels, point),
            y,
          })),
          ...withColor(index),
        })),
        xAxis: { ...axis(chart.categoryAxisTitle), gridlines: false },
        yAxis: axis(chart.valueAxisTitle),
      };

    case 'bubble':
      // Unreachable: the schema has no bubble, and the compiler refuses one.
      throw new Error(
        'the docxjs renderer has no emitter for a bubble chart; ' +
          'the compiler should have refused it'
      );

    default:
      return assertNever(chart.chartType, 'DocxIrChartType');
  }
}

/**
 * A chart run. Throws a named error when `docx/charts` was never loaded, or
 * could not be — a docx older than 9.8.0.
 */
export function emitChart(
  chart: DocxIrChartRun,
  floating?: IFloating
): ParagraphChild {
  // `ChartRun` extends `Run`, which docx.js leaves out of `ParagraphChild`
  // although a paragraph takes it like any other run.
  return new (charts.get().ChartRun)(
    chartRunOptions(chart, floating)
  ) as unknown as ParagraphChild;
}

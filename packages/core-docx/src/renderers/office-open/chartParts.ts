/**
 * A native chart's look and references, for DOCX.
 *
 * What a chart needs beyond its type and data — the cell references, the
 * colours, the axes, the fonts, Office's blanks — is format-neutral and is
 * stated as backend options by `chartLook` in
 * `@json-to-office/shared/rendering`; the pptx sibling of this file does the
 * same. `@office-open/docx` 0.14 hands those options to the chart part whole,
 * and embeds the workbook `c:externalData` points at, with its relationship and
 * content type, from `externalData.data` — see `chartOptions` in `emit.ts`.
 *
 * What is left here is the IR's side of that — `chartInput` — and the one
 * edit no option carries, applied to the emitted parts: a scatter chart's
 * style (`finishChartXml`).
 */

import type AdmZip from 'adm-zip';
import {
  finishChartXml,
  matchChartParts,
} from '@json-to-office/shared/rendering';
import type {
  ChartPartInput,
  ChartTextStyle,
} from '@json-to-office/shared/rendering';
import type { DocxIrChartRun } from '../../ir/types';
import { chartTextRoles } from '../chartText';
import { plotLook } from './chartLook';

/**
 * One chart run, in the shared look's vocabulary.
 *
 * The docx component exposes a smaller styling surface than the pptx one, so
 * only the axis titles have an authored prop behind them. The theme's chart
 * text style goes on both: as the chart-wide default the tick labels and
 * legend inherit, and on each axis title, which would otherwise take Word's
 * large bold default. The roles themselves — which text takes the style as
 * is, and which adjusts it — are shared with the docx.js renderer
 * (`../chartText`). Everything else is the look docx.js draws, from
 * `chartLook.ts`: gridlines, ticks, axis lines, gaps, markers and borders.
 */
export function chartInput(chart: DocxIrChartRun): ChartPartInput {
  const roles = chartTextRoles(chart.textFont);
  const textFont: ChartTextStyle = roles.text;
  const axisTitleFont: ChartTextStyle = roles.axisTitle;
  const chartTitleFont: ChartTextStyle = roles.title;
  const look = plotLook(chart);
  const categoryAxis = {
    ...look.categoryAxis,
    ...(chart.categoryAxisTitle
      ? { title: chart.categoryAxisTitle, titleFont: axisTitleFont }
      : {}),
  };
  const valueAxis = {
    ...look.valueAxis,
    ...(chart.valueAxisTitle
      ? { title: chart.valueAxisTitle, titleFont: axisTitleFont }
      : {}),
  };
  return {
    ...look,
    chartType: chart.chartType,
    series: chart.series,
    colors: chart.colors,
    ...(chart.title && chart.showTitle !== false ? { title: chart.title } : {}),
    textFont,
    titleFont: chartTitleFont,
    ...(chart.legendPosition ? { legendPosition: chart.legendPosition } : {}),
    ...(Object.keys(categoryAxis).length > 0 ? { categoryAxis } : {}),
    ...(Object.keys(valueAxis).length > 0 ? { valueAxis } : {}),
  };
}

/**
 * Finish every chart part in the package with what no option says.
 *
 * Parts are matched to IR nodes by content rather than by position: the emitter
 * fills its array while *building* the backend's document object and the
 * backend numbers its parts while *stringifying* that object, and the two walks
 * disagree the moment a chart sits in a header or footer. The match also
 * proves every emitted chart reached the package.
 */
export function finishChartParts(
  zip: AdmZip,
  charts: readonly DocxIrChartRun[]
): void {
  if (charts.length === 0) return;

  const parts = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .map((name) => name.match(/^word\/charts\/chart(\d+)\.xml$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(
      (match) =>
        [
          Number(match[1]),
          zip.getEntry(match[0])!.getData().toString('utf8'),
        ] as const
    );

  const inputs = charts.map(chartInput);
  for (const { ordinal, xml, chart } of matchChartParts(parts, inputs)) {
    const finished = finishChartXml(xml, chart);
    if (finished === xml) continue;
    zip.updateFile(
      zip.getEntry(`word/charts/chart${ordinal}.xml`)!,
      Buffer.from(finished, 'utf8')
    );
  }
}

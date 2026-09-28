/**
 * A native chart's text roles, shared by both DOCX renderers.
 *
 * The IR carries one chart text style, resolved from the theme. A chart part
 * has more text than that: tick labels, the legend, axis titles and the chart
 * title. Which of them takes the style as is, and which adjusts it, is decided
 * here once, so the two backends cannot drift apart on a chart's type — each
 * only spells the roles in its own vocabulary.
 *
 * No `docx` or `@office-open` import: this sits outside both renderer
 * directories, and the import boundary forbids either here.
 */

import type { DocxIrChartTextFont } from '../ir/types';

/** Word's chart title size over its chart text size: 14pt over 10pt. */
export const CHART_TITLE_SCALE = 1.4;

/** One chart text role: face, size in points, colour and weight. */
export interface ChartTextRole {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold?: boolean;
}

export interface ChartTextRoles {
  /**
   * Tick labels and the legend. No weight: as a chart-wide default, a `b`
   * would also unbold the chart title.
   */
  text: ChartTextRole;
  /**
   * Axis titles: the chart text at its own weight, which Word would otherwise
   * draw at its large bold default.
   */
  axisTitle: ChartTextRole;
  /**
   * The chart title. Once the chart text states a size the title has to state
   * its own: Word scales an unsized title up from that default, LibreOffice
   * draws it at the default itself — a title no bigger than a tick label. So
   * it is written at Word's own ratio, bold as Word draws it.
   */
  title: ChartTextRole;
}

export function chartTextRoles(font: DocxIrChartTextFont): ChartTextRoles {
  const { bold, ...rest } = font;
  const text: ChartTextRole = rest;
  return {
    text,
    axisTitle: { ...text, bold },
    title: {
      ...text,
      fontSize: Math.round(text.fontSize * CHART_TITLE_SCALE),
      bold: true,
    },
  };
}

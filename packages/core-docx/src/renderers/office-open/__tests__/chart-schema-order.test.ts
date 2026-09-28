/**
 * Structural validation of every corpus chart part, on both DOCX renderers.
 *
 * The splice edits another library's chart XML as strings, and DrawingML fixes
 * the order and cardinality of a chart's children: Word answers a violation
 * with a repair prompt, not a mis-drawn chart, and LibreOffice does not care
 * at all, so neither a screenshot nor a substring assertion can see one. The
 * pptx twin (`core-pptx/…/office-open/__tests__/chart-schema-order.test.ts`)
 * caught two such defects there; the Word look office-open now splices in
 * (`chartLook.ts`) writes a dozen more elements, each into a fixed slot.
 *
 * The orders below are unions of the CT_* sequences for the families these
 * charts use. A union is sound because the families never disagree about two
 * tags they share. docx.js is walked too, as a check on the orders themselves.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import { CORPUS } from '../../../__tests__/fixtures/corpus';

const CASES = CORPUS.filter(
  (c) => c.name.startsWith('chart/') || c.name === 'blocks/chart-figure-native'
);

/** CT_Chart. */
const CHART_ORDER = [
  'title',
  'autoTitleDeleted',
  'pivotFmts',
  'view3D',
  'floor',
  'sideWall',
  'backWall',
  'plotArea',
  'legend',
  'plotVisOnly',
  'dispBlanksAs',
  'extLst',
];

/** CT_PlotArea: the plot groups and axes are matched by suffix below. */
const PLOT_AREA_ORDER = ['layout', 'Chart', 'Ax', 'dTable', 'spPr', 'extLst'];

/** CT_*Ser, unioned across bar, line, pie, doughnut, area, radar and scatter. */
const SERIES_ORDER = [
  'idx',
  'order',
  'tx',
  'spPr',
  'invertIfNegative',
  'pictureOptions',
  'explosion',
  'marker',
  'dPt',
  'dLbls',
  'trendline',
  'errBars',
  'cat',
  'xVal',
  'val',
  'yVal',
  'smooth',
  'shape',
  'extLst',
];

/** CT_CatAx and CT_ValAx, unioned. */
const AXIS_ORDER = [
  'axId',
  'scaling',
  'delete',
  'axPos',
  'majorGridlines',
  'minorGridlines',
  'title',
  'numFmt',
  'majorTickMark',
  'minorTickMark',
  'tickLblPos',
  'spPr',
  'txPr',
  'crossAx',
  'crosses',
  'crossesAt',
  'crossBetween',
  'majorUnit',
  'minorUnit',
  'auto',
  'lblAlgn',
  'lblOffset',
  'tickLblSkip',
  'tickMarkSkip',
  'noMultiLvlLbl',
  'dispUnits',
  'extLst',
];

/** CT_BarChart, CT_LineChart, CT_PieChart, CT_DoughnutChart and friends. */
const PLOT_ORDER = [
  'barDir',
  'scatterStyle',
  'radarStyle',
  'grouping',
  'varyColors',
  'ser',
  'dLbls',
  'gapWidth',
  'overlap',
  'serLines',
  'dropLines',
  'hiLowLines',
  'upDownBars',
  'marker',
  'smooth',
  'firstSliceAng',
  'holeSize',
  'axId',
  'extLst',
];

/** Children that may appear more than once. */
const REPEATABLE = new Set(['dPt', 'ser', 'trendline', 'axId', 'Ax', 'Chart']);

/**
 * The direct children of one element, in order. Depth-tracked: `c:marker`
 * holds a `c:spPr`, which is not a sibling of the series' own.
 */
function directChildren(elementXml: string): string[] {
  const inner = elementXml.slice(
    elementXml.indexOf('>') + 1,
    elementXml.lastIndexOf('</')
  );
  const children: string[] = [];
  let depth = 0;
  for (const [, closing, name, selfClosing] of inner.matchAll(
    /<(\/?)c:([A-Za-z0-9]+)[^>]*?(\/?)>/g
  )) {
    if (closing) {
      depth--;
      continue;
    }
    if (depth === 0) children.push(name);
    if (!selfClosing) depth++;
  }
  return children;
}

/** Every element with this tag, as full XML slices. */
function elements(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<c:${tag}>[\\s\\S]*?</c:${tag}>`, 'g')) ?? [];
}

function assertOrdered(
  children: string[],
  order: readonly string[],
  label: string
): void {
  const ranks = children
    .filter((child) => order.includes(child))
    .map((child) => order.indexOf(child));
  expect(
    [...ranks].sort((a, b) => a - b),
    `${label}: children out of schema order — ${children.join(', ')}`
  ).toEqual(ranks);
  expect(
    children.filter((child) => !order.includes(child)),
    `${label}: children the schema does not allow here`
  ).toEqual([]);

  const seen = new Map<string, number>();
  for (const child of children) seen.set(child, (seen.get(child) ?? 0) + 1);
  for (const [child, count] of seen) {
    if (REPEATABLE.has(child)) continue;
    expect(count, `${label}: ${child} appears ${count} times`).toBe(1);
  }
}

/** A plot area's children, with each plot group and axis named by kind. */
const plotAreaChildren = (plotArea: string): string[] =>
  directChildren(plotArea).map((child) =>
    child.endsWith('Chart') ? 'Chart' : child.endsWith('Ax') ? 'Ax' : child
  );

async function chartParts(
  document: unknown,
  renderer: 'docxjs' | 'office-open'
): Promise<string[]> {
  const { buffer } = await generateBufferViaIr(
    structuredClone(document) as never,
    { renderer, warnings: [] }
  );
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter((entry) => /^word\/charts\/chart\d+\.xml$/.test(entry.entryName))
    .map((entry) => entry.getData().toString('utf8'));
}

describe('chart parts are schema-ordered', () => {
  it.each(
    CASES.flatMap((c) =>
      (['office-open', 'docxjs'] as const).map(
        (renderer) => [c.name, renderer, c] as const
      )
    )
  )(
    '%s on %s',
    async (_name, renderer, testCase) => {
      const parts = await chartParts(testCase.document, renderer);
      expect(parts.length).toBeGreaterThan(0);
      for (const xml of parts) {
        const [chart] = elements(xml, 'chart');
        assertOrdered(directChildren(chart), CHART_ORDER, 'c:chart');
        const [plotArea] = elements(xml, 'plotArea');
        assertOrdered(
          plotAreaChildren(plotArea),
          PLOT_AREA_ORDER,
          'c:plotArea'
        );
        for (const series of elements(xml, 'ser')) {
          assertOrdered(directChildren(series), SERIES_ORDER, 'c:ser');
        }
        for (const tag of ['catAx', 'valAx']) {
          for (const axis of elements(xml, tag)) {
            assertOrdered(directChildren(axis), AXIS_ORDER, `c:${tag}`);
          }
        }
        for (const tag of [
          'barChart',
          'lineChart',
          'areaChart',
          'pieChart',
          'doughnutChart',
          'radarChart',
          'scatterChart',
        ]) {
          for (const plot of elements(xml, tag)) {
            assertOrdered(directChildren(plot), PLOT_ORDER, `c:${tag}`);
          }
        }
      }
    },
    60_000
  );
});

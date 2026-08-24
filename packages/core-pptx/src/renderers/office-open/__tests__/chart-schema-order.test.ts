/**
 * Structural validation of the chart parts this adapter writes.
 *
 * Every other test here asserts that a substring is present. None of them can
 * see the failure that actually matters: DrawingML fixes the order and the
 * cardinality of a chart's children, and PowerPoint answers a violation with a
 * *repair prompt* rather than a mis-drawn chart. LibreOffice does not care at
 * all, so a screenshot cannot see it either.
 *
 * Two real bugs shipped past every substring assertion and a full green CI:
 * `c:overlap` written before `c:ser` inside `c:barChart`, and two sibling
 * `c:marker` elements in one `c:ser` when the backend had already written one.
 * Both were found by opening the file in PowerPoint. This walks the same ground
 * automatically, so the next one is caught here instead.
 *
 * The orders below are the union of the CT_* sequences for the families this
 * adapter emits. A union is sound because the families never disagree about two
 * tags they share — `cat`/`val` and `xVal`/`yVal` never co-occur, and neither do
 * `marker` and `invertIfNegative`.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

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
];

/** Children that may appear at most once. `dPt` and `ser` may repeat. */
const REPEATABLE = new Set(['dPt', 'ser', 'trendline', 'axId', 'extLst']);

/**
 * The direct children of one element, in order.
 *
 * Depth-tracked rather than regex-matched: `c:marker` contains a `c:spPr`, and
 * counting that as a sibling of the series' own `c:spPr` would report a
 * duplicate that is not there.
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

  const seen = new Map<string, number>();
  for (const child of children) {
    seen.set(child, (seen.get(child) ?? 0) + 1);
  }
  for (const [child, count] of seen) {
    if (REPEATABLE.has(child)) continue;
    expect(count, `${label}: ${child} appears ${count} times`).toBe(1);
  }
}

/** Every chart part in a rendered deck. */
async function chartParts(
  document: PresentationComponentDefinition
): Promise<string[]> {
  const { buffer } = await generateBufferViaIr(document, {
    renderer: 'office-open',
  });
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files)
    .filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))
    .sort();
  return Promise.all(paths.map((path) => zip.file(path)!.async('string')));
}

const deck = (props: Record<string, unknown>) =>
  ({
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        children: [
          {
            name: 'chart',
            props: {
              x: 1,
              y: 1,
              w: 4,
              h: 3,
              data: [
                { name: 'A', labels: ['a', 'b'], values: [1, 2] },
                { name: 'B', labels: ['a', 'b'], values: [3, 4] },
              ],
              ...props,
            },
          },
        ],
      },
    ],
  }) as unknown as PresentationComponentDefinition;

/** Every styling prop this renderer claims, on one chart. */
const FULLY_STYLED = {
  title: 'T',
  showLegend: true,
  legendPos: 'b',
  chartColors: ['1F4E79', 'C00000'],
  showValue: true,
  dataLabelPosition: 'outEnd',
  dataLabelFontSize: 8,
  dataLabelColor: '444444',
  dataBorder: { pt: 1.5, color: '1F3864' },
  barGapWidthPct: 60,
  barOverlapPct: -10,
  valAxisMinVal: 0,
  valAxisMaxVal: 200,
  valAxisMajorUnit: 50,
  valAxisLabelFormatCode: '#,##0',
  valGridLine: { style: 'dot', size: 0.75, color: 'D9D9D9' },
  catAxisTitle: 'Cat',
  valAxisTitle: 'Val',
  catAxisLabelRotate: -30,
  catAxisLabelFontSize: 9,
  catAxisLabelColor: '666666',
  titleFontSize: 13,
  titleColor: '1F3864',
  legendFontSize: 9,
  legendColor: '666666',
  lineSize: 3,
  lineSmooth: true,
  lineDataSymbol: 'circle',
  lineDataSymbolSize: 8,
};

const TYPES = [
  'bar',
  'bar3D',
  'line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'scatter',
] as const;

describe('chart parts are schema-ordered', () => {
  it.each(TYPES)('%s, fully styled', async (type) => {
    for (const xml of await chartParts(deck({ ...FULLY_STYLED, type }))) {
      for (const series of elements(xml, 'ser')) {
        assertOrdered(directChildren(series), SERIES_ORDER, `${type} c:ser`);
      }
      for (const tag of ['catAx', 'valAx']) {
        for (const axis of elements(xml, tag)) {
          assertOrdered(directChildren(axis), AXIS_ORDER, `${type} c:${tag}`);
        }
      }
      for (const tag of [
        'barChart',
        'bar3DChart',
        'lineChart',
        'areaChart',
        'pieChart',
        'doughnutChart',
        'radarChart',
        'scatterChart',
      ]) {
        for (const plot of elements(xml, tag)) {
          assertOrdered(directChildren(plot), PLOT_ORDER, `${type} c:${tag}`);
        }
      }
    }
  });

  it('writes one c:marker even when the author styled it', async () => {
    // The backend writes a marker as soon as `lineDataSymbol` is authored, and
    // the colour splice used to add a second. Two siblings is a repair prompt
    // in PowerPoint and nothing at all in LibreOffice.
    const [xml] = await chartParts(
      deck({ type: 'line', lineDataSymbol: 'circle', lineDataSymbolSize: 8 })
    );
    for (const series of elements(xml, 'ser')) {
      expect(
        directChildren(series).filter((child) => child === 'marker')
      ).toHaveLength(1);
    }
    // ...and it is still coloured.
    expect(xml).toMatch(/<c:marker>[\s\S]*?<a:srgbClr/);
  });

  it('keeps c:overlap after c:ser and only inside a bar chart', async () => {
    const [stacked] = await chartParts(
      deck({ type: 'bar', barGrouping: 'stacked' })
    );
    const plot = elements(stacked, 'barChart')[0];
    const children = directChildren(plot);
    expect(children.indexOf('overlap')).toBeGreaterThan(
      children.lastIndexOf('ser')
    );

    const [line] = await chartParts(
      deck({ type: 'line', barGrouping: 'stacked' })
    );
    expect(directChildren(elements(line, 'lineChart')[0])).not.toContain(
      'overlap'
    );
  });
});

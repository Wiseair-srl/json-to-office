/**
 * The DOCX parity corpus — native charts.
 *
 * One case per chart type the `chart` component offers, plus the props that
 * change what a chart part says (legend, palette, axis titles, a hidden
 * title) and the places a chart can stand: floating, in a header and footer,
 * in a text box, and in the `chart-figure` block on a house theme.
 *
 * Every case renders on the default `docxjs` renderer, which draws a chart
 * through docx's `ChartRun`, so each gets a golden; the cross-backend tests
 * run them on `office-open` as well. The data is inline, and the embedded
 * workbooks are normalized with the rest of the package, so one SHA-256
 * still describes a case.
 */

import { readFileSync } from 'node:fs';
import type { CorpusCase } from './corpus-types';

const exampleBlocks = JSON.parse(
  readFileSync(
    new URL(
      '../../../../jto/src/client/public/templates/client-report-blocks.docx.json',
      import.meta.url
    ),
    'utf8'
  )
).props.blocks;

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Corpus', author: 'JTO' },
    ...props,
  },
  children,
});

const section = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'section', props, children });

const chart = (props: Record<string, unknown>): unknown => ({
  name: 'chart',
  props,
});

const paragraph = (text: string): unknown => ({
  name: 'paragraph',
  props: { text },
});

const REVENUE = {
  name: 'Revenue',
  labels: QUARTERS,
  values: [120, 132, 145, 151],
};
const COST = { name: 'Cost', labels: QUARTERS, values: [80, 84, 91, 95] };

export const CASES: CorpusCase[] = [
  {
    // Every prop that reaches the chart part at once: two series, a title,
    // the legend placed explicitly, both axis titles, a caption and alt text.
    name: 'chart/column-configured',
    document: doc([
      section([
        chart({
          type: 'column',
          data: [REVENUE, COST],
          title: 'Revenue and cost by quarter',
          showLegend: true,
          legendPos: 'b',
          catAxisTitle: 'Quarter',
          valAxisTitle: 'EUR (thousands)',
          caption: 'Revenue and cost, 2026.',
          alt: 'Column chart of revenue and cost by quarter',
        }),
      ]),
    ]),
  },
  {
    // Horizontal bars, no legend.
    name: 'chart/bar-no-legend',
    document: doc([
      section([
        chart({
          type: 'bar',
          data: [
            {
              name: 'Sites',
              labels: ['North', 'Centre', 'South', 'Islands'],
              values: [12, 9, 7, 3],
            },
          ],
          title: 'Sites by region',
          showLegend: false,
        }),
      ]),
    ]),
  },
  {
    // An explicit palette, hex and semantic names, over the theme's.
    name: 'chart/line-explicit-palette',
    document: doc([
      section([
        chart({
          type: 'line',
          data: [REVENUE, COST],
          title: 'Trend',
          chartColors: ['#0F766E', 'accent'],
          legendPos: 'r',
        }),
      ]),
    ]),
  },
  {
    name: 'chart/area-two-series',
    document: doc([
      section([
        chart({
          type: 'area',
          data: [REVENUE, COST],
          title: 'Cumulative view',
          legendPos: 't',
        }),
      ]),
    ]),
  },
  {
    // One series, a colour per slice, legend at the top right.
    name: 'chart/pie',
    document: doc([
      section([
        chart({
          type: 'pie',
          data: [
            {
              name: 'Share',
              labels: ['Retail', 'Wholesale', 'Online'],
              values: [55, 30, 15],
            },
          ],
          title: 'Revenue mix',
          legendPos: 'tr',
        }),
      ]),
    ]),
  },
  {
    // A ring per series, each coloured slice by slice.
    name: 'chart/doughnut-rings',
    document: doc([
      section([
        chart({
          type: 'doughnut',
          data: [
            {
              name: '2025',
              labels: ['Retail', 'Wholesale', 'Online'],
              values: [60, 30, 10],
            },
            {
              name: '2026',
              labels: ['Retail', 'Wholesale', 'Online'],
              values: [55, 30, 15],
            },
          ],
          title: 'Mix, 2025 and 2026',
          legendPos: 'l',
        }),
      ]),
    ]),
  },
  {
    name: 'chart/radar-axis-titles',
    document: doc([
      section([
        chart({
          type: 'radar',
          data: [
            {
              name: 'Current',
              labels: ['Speed', 'Cost', 'Quality', 'Reach', 'Risk'],
              values: [4, 3, 5, 2, 3],
            },
            {
              name: 'Target',
              labels: ['Speed', 'Cost', 'Quality', 'Reach', 'Risk'],
              values: [5, 4, 5, 4, 2],
            },
          ],
          title: 'Capability profile',
          catAxisTitle: 'Dimension',
          valAxisTitle: 'Score',
        }),
      ]),
    ]),
  },
  {
    // Each label is its point's x, a fractional one included.
    name: 'chart/scatter-numeric',
    document: doc([
      section([
        chart({
          type: 'scatter',
          data: [
            {
              name: 'Plant A',
              labels: ['1', '2.5', '4', '6'],
              values: [3.1, 4.2, 5.9, 7.4],
            },
            {
              name: 'Plant B',
              labels: ['1', '2.5', '4', '6'],
              values: [2.4, 3.3, 4.1, 6.8],
            },
          ],
          title: 'Output against load',
          catAxisTitle: 'Load (t)',
          valAxisTitle: 'Output (MWh)',
        }),
      ]),
    ]),
  },
  {
    // A title stated and hidden: no title, and no placeholder for one.
    name: 'chart/hidden-title',
    document: doc([
      section([
        chart({
          type: 'column',
          data: [REVENUE],
          title: 'Not shown',
          showTitle: false,
          width: 4,
          height: 2.5,
        }),
      ]),
    ]),
  },
  {
    // Anchored like `blocks/image-floating-align-and-wrap`, with text to wrap.
    name: 'chart/floating',
    document: doc([
      section([
        chart({
          type: 'column',
          data: [REVENUE],
          title: 'Anchored',
          width: 3,
          height: 2,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'right' },
            verticalPosition: { relative: 'paragraph', align: 'top' },
            wrap: {
              type: 'square',
              side: 'bothSides',
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
            },
          },
        }),
        paragraph(
          'Body text that the floating chart has to wrap around; long enough to run past the anchor and onto a second line, and then some more so the wrap shows.'
        ),
      ]),
    ]),
  },
  {
    // Charts in two sections' headers, a footer and the body: each part
    // numbers its own chart and each chart opens its own workbook.
    name: 'chart/in-header-and-footer',
    document: doc([
      section(
        [
          chart({
            type: 'column',
            data: [{ name: 'B1', labels: ['x', 'y'], values: [1, 2] }],
          }),
          chart({
            type: 'line',
            data: [{ name: 'B2', labels: ['x', 'y'], values: [2, 1] }],
          }),
        ],
        {
          header: [
            chart({
              type: 'bar',
              data: [{ name: 'H1', labels: ['x', 'y'], values: [3, 4] }],
              height: 1,
              showLegend: false,
            }),
          ],
          footer: [
            chart({
              type: 'column',
              data: [{ name: 'F1', labels: ['x', 'y'], values: [5, 6] }],
              height: 1,
              showLegend: false,
            }),
          ],
        }
      ),
      section(
        [
          chart({
            type: 'area',
            data: [{ name: 'B3', labels: ['x', 'y'], values: [7, 8] }],
          }),
        ],
        {
          header: [
            chart({
              type: 'line',
              data: [{ name: 'H2', labels: ['x', 'y'], values: [9, 8] }],
              height: 1,
              showLegend: false,
            }),
          ],
        }
      ),
    ]),
  },
  {
    // A text box in its default table form: the chart takes the box's
    // content width, not the page's.
    name: 'chart/in-text-box',
    document: doc([
      section([
        {
          name: 'text-box',
          props: { style: { padding: { left: 36, right: 36 } } },
          children: [
            paragraph('A chart inside a text box.'),
            chart({ type: 'column', data: [REVENUE], title: 'Boxed' }),
          ],
        },
      ]),
    ]),
  },
  {
    // The report block that numbers, captions and sources a chart, with a
    // native chart in its slot rather than an exported picture.
    name: 'blocks/chart-figure-native',
    document: doc(
      [
        section([
          {
            name: 'block',
            props: {
              ref: 'chart-figure',
              slots: {
                chart: chart({
                  type: 'column',
                  data: [
                    {
                      name: 'Revenue',
                      labels: QUARTERS,
                      values: [1.9, 2.4, 2.7, 3.1],
                    },
                  ],
                  valAxisTitle: 'Revenue (€m)',
                  showLegend: false,
                }),
                caption: 'Revenue by quarter, 2026',
                takeaway:
                  'Each quarter outgrew the last as delivery stabilised.',
                source: 'Source: quarterly operating review, 2026.',
              },
            },
          },
        ]),
      ],
      { theme: 'consulting', blocks: exampleBlocks }
    ),
  },
];

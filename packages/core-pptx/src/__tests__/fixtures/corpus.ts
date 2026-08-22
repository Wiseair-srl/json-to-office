/**
 * The PPTX parity corpus.
 *
 * One list of documents, used both to record golden package hashes from the
 * pipeline as it stands and to check the pipeline that replaces it. Keeping the
 * corpus in one place means the goldens and the parity tests can never drift
 * apart, and that adding a case covers both at once.
 *
 * Every document must be deterministic: generation pins ZIP and metadata
 * timestamps, so one hash per case is a complete description of the output.
 */

import type { PresentationComponentDefinition } from '../../types';

/** A 1x1 transparent PNG. */
export const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A 4x2 PNG, so aspect-ratio maths has something to work with. */
export const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

export interface CorpusCase {
  name: string;
  document: PresentationComponentDefinition;
}

const deck = (
  children: unknown[],
  props: Record<string, unknown> = {}
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Corpus', author: 'JTO', ...props },
    children,
  }) as PresentationComponentDefinition;

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

const SERIES = [
  { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 15] },
];

export const CORPUS: CorpusCase[] = [
  {
    name: 'text/plain',
    document: deck([slide([{ name: 'text', props: { text: 'Hello' } }])]),
  },
  {
    name: 'text/styled',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            text: 'Positioned',
            x: 1,
            y: 0.75,
            w: 4,
            h: 1.25,
            fontSize: 22,
            bold: true,
            italic: true,
            color: 'primary',
            align: 'center',
            valign: 'middle',
            charSpacing: 2,
            lineSpacing: 30,
            paraSpaceBefore: 4,
            paraSpaceAfter: 6,
            margin: 3,
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/percent-position',
    document: deck([
      slide([
        {
          name: 'text',
          props: { text: 'Percent', x: '10%', y: '20%', w: '50%', h: '25%' },
        },
      ]),
    ]),
  },
  {
    name: 'text/rich-runs',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 0.5,
            y: 0.5,
            w: 6,
            h: 2,
            fontSize: 16,
            runs: [
              { text: 'plain ' },
              { text: 'bold', bold: true },
              { text: ' and ', italic: true },
              {
                text: 'coloured',
                color: 'accent',
                fontSize: 20,
                underline: true,
                breakLine: true,
              },
              { text: 'sub', subscript: true, charSpacing: 1 },
              { text: 'sup', superscript: true, strike: true },
            ],
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/named-styles',
    document: deck([
      slide([
        { name: 'text', props: { text: 'Title', style: 'title', y: 0.4 } },
        { name: 'text', props: { text: 'Body', style: 'body', y: 2 } },
      ]),
    ]),
  },
  {
    name: 'text/page-numbers',
    document: deck(
      [
        slide([
          { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
        ]),
        slide([
          { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
        ]),
      ],
      { pageNumberFormat: '09' }
    ),
  },
  {
    name: 'text/font-weight-alias',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            fontFace: 'Inter',
            fontWeight: 300,
            runs: [{ text: 'light ' }, { text: 'medium', fontWeight: 500 }],
          },
        },
      ]),
    ]),
  },
  {
    name: 'deck/language-rtl',
    document: deck([slide([{ name: 'text', props: { text: 'Ciao' } }])], {
      language: 'it-IT',
      rtlMode: true,
    }),
  },
  {
    name: 'deck/widescreen',
    document: deck([slide([{ name: 'text', props: { text: 'Wide' } }])], {
      slideWidth: 13.333,
      slideHeight: 7.5,
    }),
  },
  {
    name: 'slide/notes-hidden',
    document: deck([
      slide([{ name: 'text', props: { text: 'One' } }], { notes: 'Note' }),
      slide([{ name: 'text', props: { text: 'Two' } }], { hidden: true }),
    ]),
  },
  {
    name: 'slide/solid-background',
    document: deck([
      slide([{ name: 'text', props: { text: 'On colour' } }], {
        background: { color: 'primary' },
      }),
    ]),
  },
  {
    name: 'slide/gradient-background',
    document: deck([
      slide([{ name: 'text', props: { text: 'Over gradient' } }], {
        background: {
          gradient: {
            type: 'linear',
            angle: 180,
            stops: [
              { color: 'primary', pos: 0 },
              { color: 'secondary', pos: 100 },
            ],
          },
        },
      }),
    ]),
  },
  {
    name: 'shape/fills-and-lines',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'roundRect',
            x: 0.5,
            y: 0.5,
            w: 3,
            h: 1.5,
            fill: { color: 'secondary', transparency: 20 },
            line: { color: '333333', width: 2, dashType: 'dash' },
            rectRadius: 0.2,
          },
        },
        {
          name: 'shape',
          props: {
            type: 'ellipse',
            x: 4,
            y: 0.5,
            w: 2,
            h: 2,
            fill: { color: 'accent' },
            rotate: 30,
            flipH: true,
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/with-text',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 1,
            w: 4,
            h: 1,
            fill: { color: 'FFFFFF' },
            text: 'Inside the shape',
            fontSize: 18,
            fontColor: 'text',
            align: 'center',
            valign: 'middle',
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/text-segments',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 1,
            w: 5,
            h: 1.5,
            fill: { color: 'EEEEEE' },
            text: [
              { text: 'one ', bold: true },
              { text: 'two', color: 'primary', breakLine: true },
              { text: 'three', fontSize: 24 },
            ],
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/gradient-linear',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 1,
            w: 5,
            h: 3,
            fill: {
              gradient: {
                type: 'linear',
                angle: 45,
                stops: [
                  { color: 'primary', pos: 0 },
                  { color: 'accent', pos: 100, transparency: 25 },
                ],
              },
            },
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/gradient-radial',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'ellipse',
            x: 1,
            y: 1,
            w: 4,
            h: 4,
            fill: {
              gradient: {
                type: 'radial',
                focus: 'topLeft',
                stops: [
                  { color: 'FFFFFF', pos: 0 },
                  { color: '000000', pos: 100 },
                ],
              },
            },
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/pattern',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 1,
            w: 4,
            h: 2,
            fill: {
              pattern: {
                preset: 'pct25',
                foreground: 'primary',
                background: 'FFFFFF',
              },
            },
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/shadow',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 1,
            w: 2,
            h: 2,
            fill: { color: '112233' },
            shadow: { type: 'outer', color: '000000', blur: 5, offset: 2 },
          },
        },
      ]),
    ]),
  },
  {
    name: 'image/base64',
    document: deck([
      slide([
        {
          name: 'image',
          props: { base64: PNG_1PX, x: 1, y: 1, w: 2, h: 2, alt: 'dot' },
        },
      ]),
    ]),
  },
  {
    name: 'image/deduplicated',
    document: deck([
      slide([
        { name: 'image', props: { base64: PNG_1PX, x: 0, y: 0, w: 1, h: 1 } },
        { name: 'image', props: { base64: PNG_1PX, x: 2, y: 0, w: 1, h: 1 } },
      ]),
    ]),
  },
  {
    name: 'image/aspect-from-width',
    document: deck([
      slide([{ name: 'image', props: { base64: PNG_4X2, x: 1, y: 1, w: 4 } }]),
    ]),
  },
  {
    name: 'image/aspect-from-height',
    document: deck([
      slide([{ name: 'image', props: { base64: PNG_4X2, x: 1, y: 1, h: 2 } }]),
    ]),
  },
  {
    name: 'image/contain',
    document: deck([
      slide([
        {
          name: 'image',
          props: {
            base64: PNG_4X2,
            x: 1,
            y: 1,
            w: 4,
            h: 4,
            sizing: { type: 'contain', w: 4, h: 4 },
          },
        },
      ]),
    ]),
  },
  {
    name: 'image/cover',
    document: deck([
      slide([
        {
          name: 'image',
          props: {
            base64: PNG_4X2,
            x: 1,
            y: 1,
            w: 4,
            h: 4,
            sizing: { type: 'cover', w: 4, h: 4 },
          },
        },
      ]),
    ]),
  },
  {
    name: 'image/rounding-rotate',
    document: deck([
      slide([
        {
          name: 'image',
          props: {
            base64: PNG_4X2,
            x: 1,
            y: 1,
            w: 2,
            h: 1,
            rounding: true,
            rotate: 15,
          },
        },
      ]),
    ]),
  },
  {
    name: 'link/external-and-slide',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            text: 'External',
            hyperlink: { url: 'https://example.com', tooltip: 'go' },
          },
        },
        {
          name: 'text',
          props: { text: 'Internal', y: 1, hyperlink: { slide: 2 } },
        },
      ]),
      slide([{ name: 'text', props: { text: 'Target' } }]),
    ]),
  },
  {
    name: 'layout/grid',
    document: deck(
      [
        slide([
          {
            name: 'text',
            props: {
              text: 'Grid',
              grid: { column: 2, row: 1, columnSpan: 4, rowSpan: 2 },
            },
          },
        ]),
      ],
      { grid: { columns: 12, rows: 6, margin: 0.4, gutter: 0.15 } }
    ),
  },
  {
    name: 'template/background-and-objects',
    document: deck(
      [
        slide([{ name: 'text', props: { text: 'Content', y: 3 } }], {
          template: 'base',
        }),
      ],
      {
        templates: [
          {
            name: 'base',
            background: { color: 'primary' },
            objects: [
              {
                name: 'shape',
                props: {
                  type: 'rect',
                  x: 0,
                  y: 0,
                  w: 10,
                  h: 0.6,
                  fill: { color: 'secondary' },
                },
              },
              {
                name: 'text',
                props: { text: 'Header', x: 0.3, y: 0.1, w: 5, h: 0.4 },
              },
            ],
          },
        ],
      }
    ),
  },
  {
    name: 'template/placeholders',
    document: deck(
      [
        slide([], {
          template: 'base',
          placeholders: {
            title: { name: 'text', props: { text: 'Filled title' } },
          },
        }),
      ],
      {
        templates: [
          {
            name: 'base',
            slideNumber: {
              x: 9,
              y: 7,
              w: 0.7,
              h: 0.3,
              color: 'text',
              fontSize: 10,
            },
            placeholders: [
              {
                name: 'title',
                x: 0.5,
                y: 0.5,
                w: 8,
                h: 1,
                defaults: {
                  name: 'text',
                  props: { fontSize: 32, color: 'primary', align: 'center' },
                },
              },
            ],
          },
        ],
      }
    ),
  },
  {
    name: 'table/plain',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              ['Name', 'Value'],
              ['Alpha', '1'],
              ['Beta', '2'],
            ],
            x: 0.5,
            y: 0.5,
            w: 6,
          },
        },
      ]),
    ]),
  },
  {
    name: 'table/formatting',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              [
                {
                  text: 'Header',
                  bold: true,
                  fill: 'primary',
                  color: 'FFFFFF',
                },
                { text: 'Right', align: 'right', valign: 'bottom' },
              ],
              [{ text: 'Body', fontSize: 10, italic: true }, { text: 'Plain' }],
            ],
            x: 1,
            y: 1,
            w: 6,
            fontSize: 14,
            fontFace: 'Georgia',
            color: 'primary',
            align: 'center',
            margin: 6,
            border: { type: 'solid', pt: 2, color: 'primary' },
          },
        },
      ]),
    ]),
  },
  {
    name: 'table/merged-cells',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              [{ text: 'spans two', colspan: 2 }],
              [{ text: 'tall', rowspan: 2 }, { text: 'x' }],
              [{ text: 'y' }],
            ],
            x: 1,
            y: 1,
            w: 6,
          },
        },
      ]),
    ]),
  },
  {
    name: 'table/rounded',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              [
                { text: 'Header', fill: 'primary' },
                { text: 'Two', fill: 'primary' },
              ],
              [
                { text: 'a', fill: 'FFFFFF' },
                { text: 'b', fill: 'FFFFFF' },
              ],
              [
                { text: 'c', fill: 'FFFFFF' },
                { text: 'd', fill: 'FFFFFF' },
              ],
            ],
            x: 1,
            y: 1,
            colW: [2, 3],
            rowH: [0.5, 0.4, 0.4],
            borderRadius: 0.15,
            border: { type: 'solid', pt: 1, color: 'DDDDDD' },
          },
        },
      ]),
    ]),
  },
  {
    name: 'table/emoji-text-presentation',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              ['✓ done', '✗ failed'],
              ['★ starred', 'plain'],
            ],
            x: 1,
            y: 1,
            w: 5,
          },
        },
      ]),
    ]),
  },
  {
    name: 'chart/bar',
    document: deck([
      slide([
        {
          name: 'chart',
          props: { type: 'bar', data: SERIES, x: 0.5, y: 0.5, w: 6, h: 4 },
        },
      ]),
    ]),
  },
  {
    name: 'chart/configured',
    document: deck([
      slide([
        {
          name: 'chart',
          props: {
            type: 'bar',
            data: SERIES,
            x: 0.5,
            y: 0.5,
            w: 6,
            h: 4,
            showTitle: true,
            title: 'Quarterly',
            titleFontSize: 18,
            titleColor: 'primary',
            showLegend: true,
            legendPos: 'b',
            showValue: true,
            catAxisTitle: 'Quarter',
            catGridLine: { style: 'dash', size: 1, color: 'EEEEEE' },
            valAxisTitle: 'Amount',
            valAxisMinVal: 0,
            valAxisMaxVal: 30,
            valAxisLabelFormatCode: '#,##0',
            dataBorder: { pt: 1, color: 'primary' },
          },
        },
      ]),
    ]),
  },
  {
    name: 'chart/two-on-one-slide',
    document: deck([
      slide([
        {
          name: 'chart',
          props: { type: 'bar', data: SERIES, x: 0.5, y: 0.5, w: 4, h: 3 },
        },
        {
          name: 'chart',
          props: { type: 'line', data: SERIES, x: 5, y: 0.5, w: 4, h: 3 },
        },
      ]),
    ]),
  },
  {
    name: 'text/single-run',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 1,
            y: 1,
            w: 4,
            h: 1,
            fontSize: 16,
            runs: [{ text: 'solo', bold: true }],
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/bullets',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 1,
            y: 1,
            w: 5,
            h: 2,
            text: 'a\nb',
            bullet: { type: 'number', startAt: 3 },
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/no-text',
    document: deck([
      slide([
        { name: 'shape', props: { type: 'star5', x: 2, y: 2, w: 2, h: 2 } },
      ]),
    ]),
  },
  {
    name: 'table/auto-page',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              ['h1', 'h2'],
              ['a', 'b'],
              ['c', 'd'],
            ],
            x: 1,
            y: 1,
            w: 5,
            autoPage: true,
            autoPageRepeatHeader: true,
          },
        },
      ]),
    ]),
  },
  {
    name: 'table/no-size',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              ['a', 'b'],
              ['c', 'd'],
            ],
            x: 0.5,
            y: 0.5,
          },
        },
      ]),
    ]),
  },
  {
    name: 'chart/line',
    document: deck([
      slide([
        {
          name: 'chart',
          props: {
            type: 'line',
            data: SERIES,
            x: 0.5,
            y: 0.5,
            w: 6,
            h: 4,
            lineSmooth: true,
            lineSize: 3,
          },
        },
      ]),
    ]),
  },
  {
    name: 'chart/doughnut',
    document: deck([
      slide([
        {
          name: 'chart',
          props: {
            type: 'doughnut',
            data: SERIES,
            x: 0.5,
            y: 0.5,
            w: 5,
            h: 5,
            holeSize: 60,
            showLegend: true,
            legendPos: 'r',
          },
        },
      ]),
    ]),
  },
  {
    name: 'image/url-free-aspect',
    document: deck([
      slide([
        { name: 'image', props: { base64: PNG_4X2, x: 0, y: 0, w: '50%' } },
      ]),
    ]),
  },
  {
    name: 'slide/disabled-content',
    document: deck([
      slide([
        { name: 'text', props: { text: 'kept' } },
        { name: 'text', props: { text: 'dropped' }, enabled: false },
      ]),
      { ...(slide([]) as object), enabled: false },
      slide([{ name: 'text', props: { text: 'last' } }]),
    ]),
  },
];

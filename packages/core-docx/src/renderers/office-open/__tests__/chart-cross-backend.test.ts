/**
 * A native chart, compared across the two DOCX renderers.
 *
 * Every chart case in the corpus is rendered on both backends, and their chart
 * parts are paired by content (`chartPartSignature`: series names, categories
 * and values). Each pair must agree on everything the reader of the chart
 * sees: the kind of plot, the series colours, the title and axis titles with
 * their face, size, weight and colour, the legend and where it sits, the size
 * the tick labels are drawn at, the extent on the page, a workbook behind it —
 * and the plot's own styling, which is Word's Insert Chart look on both
 * (`chartLook.ts`): where each axis sits, its gridlines, tick marks and line,
 * bar gaps, series lines and markers, slice borders, a doughnut's hole, a
 * scatter chart's x values and whether an untitled chart gets a title
 * invented for it.
 *
 * No `docx` import here: the boundary keeps it out of this directory, and the
 * comparison reads the packages rather than either backend's objects.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { chartPartSignature } from '@json-to-office/shared/rendering';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import { CORPUS } from '../../../__tests__/fixtures/corpus';

const CASES = CORPUS.filter(
  (c) => c.name.startsWith('chart/') || c.name === 'blocks/chart-figure-native'
);

type Renderer = 'docxjs' | 'office-open';

interface TextStyle {
  size?: string;
  bold?: string;
  color?: string;
  typeface?: string;
}

/** The first `a:defRPr` in a fragment: size, weight, colour and Latin face. */
function textStyle(fragment: string): TextStyle | undefined {
  const match = /<a:defRPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:defRPr>)/.exec(
    fragment
  );
  if (!match) return undefined;
  const [, attributes, body = ''] = match;
  const attribute = (name: string): string | undefined =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
  const style: TextStyle = {};
  const size = attribute('sz');
  const bold = attribute('b');
  const color = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(body)?.[1];
  const typeface = /<a:latin typeface="([^"]+)"/.exec(body)?.[1];
  if (size !== undefined) style.size = size;
  if (bold !== undefined) style.bold = bold;
  if (color !== undefined) style.color = color.toUpperCase();
  if (typeface !== undefined) style.typeface = typeface;
  return style;
}

/** A `c:title`'s text and the style it is drawn in. */
function titleOf(title: string): { text: string; style?: TextStyle } {
  const text = [...title.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
    .map((m) => m[1])
    .join('');
  return { text, style: textStyle(title) };
}

/** A fragment with every `c:title` taken out. */
const withoutTitles = (xml: string): string =>
  xml.replace(/<c:title>[\s\S]*?<\/c:title>/g, '');

/** The size text inside an element is drawn at: its own txPr, else the chart space's. */
function effectiveSize(element: string, chartSpaceSize?: string): string {
  const own = /<c:txPr>([\s\S]*?)<\/c:txPr>/.exec(withoutTitles(element));
  return (own && textStyle(own[1])?.size) ?? chartSpaceSize ?? 'reader';
}

/** The first colour in a fragment, fill or line. */
const firstColor = (fragment: string): string | undefined =>
  /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(fragment)?.[1]?.toUpperCase();

/** The first colour in a fragment, a theme slot and its modifiers included. */
function colorOf(fragment: string): string | undefined {
  const scheme =
    /<a:schemeClr val="(\w+)"(?:\/>|>([\s\S]*?)<\/a:schemeClr>)/.exec(fragment);
  if (scheme) {
    const modifiers = [...(scheme[2] ?? '').matchAll(/<a:(\w+) val="(\d+)"/g)]
      .map((m) => `${m[1]} ${m[2]}`)
      .join(', ');
    return modifiers ? `${scheme[1]} (${modifiers})` : scheme[1];
  }
  return firstColor(fragment);
}

/**
 * The line an `spPr` draws, as the reader sees it: none, or its width, cap,
 * colour and (for a series) join. `flat` is `ST_LineCap`'s default, so
 * stating it and leaving it out draw the same line.
 */
function strokeOf(spPr: string | undefined, withJoin = false) {
  if (spPr === undefined) return undefined;
  const line = /<a:ln\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:ln>)/.exec(spPr);
  if (!line) return undefined;
  const [, attributes, body = ''] = line;
  if (body.startsWith('<a:noFill/>')) return 'none';
  const cap = /\bcap="(\w+)"/.exec(attributes)?.[1];
  return {
    width: /\bw="(\d+)"/.exec(attributes)?.[1],
    cap: cap === 'flat' ? undefined : cap,
    color: colorOf(body),
    ...(withJoin ? { join: /<a:(round|bevel|miter)\b/.exec(body)?.[1] } : {}),
  };
}

/** One `val` attribute: `<c:tag val="…"/>`. */
const valueOf = (fragment: string, tag: string): string | undefined =>
  new RegExp(`<c:${tag} val="([^"]*)"\\/>`).exec(fragment)?.[1];

/** An element's own `c:spPr`, its titles and gridlines taken out. */
function ownShapeProperties(fragment: string): string | undefined {
  const bare = withoutTitles(fragment).replace(
    /<c:(major|minor)Gridlines>[\s\S]*?<\/c:\1Gridlines>/g,
    ''
  );
  return /<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(bare)?.[1];
}

/** Gridlines: absent, the reader's own, or a stroke. */
function gridlinesOf(axis: string, kind: 'major' | 'minor') {
  const grid = new RegExp(
    `<c:${kind}Gridlines(?:\\/>|>([\\s\\S]*?)<\\/c:${kind}Gridlines>)`
  ).exec(axis);
  if (!grid) return undefined;
  const spPr = /<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(grid[1] ?? '')?.[1];
  return spPr === undefined ? 'reader' : strokeOf(spPr);
}

/** What a series draws beyond its colour: its line, markers, borders, x values. */
function seriesStyle(series: string) {
  const own = /<\/c:tx>\s*<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(series)?.[1];
  const marker = /<c:marker>([\s\S]*?)<\/c:marker>/.exec(series)?.[1];
  const markerSpPr = marker
    ? /<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(marker)?.[1]
    : undefined;
  const xValues = /<c:xVal>([\s\S]*?)<\/c:xVal>/.exec(series)?.[1];
  return {
    line: strokeOf(own, true),
    marker: marker
      ? {
          symbol: valueOf(marker, 'symbol'),
          size: valueOf(marker, 'size'),
          line: strokeOf(markerSpPr),
        }
      : undefined,
    smooth: valueOf(series, 'smooth'),
    invertIfNegative: valueOf(series, 'invertIfNegative'),
    sliceBorders: [
      ...series.matchAll(/<c:dPt>[\s\S]*?<c:spPr>([\s\S]*?)<\/c:spPr>/g),
    ].map((m) => strokeOf(m[1])),
    // The kind of reference decides how a reader places each x: text is put
    // at 1, 2, 3… whatever it says.
    x: xValues
      ? {
          kind: /<c:(numRef|strRef)>/.exec(xValues)?.[1],
          values: [...xValues.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(
            (m) => m[1]
          ),
        }
      : undefined,
  };
}

function chartFacts(xml: string) {
  const chart = xml.slice(0, xml.indexOf('</c:chart>'));
  const chartSpace = xml.slice(xml.indexOf('</c:chart>'));
  const chartSpaceSize = textStyle(
    /<c:txPr>([\s\S]*?)<\/c:txPr>/.exec(chartSpace)?.[1] ?? ''
  )?.size;

  const plotArea = chart.slice(chart.indexOf('<c:plotArea>'));
  const plot =
    /<c:(barChart|lineChart|areaChart|pieChart|doughnutChart|radarChart|scatterChart)>/.exec(
      plotArea
    )?.[1];
  const barDirection = /<c:barDir val="(\w+)"\/>/.exec(plotArea)?.[1];

  const pieLike = plot === 'pieChart' || plot === 'doughnutChart';
  const colors = (chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? []).map(
    (series) => {
      if (pieLike) {
        return [
          ...series.matchAll(
            /<c:dPt><c:idx val="(\d+)"\/>([\s\S]*?)<\/c:dPt>/g
          ),
        ].map((m) => `${m[1]}:${firstColor(m[2])}`);
      }
      const own = /<\/c:tx>\s*<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(series);
      return own ? firstColor(own[1]) : undefined;
    }
  );

  // The chart's own title is the first child of `c:chart`; axis titles live
  // inside their axes.
  const heading = chart.slice(0, chart.indexOf('<c:plotArea>'));
  const title = /<c:title>([\s\S]*?)<\/c:title>/.exec(heading)?.[1];

  const axes = [
    ...plotArea.matchAll(/<c:(catAx|valAx|dateAx|serAx)>([\s\S]*?)<\/c:\1>/g),
  ].map(([, kind, body]) => {
    const axisTitle = /<c:title>([\s\S]*?)<\/c:title>/.exec(body)?.[1];
    return {
      kind,
      title: axisTitle ? titleOf(axisTitle) : undefined,
      tickLabelSize: effectiveSize(body, chartSpaceSize),
      position: valueOf(body, 'axPos'),
      gridlines: gridlinesOf(body, 'major'),
      minorGridlines: gridlinesOf(body, 'minor'),
      majorTickMark: valueOf(body, 'majorTickMark'),
      minorTickMark: valueOf(body, 'minorTickMark'),
      tickLabelPosition: valueOf(body, 'tickLblPos'),
      line: strokeOf(ownShapeProperties(body)),
      crossBetween: valueOf(body, 'crossBetween'),
    };
  });

  // The plot group's own options, outside its series.
  const group = plot
    ? /<c:\w+Chart>([\s\S]*?)<\/c:\w+Chart>/.exec(plotArea)?.[1] ?? ''
    : '';
  const groupTail = group.slice(group.lastIndexOf('</c:ser>'));
  const groupOptions = {
    gapWidth: valueOf(groupTail, 'gapWidth'),
    overlap: valueOf(groupTail, 'overlap'),
    firstSliceAngle: valueOf(groupTail, 'firstSliceAng'),
    holeSize: valueOf(groupTail, 'holeSize'),
    markers: valueOf(groupTail, 'marker'),
    scatterStyle: valueOf(group, 'scatterStyle'),
    radarStyle: valueOf(group, 'radarStyle'),
  };
  const lastAxisOrGroup = Math.max(
    ...[
      ...plotArea.matchAll(/<\/c:(?:\w+Chart|catAx|valAx|dateAx|serAx)>/g),
    ].map((m) => (m.index ?? 0) + m[0].length)
  );
  const plotAreaShape = /<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(
    plotArea.slice(lastAxisOrGroup)
  )?.[1];

  const legendBody = /<c:legend>([\s\S]*?)<\/c:legend>/.exec(chart)?.[1];
  const legend = legendBody
    ? {
        position: /<c:legendPos val="(\w+)"\/>/.exec(legendBody)?.[1] ?? 'r',
        size: effectiveSize(legendBody, chartSpaceSize),
      }
    : undefined;

  return {
    plot: barDirection ? `${plot} ${barDirection}` : plot,
    colors,
    title: title ? titleOf(title) : undefined,
    // `1` stops a reader inventing a title for an untitled chart.
    titleDeleted: valueOf(heading, 'autoTitleDeleted'),
    axes,
    legend,
    groupOptions,
    series: (chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? []).map(seriesStyle),
    plotArea: plotAreaShape
      ? {
          fill: plotAreaShape.startsWith('<a:noFill/>') ? 'none' : 'stated',
          line: strokeOf(plotAreaShape),
        }
      : undefined,
  };
}

/** `word/document.xml` → `word/_rels/document.xml.rels`. */
function relsPartFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/** Relationship id → resolved target part, for one source part. */
function relationships(zip: AdmZip, partName: string): Map<string, string> {
  const rels = zip.getEntry(relsPartFor(partName));
  if (!rels) return new Map();
  const base = partName.split('/').slice(0, -1);
  return new Map(
    [
      ...rels
        .getData()
        .toString('utf8')
        .matchAll(/<Relationship\b[^>]*>/g),
    ].map(([tag]) => {
      const id = /\bId="([^"]+)"/.exec(tag)![1];
      const target = /\bTarget="([^"]+)"/.exec(tag)![1];
      const parts = [...base];
      for (const segment of target.split('/')) {
        if (segment === '..') parts.pop();
        else if (segment !== '.') parts.push(segment);
      }
      return [id, parts.join('/')];
    })
  );
}

async function chartsOf(document: unknown, renderer: Renderer) {
  const { buffer } = await generateBufferViaIr(
    structuredClone(document) as never,
    { renderer, warnings: [] }
  );
  const zip = new AdmZip(buffer);
  const read = (name: string): string =>
    zip.getEntry(name)!.getData().toString('utf8');

  // Where each chart part is drawn, and at what size. `drawn` keeps every
  // chart drawing's extent, including one whose reference does not resolve,
  // which `unresolved` names: `@office-open/docx` 0.11 filled in chart
  // relationship ids in `word/document.xml` only, so a header or footer chart
  // kept an `r:id="{chart:…}"` placeholder with no relationship behind it.
  const extents = new Map<string, string>();
  const drawn: string[] = [];
  const unresolved: string[] = [];
  for (const entry of zip.getEntries()) {
    if (!/^word\/(document|header\d+|footer\d+)\.xml$/.test(entry.entryName)) {
      continue;
    }
    const rels = relationships(zip, entry.entryName);
    for (const [drawing] of read(entry.entryName).matchAll(
      /<w:drawing>[\s\S]*?<\/w:drawing>/g
    )) {
      const id = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(drawing)?.[1];
      if (!id) continue;
      const match = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(
        drawing
      )!;
      const extent = `${match[1]}x${match[2]}`;
      drawn.push(extent);
      const target = rels.get(id);
      if (target) extents.set(target, extent);
      else unresolved.push(`${entry.entryName} ${id}`);
    }
  }

  const charts = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => /^word\/charts\/chart\d+\.xml$/.test(name))
    .map((part) => {
      const xml = read(part);
      const workbookId = /<c:externalData r:id="([^"]+)"/.exec(xml)?.[1];
      const workbook = workbookId
        ? relationships(zip, part).get(workbookId)
        : undefined;
      return {
        part,
        signature: chartPartSignature(xml),
        extent: extents.get(part),
        workbook:
          workbook !== undefined &&
          /^word\/embeddings\/[^/]+\.xlsx$/.test(workbook) &&
          zip.getEntry(workbook) !== null,
        ...chartFacts(xml),
      };
    });
  return { charts, drawn: drawn.sort(), unresolved };
}

describe('native charts on both DOCX renderers', () => {
  it('covers every chart type the component offers', () => {
    expect(CASES.map((c) => c.name)).toHaveLength(13);
  });

  it.each(['docxjs', 'office-open'] as const)(
    'rejects an out-of-range scatter label on %s',
    async (renderer) => {
      const document = {
        name: 'docx',
        children: [
          {
            name: 'section',
            children: [
              {
                name: 'chart',
                props: {
                  type: 'scatter',
                  data: [
                    {
                      name: 'Series',
                      labels: ['1e999', '4'],
                      values: [42, 43],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await expect(chartsOf(document, renderer)).rejects.toThrow(
        /Chart series "Series" at sections\[0\]\.children\[0\] has an x label "1e999" outside the finite number range/
      );
    }
  );

  it.each(CASES.map((c) => [c.name, c] as const))(
    'draws the same charts for %s',
    async (_name, testCase) => {
      const [docxjs, officeOpen] = await Promise.all([
        chartsOf(testCase.document, 'docxjs'),
        chartsOf(testCase.document, 'office-open'),
      ]);

      expect(docxjs.charts.length).toBeGreaterThan(0);
      expect(docxjs.unresolved).toEqual([]);
      expect(officeOpen.unresolved).toEqual([]);
      expect(docxjs.charts.map((c) => c.signature).sort()).toEqual(
        officeOpen.charts.map((c) => c.signature).sort()
      );
      // Every chart drawing at the same size, chrome included.
      expect(docxjs.drawn).toEqual(officeOpen.drawn);

      for (const { part, extent, ...chart } of docxjs.charts) {
        const twin = officeOpen.charts.find(
          (c) => c.signature === chart.signature
        )!;
        const { part: twinPart, extent: twinExtent, ...expected } = twin;
        expect(chart.plot, part).toBeDefined();
        expect(extent, part).toBeDefined();
        expect(chart.workbook, part).toBe(true);
        expect(extent, part).toBe(twinExtent);
        expect(chart, `${part} against office-open ${twinPart}`).toEqual(
          expected
        );
      }
    },
    60_000
  );
});

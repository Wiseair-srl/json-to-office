/**
 * Matching an emitted chart part back to the node it came from.
 *
 * Position cannot do that job — the emitter's walk and the backend's part
 * numbering need not agree — so the pairing is by content. That makes the two
 * signatures a contract: one is read out of escaped XML, the other built from
 * raw IR strings, and any disagreement between them silently strands a chart
 * without its workbook.
 */

import { describe, expect, it } from 'vitest';
import {
  chartInputSignature,
  chartPartSignature,
  chartWorkbookParts,
  matchChartParts,
  spliceChartXml,
  type ChartPartInput,
} from '../chart-parts';

const series = (
  name: string,
  labels: string[],
  values: number[]
): ChartPartInput => ({
  chartType: 'bar',
  colors: [],
  series: [{ name, labels, values }],
});

/** One `<c:ser>` as the backend writes it, escaping included. */
const part = (name: string, labels: string[], values: number[]): string => {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const cell = (value: string) => `<c:pt><c:v>${escape(value)}</c:v></c:pt>`;
  return (
    `<c:ser><c:tx><c:strRef>${cell(name)}</c:strRef></c:tx>` +
    `<c:cat><c:strRef>${labels.map(cell).join('')}</c:strRef></c:cat>` +
    `<c:val><c:numRef>${values.map((v) => cell(String(v))).join('')}</c:numRef></c:val>` +
    `</c:ser>`
  );
};

describe('chart part signatures', () => {
  it('agrees on text the backend had to escape', () => {
    const name = `A & B < C > D " E ' F`;
    const labels = ['x & y', '<z>'];
    expect(chartPartSignature(part(name, labels, [1, 2]))).toBe(
      chartInputSignature(series(name, labels, [1, 2]))
    );
  });

  it('agrees on plain text', () => {
    expect(chartPartSignature(part('Revenue', ['Q1'], [1]))).toBe(
      chartInputSignature(series('Revenue', ['Q1'], [1]))
    );
  });

  it('separates fields, so neighbouring values cannot be confused', () => {
    // Joining on '' would make ['ab','c'] and ['a','bc'] one chart, and the
    // wrong workbook would follow.
    expect(chartInputSignature(series('ab', ['c'], [1]))).not.toBe(
      chartInputSignature(series('a', ['bc'], [1]))
    );
  });

  it('pairs each part with its own chart, whatever the order', () => {
    const first = series('First', ['a'], [1]);
    const second = series('Second', ['b'], [2]);
    // Parts numbered opposite to the order the charts were collected in.
    const matched = matchChartParts(
      [
        [1, part('Second', ['b'], [2])],
        [2, part('First', ['a'], [1])],
      ],
      [first, second]
    );
    expect(matched.map((entry) => [entry.ordinal, entry.chart])).toEqual([
      [1, second],
      [2, first],
    ]);
  });

  it('refuses to leave a chart without a part rather than shipping it broken', () => {
    expect(() =>
      matchChartParts(
        [[1, part('Present', ['a'], [1])]],
        [series('Present', ['a'], [1]), series('Missing', ['b'], [2])]
      )
    ).toThrow(/Missing/);
  });
});

describe('chart text defaults', () => {
  const font = { fontFamily: 'Calibri', fontSize: 10, color: '333333' };
  const defRPr =
    '<a:defRPr sz="1000"><a:solidFill><a:srgbClr val="333333"/></a:solidFill>' +
    '<a:latin typeface="Calibri"/></a:defRPr>';
  const txPr =
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr>' +
    '<a:endParaRPr lang="en-US"/></a:p></c:txPr>';
  const chartSpace = (afterChart: string, axisTitle = '') =>
    `<c:chartSpace><c:chart><c:plotArea><c:catAx><c:axId val="1"/>` +
    `<c:axPos val="b"/>${axisTitle}<c:crossAx val="2"/></c:catAx>` +
    `</c:plotArea><c:legend>${txPr}</c:legend></c:chart>${afterChart}` +
    `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>` +
    `</c:chartSpace>`;
  const input = (extra: Partial<ChartPartInput> = {}): ChartPartInput => ({
    chartType: 'bar',
    colors: [],
    series: [],
    ...extra,
  });

  it('fills the chart-wide default the backend left empty, and only it', () => {
    const xml = spliceChartXml(
      chartSpace(`<c:spPr><a:noFill/></c:spPr>${txPr}`),
      input({ textFont: font })
    );
    const tail = xml.slice(xml.lastIndexOf('</c:chart>'));
    expect(tail).toContain(defRPr);
    expect(tail.match(/<c:txPr>/g)).toHaveLength(1);
    // The legend's own txPr is left to inherit it.
    const legend = xml.slice(
      xml.indexOf('<c:legend>'),
      xml.indexOf('</c:legend>')
    );
    expect(legend).toContain('<a:defRPr/>');
  });

  it('writes a missing chart-wide default between spPr and externalData', () => {
    const xml = spliceChartXml(
      chartSpace('<c:spPr><a:noFill/></c:spPr>'),
      input({ textFont: font })
    );
    expect(xml).toContain(
      `</c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${defRPr}`
    );
    expect(xml.indexOf('<c:externalData')).toBeGreaterThan(
      xml.lastIndexOf('</c:txPr>')
    );
  });

  it('styles an axis title the backend already wrote, keeping its text', () => {
    const existing =
      '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Q</a:t>' +
      '</a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
    const xml = spliceChartXml(
      chartSpace('', existing),
      input({ categoryAxis: { title: 'Q', titleFont: font } })
    );
    expect(xml.match(/<c:title>/g)).toHaveLength(1);
    expect(xml).toContain(`<a:p><a:pPr>${defRPr}</a:pPr><a:r><a:t>Q</a:t>`);
  });
});

/**
 * The plot look a backend leaves to the reader: axis position, ticks and line,
 * gridlines in a theme tint, bar gaps, a pie's first slice, a doughnut's hole,
 * markers, a scatter chart's x values, an untitled chart's title. Each edit is
 * opt-in — pptx sets none of them, and its parts must not move — and each goes
 * into the slot its CT_* sequence gives it.
 */
describe('plot look', () => {
  const series = (values: string) =>
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f/>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt>` +
    `</c:strCache></c:strRef></c:tx><c:spPr/>${values}</c:ser>`;
  const categories =
    `<c:cat><c:strRef><c:f/><c:strCache><c:ptCount val="2"/>` +
    `<c:pt idx="0"><c:v>a</c:v></c:pt><c:pt idx="1"><c:v>b</c:v></c:pt>` +
    `</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f/><c:numCache>` +
    `<c:formatCode>General</c:formatCode><c:ptCount val="2"/>` +
    `<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>` +
    `</c:numCache></c:numRef></c:val>`;
  const axis = (tag: string, id: number, cross: number, pos: string) =>
    `<c:${tag}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>` +
    `</c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>` +
    `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:${tag}>`;
  const part = (group: string, axes = true, title = true) =>
    `<c:chartSpace><c:chart>` +
    (title ? '<c:title><c:overlay val="0"/></c:title>' : '') +
    `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${group}` +
    (axes ? axis('catAx', 10, 20, 'b') + axis('valAx', 20, 10, 'l') : '') +
    `</c:plotArea><c:plotVisOnly/></c:chart></c:chartSpace>`;
  const bar = part(
    `<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/>` +
      `${series(categories)}<c:axId val="10"/><c:axId val="20"/></c:barChart>`
  );
  const input = (
    chartType: string,
    extra: Partial<ChartPartInput> = {}
  ): ChartPartInput => ({
    chartType,
    colors: ['112233'],
    series: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
    ...extra,
  });
  const between = (xml: string, open: string, close: string) =>
    xml.slice(xml.indexOf(open), xml.indexOf(close) + close.length);
  const tint = { scheme: 'tx1', lumMod: 15000, lumOff: 85000 };
  const tintFill =
    '<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/>' +
    '<a:lumOff val="85000"/></a:schemeClr></a:solidFill>';

  it('writes nothing new when no look is asked for', () => {
    // What the pptx side relies on: none of these edits is a default.
    const xml = spliceChartXml(bar, input('bar'));
    for (const tag of [
      'majorTickMark',
      'minorTickMark',
      'tickLblPos',
      'crossBetween',
      'gapWidth',
      'overlap',
      'majorGridlines',
    ]) {
      expect(xml, tag).not.toContain(`<c:${tag}`);
    }
    expect(xml).toContain('<c:autoTitleDeleted val="0"/>');
    expect(xml).toContain('<c:axPos val="b"/>');
    expect(between(xml, '<c:plotArea>', '</c:plotArea>')).not.toMatch(
      /<\/c:valAx><c:spPr>/
    );
  });

  it('places an axis, its gridlines, ticks and line in schema order', () => {
    const xml = spliceChartXml(
      bar,
      input('bar', {
        categoryAxis: {
          position: 'l',
          majorTickMark: 'none',
          minorTickMark: 'none',
          tickLabelPosition: 'nextTo',
          line: { widthPoints: 0.75, color: tint },
        },
        valueAxis: {
          position: 'b',
          gridLine: { size: 0.75, color: tint },
          majorTickMark: 'none',
          lineVisible: false,
          crossBetween: 'between',
        },
      })
    );
    expect(between(xml, '<c:catAx>', '</c:catAx>')).toBe(
      '<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/>' +
        '</c:scaling><c:delete val="0"/><c:axPos val="l"/>' +
        '<c:majorTickMark val="none"/><c:minorTickMark val="none"/>' +
        `<c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525">${tintFill}</a:ln>` +
        '</c:spPr><c:crossAx val="20"/><c:crosses val="autoZero"/></c:catAx>'
    );
    expect(between(xml, '<c:valAx>', '</c:valAx>')).toBe(
      '<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/>' +
        '</c:scaling><c:delete val="0"/><c:axPos val="b"/>' +
        `<c:majorGridlines><c:spPr><a:ln w="9525">${tintFill}</a:ln></c:spPr>` +
        '</c:majorGridlines><c:majorTickMark val="none"/>' +
        '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="10"/>' +
        '<c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>'
    );
  });

  it('never gives a category axis a crossBetween, which CT_CatAx lacks', () => {
    const xml = spliceChartXml(
      bar,
      input('bar', { categoryAxis: { crossBetween: 'between' } })
    );
    expect(xml).not.toContain('crossBetween');
  });

  it('puts bar gaps after the series and before the axis ids', () => {
    const xml = spliceChartXml(
      bar,
      input('bar', { gapWidth: 182, overlap: 0, dataBorder: 'none' })
    );
    expect(xml).toContain(
      '</c:ser><c:gapWidth val="182"/><c:overlap val="0"/><c:axId val="10"/>'
    );
    expect(xml).toContain(
      '<c:spPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill>' +
        '<a:ln><a:noFill/></a:ln></c:spPr>'
    );
  });

  it('leaves the stacked overlap to the gaps already written', () => {
    const xml = spliceChartXml(
      bar,
      input('bar', { overlap: -27, barGrouping: 'stacked' })
    );
    expect(xml.match(/<c:overlap /g)).toHaveLength(1);
    expect(xml).toContain('<c:overlap val="-27"/>');
  });

  it("gives a doughnut's slices borders in a theme colour, its first angle and its hole", () => {
    const doughnut = part(
      `<c:doughnutChart><c:varyColors val="1"/>${series(categories)}` +
        `</c:doughnutChart>`,
      false
    );
    const xml = spliceChartXml(
      doughnut,
      input('doughnut', {
        dataBorder: { widthPoints: 1.5, color: { scheme: 'lt1' } },
        firstSliceAngle: 0,
        holeSize: 50,
      })
    );
    expect(xml).toContain(
      '<c:dPt><c:idx val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill>' +
        '<a:srgbClr val="112233"/></a:solidFill><a:ln w="19050"><a:solidFill>' +
        '<a:schemeClr val="lt1"/></a:solidFill></a:ln></c:spPr></c:dPt>'
    );
    expect(xml).toContain(
      '</c:ser><c:firstSliceAng val="0"/><c:holeSize val="50"/>' +
        '</c:doughnutChart>'
    );
  });

  it('strokes a line series with a cap and join, and outlines its markers', () => {
    const line = part(
      `<c:lineChart><c:grouping val="standard"/>` +
        series(
          `<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${categories}`
        ) +
        `<c:axId val="10"/><c:axId val="20"/></c:lineChart>`
    );
    const xml = spliceChartXml(
      line,
      input('line', {
        lineWidthPoints: 2.25,
        lineCap: 'rnd',
        lineJoin: 'round',
        markerLineWidthPoints: 0.75,
        lineMarkers: true,
      })
    );
    const fill = '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>';
    expect(xml).toContain(
      `<c:spPr><a:ln w="28575" cap="rnd">${fill}<a:round/></a:ln></c:spPr>` +
        `<c:marker><c:symbol val="circle"/><c:size val="5"/>` +
        `<c:spPr>${fill}<a:ln w="9525">${fill}</a:ln></c:spPr></c:marker>`
    );
    expect(xml).toContain('</c:ser><c:marker val="1"/><c:axId val="10"/>');
  });

  it("writes a scatter chart's x values as numbers, and its workbook's column A", () => {
    const scatter = part(
      `<c:scatterChart><c:scatterStyle val="line"/>` +
        series(
          `<c:xVal><c:strRef><c:f/><c:strCache><c:ptCount val="2"/>` +
            `<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt>` +
            `</c:strCache></c:strRef></c:xVal><c:yVal><c:numRef><c:f/>` +
            `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/>` +
            `<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>` +
            `</c:numCache></c:numRef></c:yVal>`
        ) +
        `<c:axId val="10"/><c:axId val="20"/></c:scatterChart>`
    );
    const series1 = [{ name: 'S', labels: ['1', '2.5'], values: [1, 2] }];
    const xml = spliceChartXml(scatter, {
      chartType: 'scatter',
      colors: [],
      series: series1,
      scatterStyle: 'lineMarker',
      scatterXValues: [1, 2.5],
    });
    expect(xml).toContain('<c:scatterStyle val="lineMarker"/>');
    expect(xml).toContain(
      '<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$3</c:f><c:numCache>' +
        '<c:formatCode>General</c:formatCode><c:ptCount val="2"/>' +
        '<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt>' +
        '</c:numCache></c:numRef></c:xVal>'
    );

    const sheet = (options?: { categoryValues: number[] }) =>
      chartWorkbookParts(series1, options).find(
        ([path]) => path === 'xl/worksheets/sheet1.xml'
      )![1];
    expect(sheet({ categoryValues: [1, 2.5] })).toContain(
      '<c r="A3"><v>2.5</v></c>'
    );
    expect(sheet()).toContain(
      '<c r="A3" t="inlineStr"><is><t>2.5</t></is></c>'
    );
  });

  it('keeps an untitled chart untitled, and states an unfilled plot area', () => {
    const xml = spliceChartXml(
      part(
        `<c:barChart><c:barDir val="col"/>${series(categories)}` +
          `<c:axId val="10"/><c:axId val="20"/></c:barChart>`,
        true,
        false
      ),
      input('column', { autoTitleDeleted: true, plotAreaUnfilled: true })
    );
    expect(xml).toContain('<c:chart><c:autoTitleDeleted val="1"/>');
    expect(xml).toContain(
      '</c:valAx><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
        '</c:plotArea>'
    );
    // Once is enough: a second pass finds the plot area's own spPr.
    const again = spliceChartXml(
      xml,
      input('column', { plotAreaUnfilled: true })
    );
    expect(again.match(/<\/c:valAx><c:spPr>/g)).toHaveLength(1);
  });
});

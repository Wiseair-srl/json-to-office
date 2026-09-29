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
  chartLook,
  chartPartSignature,
  chartWorkbookParts,
  finishChartXml,
  matchChartParts,
  withSeriesLook,
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
  const run = {
    size: 10,
    fill: { type: 'solid', color: { value: '333333' } },
    font: { latin: 'Calibri' },
  };
  const input = (extra: Partial<ChartPartInput> = {}): ChartPartInput => ({
    chartType: 'bar',
    colors: [],
    series: [],
    ...extra,
  });

  it('states the chart-wide default every other piece of text inherits', () => {
    const { chart } = chartLook(input({ textFont: font }));
    expect(chart.textProperties).toEqual({
      paragraphs: [
        {
          properties: { defaultRunProperties: run },
          endParagraphProperties: { lang: 'en-US' },
        },
      ],
    });
    // The legend's own default is left empty, to inherit it.
    expect(
      chart.legendTextProperties.paragraphs[0].properties?.defaultRunProperties
    ).toEqual({});
  });

  it('puts an axis title font on the paragraph default and the run', () => {
    const { chart } = chartLook(
      input({ categoryAxis: { title: 'Q', titleFont: font } })
    );
    expect(chart.axes?.[0].title).toEqual({
      text: {
        paragraphs: [
          {
            properties: { defaultRunProperties: run },
            children: [{ text: 'Q', ...run }],
            endParagraphProperties: false,
          },
        ],
      },
      overlay: false,
    });
  });

  it("styles the chart title's paragraph, not its run", () => {
    const { chart } = chartLook(
      input({ title: 'Revenue', titleFont: { bold: true } })
    );
    expect(chart.title?.text.paragraphs[0]).toEqual({
      properties: { defaultRunProperties: { bold: true } },
      children: ['Revenue'],
      endParagraphProperties: false,
    });
  });
});

/**
 * The plot look a backend leaves to the reader: axis position, ticks and line,
 * gridlines in a theme tint, bar gaps, a pie's first slice, a doughnut's hole,
 * markers, a scatter chart's x values, an untitled chart's title. Each is
 * opt-in — pptx sets none of them unless authored — and each is spelled in the
 * backend's vocabulary.
 */
describe('plot look', () => {
  const input = (
    chartType: string,
    extra: Partial<ChartPartInput> = {}
  ): ChartPartInput => ({
    chartType,
    colors: ['112233'],
    series: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
    ...extra,
  });
  const tint = { scheme: 'tx1', lumMod: 15000, lumOff: 85000 };
  const tintColor = { value: 'tx1', transforms: { lumMod: 15, lumOff: 85 } };

  it('asks for nothing new when no look is asked for', () => {
    const { chart, series } = chartLook(input('bar'));
    const [category, value] = chart.axes ?? [];
    for (const axis of [category, value]) {
      for (const key of [
        'majorTickMark',
        'minorTickMark',
        'tickLabelPosition',
        'crossBetween',
        'majorGridlines',
        'shapeProperties',
      ]) {
        expect(axis, key).not.toHaveProperty(key);
      }
    }
    expect(chart).not.toHaveProperty('gapWidth');
    expect(chart).not.toHaveProperty('overlap');
    expect(chart).not.toHaveProperty('plotAreaShapeProperties');
    expect(chart.autoTitleDeleted).toBe(false);
    expect(category.position).toBe('bottom');
    expect(value.numberFormat).toEqual({
      formatCode: 'General',
      sourceLinked: true,
    });
    expect(series[0].shapeProperties).toEqual({
      fill: { type: 'solid', color: { value: '112233' } },
    });
  });

  it("states Office's blanks, which the backend writes only when asked", () => {
    const { chart } = chartLook(input('bar'));
    expect(chart).toMatchObject({
      date1904: false,
      lang: 'en-US',
      roundedCorners: false,
      varyColors: false,
      legendPosition: 'bottom',
      legendLayout: true,
      legendOverlay: false,
      shapeProperties: {
        fill: { type: 'none' },
        outline: { type: 'noFill' },
        effects: {},
      },
      externalData: { relationshipId: 'rId1', autoUpdate: false },
    });
  });

  it("spells an axis, its gridlines, ticks and line in the backend's vocabulary", () => {
    const { chart } = chartLook(
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
          min: 0,
          max: 10,
          majorUnit: 5,
          numberFormat: '#,##0',
        },
      })
    );
    expect(chart.axes).toEqual([
      {
        kind: 'category',
        scaling: { orientation: 'ascending' },
        delete: false,
        position: 'left',
        majorTickMark: 'none',
        minorTickMark: 'none',
        tickLabelPosition: 'nextTo',
        shapeProperties: {
          outline: { width: 9525, type: 'solidFill', color: tintColor },
        },
        crosses: 'zero',
        auto: true,
        labelOffset: 100,
        noMultiLevelLabel: false,
      },
      {
        kind: 'value',
        scaling: { orientation: 'ascending', max: 10, min: 0 },
        delete: false,
        position: 'bottom',
        majorGridlines: {
          shapeProperties: {
            outline: { width: 9525, type: 'solidFill', color: tintColor },
          },
        },
        numberFormat: { formatCode: '#,##0', sourceLinked: false },
        majorTickMark: 'none',
        shapeProperties: { outline: { type: 'noFill' } },
        crosses: 'zero',
        crossBetween: 'between',
        majorUnit: 5,
      },
    ]);
  });

  it('never gives a category axis a crossBetween, which CT_CatAx lacks', () => {
    const { chart } = chartLook(
      input('bar', { categoryAxis: { crossBetween: 'midCat' } })
    );
    expect(chart.axes?.[0]).not.toHaveProperty('crossBetween');
  });

  it('refuses a vocabulary word it has no backend spelling for', () => {
    expect(() => chartLook(input('bar', { legendPosition: 'middle' }))).toThrow(
      /legend position "middle"/
    );
  });

  it('asks for bar gaps and borderless bars', () => {
    const { chart, series } = chartLook(
      input('bar', { gapWidth: 182, overlap: 0, dataBorder: 'none' })
    );
    expect(chart).toMatchObject({ gapWidth: 182, overlap: 0 });
    expect(series[0].shapeProperties).toEqual({
      fill: { type: 'solid', color: { value: '112233' } },
      outline: { type: 'noFill' },
    });
  });

  it('overlaps a stack fully unless an overlap was authored', () => {
    expect(
      chartLook(input('bar', { overlap: -27, barGrouping: 'stacked' })).chart
    ).toMatchObject({ grouping: 'stacked', overlap: -27 });
    expect(
      chartLook(input('bar', { barGrouping: 'percentStacked' })).chart
    ).toMatchObject({ grouping: 'percentStacked', overlap: 100 });
    // A stacked area has no overlap to state.
    expect(
      chartLook(input('area', { barGrouping: 'stacked' })).chart
    ).not.toHaveProperty('overlap');
  });

  it("gives a doughnut's slices borders in a theme colour, its first angle and its hole", () => {
    const { chart, series } = chartLook(
      input('doughnut', {
        colors: ['112233', '445566'],
        dataBorder: { widthPoints: 1.5, color: { scheme: 'lt1' } },
        firstSliceAngle: 0,
        holeSize: 50,
      })
    );
    expect(chart).toMatchObject({
      varyColors: true,
      firstSliceAngle: 0,
      holeSize: 50,
    });
    expect(chart).not.toHaveProperty('axes');
    expect(series[0].dataPoints).toEqual(
      ['112233', '445566'].map((hex, index) => ({
        index,
        bubble3D: false,
        shapeProperties: {
          fill: { type: 'solid', color: { value: hex } },
          outline: {
            width: 19050,
            type: 'solidFill',
            color: { value: 'lt1' },
          },
        },
      }))
    );
    expect(series[0]).not.toHaveProperty('shapeProperties');
  });

  it('strokes a line series with a cap and join, and outlines its markers', () => {
    const { chart, series } = chartLook(
      input('line', {
        lineWidthPoints: 2.25,
        lineCap: 'rnd',
        lineJoin: 'round',
        markerLineWidthPoints: 0.75,
        lineMarkers: true,
      })
    );
    const color = { value: '112233' };
    expect(series[0].shapeProperties).toEqual({
      outline: {
        width: 28575,
        cap: 'round',
        type: 'solidFill',
        color,
        join: 'round',
      },
    });
    expect(series[0].marker).toEqual({
      shapeProperties: {
        fill: { type: 'solid', color },
        outline: { width: 9525, type: 'solidFill', color },
      },
    });
    expect(chart.markers).toBe(true);
    // The series' own symbol and size survive the colour.
    expect(
      withSeriesLook(
        { name: 'S', values: [1], marker: { symbol: 'circle', size: 5 } },
        series[0]
      ).marker
    ).toEqual({ symbol: 'circle', size: 5, ...series[0].marker });
  });

  it('styles the labels a series has, and adds none to one without', () => {
    const { series } = chartLook(
      input('bar', { dataLabelFont: { fontSize: 9 } })
    );
    const labelled = withSeriesLook(
      { name: 'S', values: [1], dataLabels: { showVal: true } },
      series[0]
    );
    expect(labelled.dataLabels).toMatchObject({
      showVal: true,
      textProperties: {
        paragraphs: [{ properties: { defaultRunProperties: { size: 9 } } }],
      },
    });
    const bare = withSeriesLook({ name: 'S', values: [1] }, series[0]);
    expect(bare).not.toHaveProperty('dataLabels');
  });

  it('names the cells behind every cached value, and none for an empty series', () => {
    const { chart, series } = chartLook(
      input('bar', {
        series: [
          { name: 'A', labels: ['a', 'b', 'c'], values: [1, 2, 3] },
          { name: 'B', labels: ['a', 'b', 'c'], values: [4, 5] },
          { name: 'C', labels: ['a', 'b', 'c'], values: [] },
        ],
      })
    );
    expect(chart.categoryFormula).toBe('Sheet1!$A$2:$A$4');
    expect(series.map((s) => [s.nameFormula, s.valueFormula])).toEqual([
      ['Sheet1!$B$1', 'Sheet1!$B$2:$B$4'],
      // A short series claims only the cells it has.
      ['Sheet1!$C$1', 'Sheet1!$C$2:$C$3'],
      [undefined, undefined],
    ]);
  });

  it("writes a scatter chart's x values as numbers, and its workbook's column A", () => {
    const series1 = [{ name: 'S', labels: ['1', '2.5'], values: [1, 2] }];
    const scatter: ChartPartInput = {
      chartType: 'scatter',
      colors: [],
      series: series1,
      scatterStyle: 'lineMarker',
      scatterXValues: [1, 2.5],
    };
    const { chart } = chartLook(scatter);
    expect(chart).toMatchObject({
      numericCategories: true,
      categories: ['1', '2.5'],
      categoryFormula: 'Sheet1!$A$2:$A$3',
      categoryFormatCode: 'General',
    });
    // Both axes are value axes, X first.
    expect(chart.axes?.map((axis) => axis.kind)).toEqual(['value', 'value']);

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
    // And the part caches those numbers, which is what it is matched by.
    expect(chartInputSignature(scatter)).toBe(
      ['S', '1', '2.5', '1', '2'].join('\u0001')
    );
  });

  it('keeps an untitled chart untitled, and states an unfilled plot area', () => {
    const { chart } = chartLook(
      input('column', { autoTitleDeleted: true, plotAreaUnfilled: true })
    );
    expect(chart.autoTitleDeleted).toBe(true);
    expect(chart).not.toHaveProperty('title');
    expect(chart.plotAreaShapeProperties).toEqual({
      fill: { type: 'none' },
      outline: { type: 'noFill' },
    });
  });
});

/**
 * The one thing no option carries. A splice that cannot find what it edits
 * fails the render: a changed spelling upstream must not turn it into a
 * silent no-op.
 */
describe('finishing a chart part', () => {
  const scatter: ChartPartInput = {
    chartType: 'scatter',
    colors: [],
    series: [],
    scatterStyle: 'lineMarker',
  };
  const part = (style: string) =>
    `<c:chartSpace><c:scatterChart><c:scatterStyle val="${style}"/>` +
    `</c:scatterChart></c:chartSpace>`;

  it("sets a scatter chart's style over the backend's literal", () => {
    expect(finishChartXml(part('line'), scatter)).toBe(part('lineMarker'));
  });

  it('leaves a style already written alone', () => {
    expect(finishChartXml(part('lineMarker'), scatter)).toBe(
      part('lineMarker')
    );
  });

  it('fails rather than miss the literal it replaces', () => {
    expect(() =>
      finishChartXml('<c:chartSpace><c:scatterChart/></c:chartSpace>', scatter)
    ).toThrow(/scatterStyle/);
  });

  it('touches nothing else', () => {
    const bar = '<c:chartSpace><c:barChart/></c:chartSpace>';
    expect(finishChartXml(bar, { ...scatter, chartType: 'bar' })).toBe(bar);
    expect(
      finishChartXml(part('line'), { ...scatter, scatterStyle: undefined })
    ).toBe(part('line'));
  });
});

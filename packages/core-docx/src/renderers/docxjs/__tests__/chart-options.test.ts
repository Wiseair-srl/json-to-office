/**
 * `DocxIrChartRun` → `ChartRunOptions`, as options.
 *
 * The mapping is pure, so it is pinned here field by field; what `ChartRun`
 * then writes is `chart-render.test.ts`'s business, and how it compares with
 * office-open's part is `chart-cross-backend.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';
import type { IFloating } from 'docx';
import type {
  DocxIrChartLegendPosition,
  DocxIrChartRun,
  DocxIrChartType,
} from '../../../ir/types';
import { chartRunOptions } from '../charts';

const TEXT = {
  fontFamily: 'Carlito',
  fontSize: 10,
  bold: false,
  color: '1F2937',
};

const LABELS = ['Q1', 'Q2', 'Q3'];

function chart(overrides: Partial<DocxIrChartRun> = {}): DocxIrChartRun {
  return {
    kind: 'chart',
    chartType: 'column',
    series: [
      { name: 'Revenue', labels: LABELS, values: [12, 18, 15] },
      { labels: LABELS, values: [7, 9, 8] },
    ],
    colors: ['1F4E79', 'C00000'],
    widthEmu: 5486400,
    heightEmu: 2743200,
    title: 'Quarterly revenue',
    categoryAxisTitle: 'Quarter',
    valueAxisTitle: 'EUR (thousands)',
    textFont: TEXT,
    ...overrides,
  };
}

/** Loose access to a union of option shapes. */
const read = (options: unknown): Record<string, any> =>
  options as Record<string, any>;

const ONE_SERIES = [{ name: 'Share', labels: LABELS, values: [50, 30, 20] }];

describe('chartRunOptions', () => {
  describe.each(['column', 'bar', 'area', 'line', 'radar'] as const)(
    'a %s chart',
    (type) => {
      const options = read(chartRunOptions(chart({ chartType: type })));

      it('keeps the type, the categories and the series in order', () => {
        expect(options.type).toBe(type);
        expect(options.categories).toEqual(LABELS);
        expect(options.series.map((s: { name: string }) => s.name)).toEqual([
          'Revenue',
          // Office-open's default for an unnamed series.
          'Series 2',
        ]);
        expect(options.series[1].values).toEqual([7, 9, 8]);
      });

      it('colours each series from the palette', () => {
        expect(options.series.map((s: { color: string }) => s.color)).toEqual([
          '1F4E79',
          'C00000',
        ]);
      });

      it('titles both axes in the axis-title font', () => {
        expect(options.categoryAxis.title).toEqual({
          text: 'Quarter',
          font: { name: 'Carlito', size: 10, color: '1F2937', bold: false },
        });
        expect(options.valueAxis.title.text).toBe('EUR (thousands)');
      });
    }
  );

  it('draws markers on lines and radar only, and joins scatter points', () => {
    expect(read(chartRunOptions(chart({ chartType: 'line' }))).markers).toBe(
      true
    );
    expect(read(chartRunOptions(chart({ chartType: 'radar' }))).markers).toBe(
      true
    );
    expect(
      read(chartRunOptions(chart({ chartType: 'column' }))).markers
    ).toBeUndefined();
    const scatter = read(chartRunOptions(chart({ chartType: 'scatter' })));
    expect(scatter.markers).toBe(true);
    expect(scatter.lines).toBe('straight');
  });

  it('cycles a palette shorter than the series', () => {
    const options = read(
      chartRunOptions(
        chart({
          colors: ['123456'],
          series: [
            { name: 'A', labels: LABELS, values: [1, 2, 3] },
            { name: 'B', labels: LABELS, values: [1, 2, 3] },
          ],
        })
      )
    );
    expect(options.series.map((s: { color: string }) => s.color)).toEqual([
      '123456',
      '123456',
    ]);
  });

  it('leaves colours to docx.js when the palette is empty', () => {
    const options = read(chartRunOptions(chart({ colors: [] })));
    expect(options.series.every((s: object) => !('color' in s))).toBe(true);
    const pie = read(
      chartRunOptions(
        chart({ chartType: 'pie', colors: [], series: ONE_SERIES })
      )
    );
    expect('colors' in pie.series[0]).toBe(false);
  });

  it('colours a pie per slice', () => {
    const options = read(
      chartRunOptions(
        chart({
          chartType: 'pie',
          series: ONE_SERIES,
          colors: ['111111', '222222'],
        })
      )
    );
    expect(options.type).toBe('pie');
    expect(options.categories).toEqual(LABELS);
    expect(options.series).toEqual([
      {
        name: 'Share',
        values: [50, 30, 20],
        colors: ['111111', '222222', '111111'],
      },
    ]);
  });

  it('colours every ring of a doughnut per slice, and draws no axes', () => {
    const options = read(chartRunOptions(chart({ chartType: 'doughnut' })));
    expect(options.type).toBe('doughnut');
    expect(options.series.map((s: { colors: string[] }) => s.colors)).toEqual([
      ['1F4E79', 'C00000', '1F4E79'],
      ['1F4E79', 'C00000', '1F4E79'],
    ]);
    expect(options.categoryAxis).toBeUndefined();
    expect(options.valueAxis).toBeUndefined();
    // The hole is docx.js's default: office-open states none either.
    expect(options.holeSize).toBeUndefined();
  });

  it("plots a scatter point's numeric label as its x", () => {
    const options = read(
      chartRunOptions(
        chart({
          chartType: 'scatter',
          series: [
            { name: 'A', labels: ['1', '2.5', ' 4 '], values: [3, 1, 2] },
            { name: 'B', labels: ['1', '2.5', ' 4 '], values: [1, 2, 3] },
          ],
        })
      )
    );
    expect(options.type).toBe('scatter');
    expect(options.categories).toBeUndefined();
    expect(options.series[0]).toEqual({
      name: 'A',
      points: [
        { x: 1, y: 3 },
        { x: 2.5, y: 1 },
        { x: 4, y: 2 },
      ],
      color: '1F4E79',
    });
  });

  it('places a scatter point with a text label at its position', () => {
    const options = read(
      chartRunOptions(
        chart({
          chartType: 'scatter',
          series: [
            { name: 'A', labels: ['Jan', '7', 'Mar'], values: [3, 1, 2] },
          ],
        })
      )
    );
    expect(options.series[0].points).toEqual([
      { x: 1, y: 3 },
      { x: 7, y: 1 },
      { x: 3, y: 2 },
    ]);
  });

  it('gives a scatter chart value axes, with no X gridlines', () => {
    const options = read(chartRunOptions(chart({ chartType: 'scatter' })));
    expect(options.xAxis.gridlines).toBe(false);
    expect(options.xAxis.title.text).toBe('Quarter');
    expect(options.yAxis.title.text).toBe('EUR (thousands)');
    expect(options.yAxis.gridlines).toBeUndefined();
    expect(options.categoryAxis).toBeUndefined();
  });

  it.each([
    ['b', 'bottom'],
    ['l', 'left'],
    ['r', 'right'],
    ['t', 'top'],
    ['tr', 'topRight'],
  ] as const)('puts a legend at %s on the %s', (position, expected) => {
    const options = read(
      chartRunOptions(
        chart({ legendPosition: position as DocxIrChartLegendPosition })
      )
    );
    expect(options.legend.position).toBe(expected);
  });

  it('puts the legend at the bottom by default, and none when hidden', () => {
    expect(read(chartRunOptions(chart())).legend.position).toBe('bottom');
    expect(read(chartRunOptions(chart({ showLegend: false }))).legend).toBe(
      false
    );
    expect(
      read(chartRunOptions(chart({ showLegend: true }))).legend.position
    ).toBe('bottom');
  });

  it('titles the chart unless the title is hidden or empty', () => {
    expect(read(chartRunOptions(chart())).title.text).toBe('Quarterly revenue');
    expect(
      read(chartRunOptions(chart({ showTitle: false }))).title
    ).toBeUndefined();
    expect(read(chartRunOptions(chart({ title: '' }))).title).toBeUndefined();
    expect(
      read(chartRunOptions(chart({ title: undefined }))).title
    ).toBeUndefined();
  });

  it('states every text element: title at 1.4x bold, the rest at the chart size', () => {
    const options = read(chartRunOptions(chart()));
    const text = { name: 'Carlito', size: 10, color: '1F2937', bold: false };

    // Chart-wide: face and colour only — `ChartRun` takes no size there.
    expect(options.font).toEqual({ name: 'Carlito', color: '1F2937' });
    expect(options.title.font).toEqual({ ...text, size: 14, bold: true });
    expect(options.legend.font).toEqual(text);
    expect(options.categoryAxis.font).toEqual(text);
    expect(options.valueAxis.font).toEqual(text);
    expect(options.categoryAxis.title.font).toEqual(text);
    expect(options.valueAxis.title.font).toEqual(text);

    const small = read(
      chartRunOptions(chart({ textFont: { ...TEXT, fontSize: 8 } }))
    );
    expect(small.title.font.size).toBe(11);
    expect(small.legend.font.size).toBe(8);
  });

  it('draws the chart area with no fill and no border', () => {
    expect(read(chartRunOptions(chart())).chartArea).toEqual({
      fill: 'none',
      border: 'none',
    });
  });

  it('sizes the chart in pixels from its EMU extent', () => {
    const options = read(
      chartRunOptions(chart({ widthEmu: 5486401, heightEmu: 952500 }))
    );
    expect(options.transformation).toEqual({
      width: 5486401 / 9525,
      height: 100,
    });
  });

  it('describes the chart only with the alt text the author wrote', () => {
    expect(read(chartRunOptions(chart())).altText).toBeUndefined();
    expect(
      read(chartRunOptions(chart({ altText: 'Revenue by quarter' }))).altText
    ).toEqual({ name: '', description: 'Revenue by quarter' });
  });

  it('passes floating options through, and none for an inline chart', () => {
    const floating = {
      horizontalPosition: { relative: 'margin', align: 'right' },
      zIndex: 2,
    } as unknown as IFloating;
    expect(read(chartRunOptions(chart(), floating)).floating).toBe(floating);
    expect(read(chartRunOptions(chart())).floating).toBeUndefined();
  });

  it('refuses a bubble chart', () => {
    expect(() =>
      chartRunOptions(chart({ chartType: 'bubble' as DocxIrChartType }))
    ).toThrow(/bubble/);
  });
});

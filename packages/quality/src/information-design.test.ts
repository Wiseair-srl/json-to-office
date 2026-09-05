import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from './types';
import {
  chartInfoDesignFindings,
  columnNumericProfile,
  hasUnitMarker,
  normalizeHighchartsChart,
  parseNumericCell,
  tableInfoDesignFindings,
  type ChartInfoDesign,
  type TableInfoDesign,
} from './information-design';

describe('parseNumericCell', () => {
  it('reads plain integers and decimals', () => {
    expect(parseNumericCell('42')).toEqual({ value: 42, decimals: 0 });
    expect(parseNumericCell('3.14')).toEqual({ value: 3.14, decimals: 2 });
    expect(parseNumericCell(' -7.5 ')).toEqual({ value: -7.5, decimals: 1 });
  });

  it('strips the notation a number is dressed in, not the number', () => {
    expect(parseNumericCell('$ 1,234.50')).toEqual({
      value: 1234.5,
      decimals: 2,
    });
    expect(parseNumericCell('+11.1%')).toEqual({ value: 11.1, decimals: 1 });
    // A no-break space is the thousands separator half of Europe types.
    expect(parseNumericCell('12\u00a0500')).toEqual({
      value: 12500,
      decimals: 0,
    });
    expect(parseNumericCell('€12.4m')).toEqual({ value: 12.4, decimals: 1 });
    expect(parseNumericCell('(1,200)')).toEqual({ value: -1200, decimals: 0 });
  });

  it('reads a comma as a decimal point when it cannot be a thousands mark', () => {
    // The European form the stock annual report writes its currency in.
    expect(parseNumericCell('$ 50,00')).toEqual({ value: 50, decimals: 2 });
    expect(parseNumericCell('1.234,56')).toEqual({
      value: 1234.56,
      decimals: 2,
    });
    // Three trailing digits after a single separator: a thousands group.
    expect(parseNumericCell('1,234')).toEqual({ value: 1234, decimals: 0 });
    expect(parseNumericCell('1.234.567')).toEqual({
      value: 1234567,
      decimals: 0,
    });
  });

  it('reads the last of two different separators as the decimal point', () => {
    // Three trailing digits, but a thousands mark already appeared, so this
    // one cannot be another: both spellings are the same number.
    expect(parseNumericCell('1,234.567')).toEqual({
      value: 1234.567,
      decimals: 3,
    });
    expect(parseNumericCell('1.234,567')).toEqual({
      value: 1234.567,
      decimals: 3,
    });
  });

  it('refuses anything that is not a number', () => {
    for (const text of ['Adoption', 'Q3 2024', '', '12/04', '3D', 'n/a']) {
      expect(parseNumericCell(text)).toBeUndefined();
    }
  });
});

describe('columnNumericProfile', () => {
  it('recognises a numeric column and its decimal places', () => {
    expect(columnNumericProfile(['1.5', '2.0', '3.5'])).toEqual({
      numeric: true,
      decimals: [1],
      counted: 3,
    });
  });

  it('treats blanks and dashes as gaps rather than as text', () => {
    expect(columnNumericProfile(['12', '—', 'n/a', '15'])).toMatchObject({
      numeric: true,
      counted: 2,
    });
  });

  it('needs two numbers before a column counts as numeric', () => {
    expect(columnNumericProfile(['Total', '72%'])).toMatchObject({
      numeric: false,
    });
    expect(columnNumericProfile(['72%'])).toMatchObject({ numeric: false });
  });

  it('reports every distinct decimal count, sorted', () => {
    expect(columnNumericProfile(['1.5', '2', '3.25'])).toMatchObject({
      decimals: [0, 1, 2],
    });
  });
});

describe('hasUnitMarker', () => {
  it('accepts the ways a unit is actually written', () => {
    for (const text of [
      'Revenue (€m)',
      'Share of total, %',
      'Emissions (tCO2e)',
      'Cost in USD',
      'Headcount (FTE)',
    ]) {
      expect(hasUnitMarker(text)).toBe(true);
    }
  });

  it('rejects a quantity named without its unit', () => {
    for (const text of ['Revenue', 'Adoption', '', 'Performance over time']) {
      expect(hasUnitMarker(text)).toBe(false);
    }
  });
});

function chart(overrides: Partial<ChartInfoDesign> = {}): ChartInfoDesign {
  return {
    path: '/children/0/children/0',
    chartType: 'bar',
    encoding: 'length',
    threeD: false,
    seriesCount: 2,
    categoryCount: 4,
    seriesColorsStated: true,
    seriesColorsPath: '/children/0/children/0/props/chartColors',
    unitStated: true,
    ...overrides,
  };
}

function codesOf(findings: readonly { code?: string }[]): string[] {
  return findings.map((finding) => finding.code ?? '');
}

describe('chartInfoDesignFindings', () => {
  it('says nothing about a chart that states its palette, its unit and its scale', () => {
    expect(chartInfoDesignFindings(chart())).toEqual([]);
  });

  it('flags a 3D type as a distortion of the comparison', () => {
    const findings = chartInfoDesignFindings(
      chart({ chartType: 'bar3D', threeD: true })
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.CHART_3D,
      severity: 'warning',
      category: 'information-design',
      path: '/children/0/children/0',
    });
  });

  it('flags a pie past six slices and a plot past four series, separately', () => {
    const slices = chartInfoDesignFindings(
      chart({
        chartType: 'pie',
        encoding: 'angle',
        seriesCount: 1,
        categoryCount: 9,
      })
    );
    expect(slices[0]).toMatchObject({
      code: QUALITY_CODES.CHART_OVERLOADED,
      severity: 'warning',
      evidence: { actual: 9, expected: 6, unit: 'slices' },
    });

    const series = chartInfoDesignFindings(chart({ seriesCount: 6 }));
    expect(series[0]).toMatchObject({
      code: QUALITY_CODES.CHART_OVERLOADED,
      evidence: { actual: 6, expected: 4, unit: 'series' },
    });
  });

  it('leaves a six-slice pie and a four-series plot alone', () => {
    expect(
      chartInfoDesignFindings(
        chart({
          chartType: 'pie',
          encoding: 'angle',
          seriesCount: 1,
          categoryCount: 6,
        })
      )
    ).toEqual([]);
    expect(chartInfoDesignFindings(chart({ seriesCount: 4 }))).toEqual([]);
  });

  it('counts categories as slices only where the chart draws slices', () => {
    // Twelve months on a line is a time series, not an overloaded pie.
    expect(
      chartInfoDesignFindings(
        chart({ chartType: 'line', encoding: 'position', categoryCount: 12 })
      )
    ).toEqual([]);
  });

  it('flags a bar axis that does not start at zero, and only a bar axis', () => {
    const bars = chartInfoDesignFindings(chart({ valueAxisMin: 50 }));
    expect(bars[0]).toMatchObject({
      code: QUALITY_CODES.CHART_AXIS_BASELINE,
      severity: 'warning',
      evidence: { actual: 50, expected: 0 },
    });
    expect(chartInfoDesignFindings(chart({ valueAxisMin: 0 }))).toEqual([]);
    expect(
      chartInfoDesignFindings(
        chart({ chartType: 'line', encoding: 'position', valueAxisMin: 50 })
      )
    ).toEqual([]);
  });

  it('flags an unstated palette and carries the fix it was handed', () => {
    const findings = chartInfoDesignFindings(
      chart({ seriesColorsStated: false }),
      {
        seriesColorFix: [
          {
            op: 'add',
            path: '/children/0/children/0/props/chartColors',
            value: ['primary', 'accent'],
          },
        ],
      }
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.CHART_SERIES_COLORS,
      severity: 'warning',
      path: '/children/0/children/0/props/chartColors',
      fixes: [
        {
          op: 'add',
          path: '/children/0/children/0/props/chartColors',
          value: ['primary', 'accent'],
        },
      ],
    });
  });

  it('still reports an unstated palette when no fix can be built', () => {
    const findings = chartInfoDesignFindings(
      chart({ seriesColorsStated: false })
    );
    expect(findings[0]?.code).toBe(QUALITY_CODES.CHART_SERIES_COLORS);
    expect(findings[0]?.fixes).toBeUndefined();
  });

  it('advises when nothing names the unit of the numbers', () => {
    const findings = chartInfoDesignFindings(chart({ unitStated: false }));
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.CHART_UNITS,
      severity: 'info',
    });
  });

  it('judges the takeaway slot only where the component has one', () => {
    const slot = { path: '/children/0/children/0', slot: 'props.caption' };
    expect(
      chartInfoDesignFindings(
        chart({ annotation: { ...slot, stated: false } })
      )[0]
    ).toMatchObject({
      code: QUALITY_CODES.CHART_ANNOTATION,
      severity: 'info',
      path: '/children/0/children/0',
      message: expect.stringContaining('props.caption'),
    });
    expect(
      chartInfoDesignFindings(chart({ annotation: { ...slot, stated: true } }))
    ).toEqual([]);
    // No slot at all: a native slide chart carries neither caption nor source.
    expect(codesOf(chartInfoDesignFindings(chart()))).toEqual([]);
  });

  it('honours the limits a profile lowers', () => {
    expect(
      codesOf(
        chartInfoDesignFindings(chart({ seriesCount: 3 }), { maximumSeries: 2 })
      )
    ).toEqual([QUALITY_CODES.CHART_OVERLOADED]);
  });
});

describe('normalizeHighchartsChart', () => {
  it('reads type, series, categories and palette off a Highcharts config', () => {
    const shape = normalizeHighchartsChart({
      chart: { type: 'column' },
      colors: ['#123456', '#654321'],
      yAxis: { min: 20, title: { text: 'Revenue (€m)' } },
      series: [
        { name: 'A', data: [1, 2, 3] },
        { name: 'B', data: [4, 5, 6] },
      ],
      caption: { text: 'Source: internal.' },
    });
    expect(shape).toMatchObject({
      chartType: 'column',
      encoding: 'length',
      threeD: false,
      seriesCount: 2,
      categoryCount: 3,
      seriesColorsStated: true,
      valueAxisMin: 20,
      unitStated: true,
      annotationStated: true,
    });
  });

  it('treats a per-series colour as a stated palette', () => {
    expect(
      normalizeHighchartsChart({
        series: [
          { color: '#123456', data: [1] },
          { color: '#654321', data: [2] },
        ],
      })
    ).toMatchObject({ seriesColorsStated: true });
  });

  it('sees a 3D plot however it is switched on', () => {
    expect(
      normalizeHighchartsChart({ chart: { options3d: { enabled: true } } })
    ).toMatchObject({ threeD: true });
    expect(
      normalizeHighchartsChart({ chart: { options3d: { enabled: false } } })
    ).toMatchObject({ threeD: false });
  });

  it('counts a pie’s slices from its data, and reads percent labels as a unit', () => {
    expect(
      normalizeHighchartsChart({
        chart: { type: 'pie' },
        series: [
          {
            data: [
              { name: 'a', y: 1 },
              { name: 'b', y: 2 },
            ],
          },
        ],
        plotOptions: {
          pie: { dataLabels: { format: '{point.percentage:.1f}%' } },
        },
      })
    ).toMatchObject({
      encoding: 'angle',
      categoryCount: 2,
      seriesCount: 1,
      unitStated: true,
    });
  });

  it('says nothing it cannot see', () => {
    expect(normalizeHighchartsChart(undefined)).toMatchObject({
      chartType: 'line',
      seriesCount: 0,
      categoryCount: 0,
      seriesColorsStated: false,
      unitStated: false,
      annotationStated: false,
    });
  });
});

function table(overrides: Partial<TableInfoDesign> = {}): TableInfoDesign {
  return {
    path: '/children/0/children/0',
    columns: [
      {
        index: 0,
        path: '/children/0/children/0/props/columns/0',
        values: ['Adoption', 'Retention'],
        alignment: 'left',
      },
      {
        index: 1,
        path: '/children/0/children/0/props/columns/1',
        values: ['12.0', '15.5'],
        alignment: 'right',
      },
    ],
    rowCount: 2,
    fullGrid: false,
    ...overrides,
  };
}

describe('tableInfoDesignFindings', () => {
  it('says nothing about a table whose numbers are right-aligned and evenly rounded', () => {
    expect(tableInfoDesignFindings(table())).toEqual([]);
  });

  it('flags a numeric column that is not right-aligned, and offers the alignment', () => {
    const findings = tableInfoDesignFindings(
      table({
        columns: [
          {
            index: 0,
            path: '/t/props/columns/0',
            values: ['Adoption', 'Retention'],
            alignment: 'left',
          },
          {
            index: 1,
            path: '/t/props/columns/1',
            values: ['12.0', '15.5'],
            alignment: 'left',
          },
        ],
      }),
      {
        alignFix: (column) => [
          { op: 'add', path: `${column.path}/cellDefaults`, value: {} },
        ],
      }
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_NUMERIC_ALIGN,
      severity: 'warning',
      category: 'information-design',
      path: '/t/props/columns/1',
      fixes: [
        { op: 'add', path: '/t/props/columns/1/cellDefaults', value: {} },
      ],
    });
  });

  it('leaves a text column alone however it is aligned', () => {
    expect(
      tableInfoDesignFindings(
        table({
          columns: [
            {
              index: 0,
              path: '/t/props/columns/0',
              values: ['Adoption', 'Retention'],
              alignment: 'center',
            },
          ],
        })
      )
    ).toEqual([]);
  });

  it('flags a numeric column whose rows are rounded differently', () => {
    const findings = tableInfoDesignFindings(
      table({
        columns: [
          {
            index: 1,
            path: '/t/props/columns/1',
            values: ['12', '15.5', '9.25'],
            alignment: 'right',
          },
        ],
      })
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_MIXED_DECIMALS,
      severity: 'warning',
      path: '/t/props/columns/1',
      evidence: { actual: [0, 1, 2] },
    });
  });

  it('reports a full grid as information, not as a defect', () => {
    const findings = tableInfoDesignFindings(
      table({ fullGrid: true, gridPath: '/t/props/border' })
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_GRID,
      severity: 'info',
      path: '/t/props/border',
    });
  });

  it('reports a table longer than the surface can carry', () => {
    const findings = tableInfoDesignFindings(table({ rowCount: 20 }), {
      maximumRows: 12,
      rowSurface: 'slide',
      rowSeverity: 'warning',
    });
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_ROW_COUNT,
      severity: 'warning',
      evidence: { actual: 20, expected: 12, unit: 'rows' },
    });
    expect(findings[0]?.message).toContain('slide');
  });

  it('leaves a table at the limit alone', () => {
    expect(
      tableInfoDesignFindings(table({ rowCount: 12 }), { maximumRows: 12 })
    ).toEqual([]);
  });
});

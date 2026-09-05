import { describe, expect, it } from 'vitest';
import {
  chartFontFaceCss,
  chartPointsPerPixel,
  cssFontFamily,
  withChartTypography,
  type ChartTypography,
} from '../theme/chart-typography';

const typography: ChartTypography = {
  bodyFamily: '"Calibri", sans-serif',
  headingFamily: '"Arial", sans-serif',
  textColor: '#1A1F26',
  mutedColor: '#4B5563',
  labelPt: 9,
  labelWeight: 400,
  titlePt: 11,
  titleWeight: 700,
  sourcePt: 8,
};

describe('withChartTypography', () => {
  it('fills family, sizes and colours where the author left gaps', () => {
    const options = withChartTypography(
      { chart: { width: 900, height: 480 }, series: [] },
      typography,
      0.75
    );
    expect(options.chart).toEqual({
      width: 900,
      height: 480,
      style: { fontFamily: '"Calibri", sans-serif' },
    });
    expect(options.title).toEqual({
      style: {
        fontFamily: '"Arial", sans-serif',
        fontSize: '14.7px',
        fontWeight: '700',
        color: '#1A1F26',
      },
    });
    expect(options.subtitle).toEqual({
      style: { fontSize: '12px', color: '#4B5563' },
    });
    for (const axis of ['xAxis', 'yAxis'] as const) {
      expect(options[axis]).toEqual({
        labels: { style: { fontSize: '12px', color: '#4B5563' } },
        title: { style: { fontSize: '12px', color: '#4B5563' } },
      });
    }
    expect(options.legend).toEqual({
      itemStyle: { fontSize: '12px', color: '#1A1F26', fontWeight: '400' },
    });
    expect(options.plotOptions).toEqual({
      series: {
        dataLabels: {
          style: { fontSize: '12px', color: '#1A1F26', fontWeight: '400' },
        },
      },
    });
    expect(options.credits).toEqual({
      style: { fontSize: '10.7px', color: '#4B5563' },
    });
    expect(options.caption).toEqual({
      style: { fontSize: '10.7px', color: '#4B5563' },
    });
  });

  it('keeps every explicit author value, property by property', () => {
    const authored = {
      chart: { width: 900, height: 480, style: { fontFamily: 'Inter' } },
      title: { text: 'T', style: { fontSize: '30px' } },
      legend: { enabled: false, itemStyle: { color: '#FF0000' } },
      xAxis: [{ labels: { style: { color: '#00FF00' } } }, {}],
      credits: { enabled: false },
    };
    const options = withChartTypography(authored, typography, 0.75);
    expect(options.chart.style).toEqual({ fontFamily: 'Inter' });
    expect(options.title).toEqual({
      text: 'T',
      style: {
        fontSize: '30px',
        fontFamily: '"Arial", sans-serif',
        fontWeight: '700',
        color: '#1A1F26',
      },
    });
    expect(options.legend).toEqual({
      enabled: false,
      itemStyle: { color: '#FF0000', fontSize: '12px', fontWeight: '400' },
    });
    expect(options.xAxis).toEqual([
      {
        labels: { style: { color: '#00FF00', fontSize: '12px' } },
        title: { style: { fontSize: '12px', color: '#4B5563' } },
      },
      {
        labels: { style: { fontSize: '12px', color: '#4B5563' } },
        title: { style: { fontSize: '12px', color: '#4B5563' } },
      },
    ]);
    expect(options.credits).toEqual({
      enabled: false,
      style: { fontSize: '10.7px', color: '#4B5563' },
    });
    // The author's object is not mutated.
    expect(authored.title).toEqual({ text: 'T', style: { fontSize: '30px' } });
  });

  it('keeps an authored null or scalar exactly as written', () => {
    const options = withChartTypography(
      {
        chart: { width: 100, height: 100 },
        title: null,
        legend: false,
        xAxis: [null, { labels: false }],
      },
      typography,
      1
    );
    expect(options.title).toBeNull();
    expect(options.legend).toBe(false);
    expect(options.xAxis).toEqual([
      null,
      {
        labels: false,
        title: { style: { fontSize: '9px', color: '#4B5563' } },
      },
    ]);
  });

  it('omits weights the theme does not state', () => {
    const options = withChartTypography(
      { chart: { width: 100, height: 100 } },
      { ...typography, labelWeight: undefined, titleWeight: undefined },
      1
    );
    expect(options.title).toEqual({
      style: {
        fontFamily: '"Arial", sans-serif',
        fontSize: '11px',
        color: '#1A1F26',
      },
    });
    expect(options.legend).toEqual({
      itemStyle: { fontSize: '9px', color: '#1A1F26' },
    });
  });

  it('scales sizes by the points one chart pixel occupies once placed', () => {
    // A 900px chart placed into a 450pt measure: each pixel is half a point,
    // so a 9pt label needs 18 chart pixels to read as 9pt on the page.
    expect(chartPointsPerPixel(900, 450)).toBe(0.5);
    const options = withChartTypography(
      { chart: { width: 900, height: 480 } },
      typography,
      0.5
    );
    expect(options.legend.itemStyle.fontSize).toBe('18px');
  });

  it('falls back to 96 dpi when the placed width is unknown or degenerate', () => {
    expect(chartPointsPerPixel(900, undefined)).toBe(0.75);
    expect(chartPointsPerPixel(0, 450)).toBe(0.75);
    expect(chartPointsPerPixel(900, 0)).toBe(0.75);
  });
});

describe('cssFontFamily', () => {
  it('quotes the family and adds the generic fallback it belongs to', () => {
    expect(cssFontFamily('Calibri')).toBe('"Calibri", sans-serif');
    expect(cssFontFamily('Georgia')).toBe('"Georgia", serif');
    expect(cssFontFamily('Times New Roman')).toBe('"Times New Roman", serif');
    expect(cssFontFamily('Consolas')).toBe('"Consolas", monospace');
    expect(cssFontFamily('Inter', 'sans')).toBe('"Inter", sans-serif');
    expect(cssFontFamily('Roboto Slab', 'serif')).toBe('"Roboto Slab", serif');
    expect(cssFontFamily('Fira Code', 'mono')).toBe('"Fira Code", monospace');
    expect(cssFontFamily('Caveat', 'handwriting')).toBe('"Caveat", cursive');
    expect(cssFontFamily('A "quoted" name')).toBe(
      '"A \\"quoted\\" name", sans-serif'
    );
  });
});

describe('chartFontFaceCss', () => {
  const faces = [
    {
      family: 'Inter',
      weight: 400,
      italic: false,
      data: 'AAAA',
      format: 'ttf',
    },
    {
      family: 'Inter',
      weight: 700,
      italic: true,
      data: 'BBBB',
      format: 'woff2',
    },
    {
      family: 'Other',
      weight: 400,
      italic: false,
      data: 'CCCC',
      format: 'otf',
    },
  ] as const;

  it('emits one @font-face per face of the families the chart uses', () => {
    const css = chartFontFaceCss(faces, ['inter']);
    expect(css).toBe(
      '@font-face{font-family:"Inter";font-weight:400;font-style:normal;' +
        'src:url(data:font/ttf;base64,AAAA) format("truetype")}\n' +
        '@font-face{font-family:"Inter";font-weight:700;font-style:italic;' +
        'src:url(data:font/woff2;base64,BBBB) format("woff2")}'
    );
    expect(css).not.toContain('Other');
  });

  it('is empty when nothing matches', () => {
    expect(chartFontFaceCss(faces, ['Arial'])).toBe('');
    expect(chartFontFaceCss([], ['Inter'])).toBe('');
  });
});

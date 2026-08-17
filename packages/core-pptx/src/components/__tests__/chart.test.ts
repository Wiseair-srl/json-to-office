import { describe, it, expect, vi } from 'vitest';
import { renderChartComponent } from '../chart';
import type { PipelineWarning } from '../../types';

function mockSlide() {
  return { addChart: vi.fn() } as any;
}

// Same three hexes as the DOCX `createMockTheme`, so the resolved palettes
// below can be pinned against their DOCX highcharts siblings.
const baseColors = {
  primary: '#0066cc',
  secondary: '#6c757d',
  accent: '#17a2b8',
  text: '#000000',
  background: '#FFFFFF',
};

const props = {
  type: 'bar',
  data: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
};

function chartOpts(theme: any, warnings?: PipelineWarning[], extra?: any) {
  const slide = mockSlide();
  renderChartComponent(
    slide,
    { ...props, ...extra },
    theme,
    {} as any,
    warnings
  );
  return slide.addChart.mock.calls[0][2];
}

describe('renderChartComponent theme palette', () => {
  it('resolves a token whose value names another token', () => {
    // The theme schema allows "accent4": "primary". pptxgenjs answers an
    // unresolved token name with a console log and a black series, so the
    // reference has to be walked here. DOCX resolves the same theme to
    // ['#0066cc', '#6c757d', '#17a2b8', '#0066CC'].
    const warnings: PipelineWarning[] = [];
    const opts = chartOpts(
      { colors: { ...baseColors, accent4: 'primary' } },
      warnings
    );

    expect(opts.chartColors).toEqual(['0066cc', '6c757d', '17a2b8', '0066CC']);
    expect(opts.chartColors).not.toContain('primary');
    expect(warnings).toEqual([]);
  });

  it('drops a token whose value resolves to nothing', () => {
    const warnings: PipelineWarning[] = [];
    const opts = chartOpts(
      { colors: { ...baseColors, accent4: 'notAThemeColor' } },
      warnings
    );

    expect(opts.chartColors).toEqual(['0066cc', '6c757d', '17a2b8']);
    expect(warnings).toEqual([]);
  });

  it('drops tokens caught in a reference cycle', () => {
    const opts = chartOpts({
      colors: { ...baseColors, accent4: 'accent5', accent5: 'accent4' },
    });

    expect(opts.chartColors).toEqual(['0066cc', '6c757d', '17a2b8']);
  });

  it('warns and falls back for an explicit chartColors entry that resolves to nothing', () => {
    // Only the implicit palette skips silently — naming a broken token is an
    // authoring error, so it stays loud and never reaches pptxgenjs verbatim.
    const warnings: PipelineWarning[] = [];
    const opts = chartOpts(
      { colors: { ...baseColors, accent4: 'notAThemeColor' } },
      warnings,
      { chartColors: ['accent4'] }
    );

    expect(opts.chartColors).toEqual(['0066cc']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('UNKNOWN_COLOR');
    expect(warnings[0].message).toMatch(/accent4/);
  });

  it('resolves an explicit chartColors entry through the reference chain', () => {
    const warnings: PipelineWarning[] = [];
    const opts = chartOpts(
      { colors: { ...baseColors, accent4: 'primary' } },
      warnings,
      { chartColors: ['accent4'] }
    );

    expect(opts.chartColors).toEqual(['0066CC']);
    expect(warnings).toEqual([]);
  });

  it('passes styling options through with resolved colors', () => {
    const warnings: PipelineWarning[] = [];
    const opts = chartOpts({ colors: baseColors }, warnings, {
      dataBorder: { pt: 0.75, color: 'primary' },
      catGridLine: { style: 'none' },
      valGridLine: { style: 'dash', size: 0.5, color: 'accent' },
      catAxisLabelFontFace: 'Inter',
      valAxisLabelFontFace: 'Inter Light',
      lineDataSymbolSize: 8,
      barOverlapPct: -10,
    });

    expect(opts.dataBorder).toEqual({ pt: 0.75, color: '0066cc' });
    expect(opts.catGridLine).toEqual({ style: 'none' });
    expect(opts.valGridLine).toEqual({
      style: 'dash',
      size: 0.5,
      color: '17a2b8',
    });
    expect(opts.catAxisLabelFontFace).toBe('Inter');
    expect(opts.valAxisLabelFontFace).toBe('Inter Light');
    expect(opts.lineDataSymbolSize).toBe(8);
    expect(opts.barOverlapPct).toBe(-10);
    expect(warnings).toEqual([]);
  });

  it('leaves the styling passthrough opts unset when absent', () => {
    const opts = chartOpts({ colors: baseColors });

    expect(opts.dataBorder).toBeUndefined();
    expect(opts.catGridLine).toBeUndefined();
    expect(opts.valGridLine).toBeUndefined();
    expect(opts.catAxisLabelFontFace).toBeUndefined();
    expect(opts.valAxisLabelFontFace).toBeUndefined();
    expect(opts.lineDataSymbolSize).toBeUndefined();
    expect(opts.barOverlapPct).toBeUndefined();
  });

  it('leaves chartColors unset when no token resolves', () => {
    // pptxgenjs indexes `chartColors[i % length]`; an empty array yields
    // undefined and paints every series black without a warning. Omitting the
    // option hands it its own palette instead.
    const warnings: PipelineWarning[] = [];
    const opts = chartOpts(
      { colors: { primary: 'blue', secondary: 'red', accent: 'green' } },
      warnings
    );

    expect(opts.chartColors).toBeUndefined();
  });
});

describe('renderChartComponent axis passthrough', () => {
  it('passes axis line visibility and val label font size through', () => {
    const opts = chartOpts({ colors: baseColors }, undefined, {
      catAxisLineShow: false,
      valAxisLineShow: false,
      valAxisLabelFontSize: 12,
    });
    expect(opts.catAxisLineShow).toBe(false);
    expect(opts.valAxisLineShow).toBe(false);
    expect(opts.valAxisLabelFontSize).toBe(12);
  });

  it('leaves axis line options unset when not given', () => {
    const opts = chartOpts({ colors: baseColors });
    expect(opts.catAxisLineShow).toBeUndefined();
    expect(opts.valAxisLineShow).toBeUndefined();
    expect(opts.valAxisLabelFontSize).toBeUndefined();
  });
});

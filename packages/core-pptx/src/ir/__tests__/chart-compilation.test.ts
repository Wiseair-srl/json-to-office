import { describe, expect, it } from 'vitest';
import type PptxGenJS from 'pptxgenjs';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { IrGenerationOptions } from '../../core/generateFromIr';
import { emitChart } from '../../renderers/pptxgenjs/chart';
import type {
  PipelineWarning,
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../types';
import type { PptxIrChartElement, PptxIrChartType } from '../types';
import { assertValidPptxIr } from '../validation';

/**
 * Ported from the deleted `components/__tests__/chart.test.ts`.
 *
 * Everything the old writer resolved (palettes, weight aliasing, warnings) is
 * now compiler behaviour and is asserted on the IR; the PptxGenJS option-bag
 * shape it produced is adapter behaviour and is asserted on what `emitChart`
 * hands `slide.addChart`. Both layers are checked for every case that used to
 * make a claim about the option bag.
 *
 * One value shape changed on the way: the IR normalises every colour to bare
 * uppercase hex (`irColor`, and the chart palette's own `.toUpperCase()`), so
 * a theme slot authored as `#0066cc` now reaches the adapter as `0066CC`
 * instead of verbatim. The old expectations mixed the two casings depending on
 * whether a reference chain had to be walked; the assertions below pin the
 * normalised value at both layers.
 */

const THEME_NAME = 'chart-test';

type ThemeColors = PptxThemeConfig['colors'];

// Same three hexes as the DOCX `createMockTheme`, so the resolved palettes
// below can be pinned against their DOCX highcharts siblings.
const baseColors: ThemeColors = {
  primary: '#0066cc',
  secondary: '#6c757d',
  accent: '#17a2b8',
  text: '#000000',
  background: '#FFFFFF',
};

const baseProps: Record<string, unknown> = {
  type: 'bar',
  data: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
};

function makeTheme(colors: ThemeColors): PptxThemeConfig {
  return {
    name: THEME_NAME,
    colors,
    fonts: { heading: 'Geist', body: 'Inter' },
    defaults: { fontSize: 18, fontColor: '#000000' },
  } as PptxThemeConfig;
}

function chartDoc(
  props: Record<string, unknown>
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { theme: THEME_NAME },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'chart', props: { ...baseProps, ...props } }],
      },
    ],
  } as unknown as PresentationComponentDefinition;
}

async function compile(
  colors: ThemeColors,
  props: Record<string, unknown> = {},
  options: IrGenerationOptions = {}
) {
  return compileDocumentToIr(chartDoc(props), {
    ...options,
    customThemes: { [THEME_NAME]: makeTheme(colors) },
  });
}

interface EmittedChart {
  type: string;
  data: Array<Record<string, unknown>>;
  opts: Record<string, unknown>;
}

/** Run the adapter and capture the three arguments it hands `addChart`. */
function emit(chart: PptxIrChartElement): EmittedChart {
  const calls: unknown[][] = [];
  const slide = {
    addChart: (...args: unknown[]) => {
      calls.push(args);
    },
  } as unknown as PptxGenJS.Slide;

  emitChart(slide, chart);

  const [type, data, opts] = calls[0];
  return {
    type: type as string,
    data: data as Array<Record<string, unknown>>,
    opts: opts as Record<string, unknown>,
  };
}

interface CompiledChart extends EmittedChart {
  chart: PptxIrChartElement;
  warnings: PipelineWarning[];
}

async function compileChart(
  colors: ThemeColors,
  props: Record<string, unknown> = {},
  /**
   * A theme slot holding a value that is not a colour also lands in
   * `ir.theme.palette`, which the IR invariants reject. The cases that feed
   * one deliberately opt out — the malformed slot is what they are about.
   */
  { validateIr = true }: { validateIr?: boolean } = {}
): Promise<CompiledChart> {
  const { ir, warnings } = await compile(colors, props);
  if (validateIr) assertValidPptxIr(ir);
  const chart = ir.slides[0].elements[0] as PptxIrChartElement;
  return { chart, warnings, ...emit(chart) };
}

describe('chart series palette', () => {
  it('resolves a token whose value names another token', async () => {
    // The theme schema allows "accent4": "primary". pptxgenjs answers an
    // unresolved token name with a console log and a black series, so the
    // reference has to be walked in the compiler. DOCX resolves the same theme
    // to ['#0066cc', '#6c757d', '#17a2b8', '#0066CC'].
    const { chart, opts, warnings } = await compileChart({
      ...baseColors,
      accent4: 'primary',
    });

    expect(chart.options.colors).toEqual([
      '0066CC',
      '6C757D',
      '17A2B8',
      '0066CC',
    ]);
    expect(chart.options.colors).not.toContain('primary');
    expect(opts.chartColors).toEqual(['0066CC', '6C757D', '17A2B8', '0066CC']);
    expect(warnings).toEqual([]);
  });

  it('drops a token whose value resolves to nothing', async () => {
    const { chart, opts, warnings } = await compileChart(
      { ...baseColors, accent4: 'notAThemeColor' },
      {},
      { validateIr: false }
    );

    expect(chart.options.colors).toEqual(['0066CC', '6C757D', '17A2B8']);
    expect(opts.chartColors).toEqual(['0066CC', '6C757D', '17A2B8']);
    expect(warnings).toEqual([]);
  });

  it('drops tokens caught in a reference cycle', async () => {
    const { chart, opts } = await compileChart({
      ...baseColors,
      accent4: 'accent5',
      accent5: 'accent4',
    });

    expect(chart.options.colors).toEqual(['0066CC', '6C757D', '17A2B8']);
    expect(opts.chartColors).toEqual(['0066CC', '6C757D', '17A2B8']);
  });

  it('warns and falls back for an explicit chartColors entry that resolves to nothing', async () => {
    // Only the implicit palette skips silently — naming a broken token is an
    // authoring error, so it stays loud and never reaches pptxgenjs verbatim.
    const { chart, opts, warnings } = await compileChart(
      { ...baseColors, accent4: 'notAThemeColor' },
      { chartColors: ['accent4'] },
      { validateIr: false }
    );

    expect(chart.options.colors).toEqual(['0066CC']);
    expect(opts.chartColors).toEqual(['0066CC']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('UNKNOWN_COLOR');
    expect(warnings[0].message).toMatch(/accent4/);
  });

  it('resolves an explicit chartColors entry through the reference chain', async () => {
    const { chart, opts, warnings } = await compileChart(
      { ...baseColors, accent4: 'primary' },
      { chartColors: ['accent4'] }
    );

    expect(chart.options.colors).toEqual(['0066CC']);
    expect(opts.chartColors).toEqual(['0066CC']);
    expect(warnings).toEqual([]);
  });

  it('leaves chartColors unset when no token resolves', async () => {
    // pptxgenjs indexes `chartColors[i % length]`; an empty array yields
    // undefined and paints every series black without a warning. The compiler
    // keeps the palette empty and the adapter omits the option, handing
    // pptxgenjs its own palette instead.
    const { chart, opts } = await compileChart(
      {
        primary: 'blue',
        secondary: 'red',
        accent: 'green',
        text: 'black',
        background: 'white',
      },
      {},
      { validateIr: false }
    );

    expect(chart.options.colors).toEqual([]);
    expect(opts.chartColors).toBeUndefined();
  });
});

describe('chart styling passthrough', () => {
  it('passes styling options through with resolved colors', async () => {
    const { chart, opts, warnings } = await compileChart(baseColors, {
      dataBorder: { pt: 0.75, color: 'primary' },
      catGridLine: { style: 'none' },
      valGridLine: { style: 'dash', size: 0.5, color: 'accent' },
      catAxisLabelFontFace: 'Inter',
      valAxisLabelFontFace: 'Space Grotesk',
      lineDataSymbolSize: 8,
      barOverlapPct: -10,
    });

    expect(chart.options.dataBorder).toEqual({
      widthPoints: 0.75,
      color: { hex: '0066CC' },
    });
    expect(chart.options.categoryAxis.gridLine).toEqual({ style: 'none' });
    expect(chart.options.valueAxis.gridLine).toEqual({
      style: 'dash',
      size: 0.5,
      color: { hex: '17A2B8' },
    });
    expect(chart.options.categoryAxis.labelFont.fontFamily).toBe('Inter');
    expect(chart.options.valueAxis.labelFont.fontFamily).toBe('Space Grotesk');
    expect(chart.options.lineDataSymbolSize).toBe(8);
    expect(chart.options.barOverlapPercent).toBe(-10);

    expect(opts.dataBorder).toEqual({ pt: 0.75, color: '0066CC' });
    expect(opts.catGridLine).toEqual({ style: 'none' });
    expect(opts.valGridLine).toEqual({
      style: 'dash',
      size: 0.5,
      color: '17A2B8',
    });
    expect(opts.catAxisLabelFontFace).toBe('Inter');
    expect(opts.valAxisLabelFontFace).toBe('Space Grotesk');
    expect(opts.lineDataSymbolSize).toBe(8);
    expect(opts.barOverlapPct).toBe(-10);
    expect(warnings).toEqual([]);
  });

  it('leaves the styling passthrough opts unset when absent', async () => {
    const { chart, opts } = await compileChart(baseColors);

    expect(chart.options.dataBorder).toBeUndefined();
    expect(chart.options.categoryAxis.gridLine).toBeUndefined();
    expect(chart.options.valueAxis.gridLine).toBeUndefined();
    expect(chart.options.categoryAxis.labelFont.fontFamily).toBeUndefined();
    expect(chart.options.valueAxis.labelFont.fontFamily).toBeUndefined();
    expect(chart.options.lineDataSymbolSize).toBeUndefined();
    expect(chart.options.barOverlapPercent).toBeUndefined();

    expect(opts.dataBorder).toBeUndefined();
    expect(opts.catGridLine).toBeUndefined();
    expect(opts.valGridLine).toBeUndefined();
    expect(opts.catAxisLabelFontFace).toBeUndefined();
    expect(opts.valAxisLabelFontFace).toBeUndefined();
    expect(opts.lineDataSymbolSize).toBeUndefined();
    expect(opts.barOverlapPct).toBeUndefined();
  });
});

describe('chart axis options', () => {
  it('passes axis line visibility and val label font size through', async () => {
    const { chart, opts } = await compileChart(baseColors, {
      catAxisLineShow: false,
      valAxisLineShow: false,
      valAxisLabelFontSize: 12,
    });

    expect(chart.options.categoryAxis.showLine).toBe(false);
    expect(chart.options.valueAxis.showLine).toBe(false);
    expect(chart.options.valueAxis.labelFont.fontSize).toBe(12);

    expect(opts.catAxisLineShow).toBe(false);
    expect(opts.valAxisLineShow).toBe(false);
    expect(opts.valAxisLabelFontSize).toBe(12);
  });

  it('leaves axis line options unset when not given', async () => {
    const { chart, opts } = await compileChart(baseColors);

    expect(chart.options.categoryAxis.showLine).toBeUndefined();
    expect(chart.options.valueAxis.showLine).toBeUndefined();
    expect(chart.options.valueAxis.labelFont.fontSize).toBeUndefined();

    expect(opts.catAxisLineShow).toBeUndefined();
    expect(opts.valAxisLineShow).toBeUndefined();
    expect(opts.valAxisLabelFontSize).toBeUndefined();
  });

  it('carries axis titles, bounds and the value label format code', async () => {
    const { chart, opts } = await compileChart(baseColors, {
      catAxisTitle: 'Quarter',
      catAxisHidden: false,
      catAxisLabelRotate: -45,
      valAxisTitle: 'Revenue',
      valAxisMinVal: 0,
      valAxisMaxVal: 100,
      valAxisMajorUnit: 25,
      valAxisLabelFormatCode: '$0.00',
    });

    expect(chart.options.categoryAxis).toMatchObject({
      title: 'Quarter',
      hidden: false,
      labelRotate: -45,
    });
    expect(chart.options.valueAxis).toMatchObject({
      title: 'Revenue',
      minValue: 0,
      maxValue: 100,
      majorUnit: 25,
      labelFormatCode: '$0.00',
    });

    // An authored axis title also turns the axis title on — the adapter, not
    // the author, sets the `show*AxisTitle` companion.
    expect(opts.catAxisTitle).toBe('Quarter');
    expect(opts.showCatAxisTitle).toBe(true);
    expect(opts.catAxisHidden).toBe(false);
    expect(opts.catAxisLabelRotate).toBe(-45);
    expect(opts.valAxisTitle).toBe('Revenue');
    expect(opts.showValAxisTitle).toBe(true);
    expect(opts.valAxisMinVal).toBe(0);
    expect(opts.valAxisMaxVal).toBe(100);
    expect(opts.valAxisMajorUnit).toBe(25);
    expect(opts.valAxisLabelFormatCode).toBe('$0.00');
  });
});

describe('chart label font weights', () => {
  // Chart labels have no numeric weight in OOXML, so a non-RIBBI weight only
  // survives as a synthesized sub-family name — the same seam text runs use.
  const themed = baseColors;

  it('rewrites every label face to the sub-family for a non-RIBBI weight', async () => {
    const { chart, opts } = await compileChart(themed, {
      titleFontFace: 'Inter',
      titleFontWeight: 300,
      legendFontFace: 'Inter',
      legendFontWeight: 300,
      catAxisLabelFontFace: 'Space Grotesk',
      catAxisLabelFontWeight: 500,
      valAxisLabelFontFace: 'Space Grotesk',
      valAxisLabelFontWeight: 500,
      dataLabelFontFace: 'Inter',
      dataLabelFontWeight: 600,
    });

    expect(chart.options.titleFont.fontFamily).toBe('Inter Light');
    expect(chart.options.legendFont.fontFamily).toBe('Inter Light');
    expect(chart.options.categoryAxis.labelFont.fontFamily).toBe(
      'Space Grotesk Medium'
    );
    expect(chart.options.valueAxis.labelFont.fontFamily).toBe(
      'Space Grotesk Medium'
    );
    expect(chart.options.dataLabelFont.fontFamily).toBe('Inter SemiBold');
    // The sub-family face carries the weight; the bold toggle must stay off or
    // PowerPoint synthesizes a faux-bold on top of it.
    expect(chart.options.titleFont.bold).toBe(false);
    expect(chart.options.categoryAxis.labelFont.bold).toBe(false);
    expect(chart.options.valueAxis.labelFont.bold).toBe(false);
    expect(chart.options.dataLabelFont.bold).toBe(false);

    expect(opts.titleFontFace).toBe('Inter Light');
    expect(opts.legendFontFace).toBe('Inter Light');
    expect(opts.catAxisLabelFontFace).toBe('Space Grotesk Medium');
    expect(opts.valAxisLabelFontFace).toBe('Space Grotesk Medium');
    expect(opts.dataLabelFontFace).toBe('Inter SemiBold');
    expect(opts.titleBold).toBe(false);
    expect(opts.catAxisLabelFontBold).toBe(false);
    expect(opts.valAxisLabelFontBold).toBe(false);
    expect(opts.dataLabelFontBold).toBe(false);
  });

  it('keeps the canonical family and uses the bold toggle at 400/700', async () => {
    const { chart, opts } = await compileChart(themed, {
      titleFontFace: 'Inter',
      titleFontWeight: 700,
      catAxisLabelFontFace: 'Inter',
      catAxisLabelFontWeight: 400,
    });

    expect(chart.options.titleFont).toMatchObject({
      fontFamily: 'Inter',
      bold: true,
    });
    expect(chart.options.categoryAxis.labelFont).toMatchObject({
      fontFamily: 'Inter',
      bold: false,
    });

    expect(opts.titleFontFace).toBe('Inter');
    expect(opts.titleBold).toBe(true);
    expect(opts.catAxisLabelFontFace).toBe('Inter');
    expect(opts.catAxisLabelFontBold).toBe(false);
  });

  it('falls back to the theme body font when only a weight is given', async () => {
    const { chart, opts } = await compileChart(themed, {
      dataLabelFontWeight: 300,
    });

    expect(chart.options.dataLabelFont.fontFamily).toBe('Inter Light');
    expect(opts.dataLabelFontFace).toBe('Inter Light');
  });

  it('lets the weight win over dataLabelFontBold', async () => {
    const { chart, opts } = await compileChart(themed, {
      dataLabelFontFace: 'Inter',
      dataLabelFontBold: true,
      dataLabelFontWeight: 300,
    });

    expect(chart.options.dataLabelFont).toMatchObject({
      fontFamily: 'Inter Light',
      bold: false,
    });

    expect(opts.dataLabelFontFace).toBe('Inter Light');
    expect(opts.dataLabelFontBold).toBe(false);
  });

  it('leaves dataLabelFontBold alone when no weight accompanies it', async () => {
    const { chart, opts } = await compileChart(themed, {
      dataLabelFontFace: 'Inter',
      dataLabelFontBold: true,
    });

    expect(chart.options.dataLabelFont).toMatchObject({
      fontFamily: 'Inter',
      bold: true,
    });

    expect(opts.dataLabelFontFace).toBe('Inter');
    expect(opts.dataLabelFontBold).toBe(true);
  });

  it('warns that a bold legend weight is dropped', async () => {
    // pptxgenjs writes no `b=` for the legend, so 700 has nowhere to land and
    // the legend renders Regular. Every other slot has a bold companion.
    const { chart, opts, warnings } = await compileChart(themed, {
      legendFontFace: 'Inter',
      legendFontWeight: 700,
    });

    expect(chart.options.legendFont.fontFamily).toBe('Inter');
    expect(chart.options.legendFont.bold).toBeUndefined();
    expect(opts.legendFontFace).toBe('Inter');
    expect(warnings).toEqual([
      {
        code: 'CHART_FONT_WEIGHT_DROPPED',
        component: 'chart',
        message: expect.stringContaining('legendFontFace'),
      },
    ]);
  });

  it('passes a face through untouched when no weight accompanies it', async () => {
    const { chart, opts, warnings } = await compileChart(themed, {
      legendFontFace: 'Inter',
    });

    expect(chart.options.legendFont.fontFamily).toBe('Inter');
    expect(chart.options.titleFont.fontFamily).toBeUndefined();
    expect(chart.options.dataLabelFont.fontFamily).toBeUndefined();
    expect(chart.options.titleFont.bold).toBeUndefined();

    expect(opts.legendFontFace).toBe('Inter');
    expect(opts.titleFontFace).toBeUndefined();
    expect(opts.dataLabelFontFace).toBeUndefined();
    expect(opts.titleBold).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe('chart type mapping', () => {
  const types: readonly PptxIrChartType[] = [
    'area',
    'bar',
    'bar3D',
    'bubble',
    'doughnut',
    'line',
    'pie',
    'radar',
    'scatter',
  ];

  it('carries every supported type onto the IR and into addChart', async () => {
    for (const type of types) {
      const {
        chart,
        type: emitted,
        warnings,
      } = await compileChart(baseColors, {
        type,
      });

      expect(chart.chartType).toBe(type);
      expect(emitted).toBe(type);
      expect(warnings).toEqual([]);
    }
  });

  it('records the charts feature requirement with the element path', async () => {
    const { required } = await compile(baseColors);

    expect(required).toContainEqual({
      feature: 'charts',
      path: 'slides[0].elements[0]',
    });
  });

  it('drops the chart and warns on an unknown type', async () => {
    // Schema-invalid on purpose: the compiler must not depend on the
    // validator having run.
    const { ir, warnings } = await compile(
      baseColors,
      { type: 'donut' },
      { validation: { enabled: false } }
    );
    assertValidPptxIr(ir);

    expect(ir.slides[0].elements).toEqual([]);
    expect(warnings).toEqual([
      {
        code: 'UNKNOWN_CHART_TYPE',
        component: 'chart',
        message: 'Unknown chart type: donut',
      },
    ]);
  });
});

describe('chart data validation', () => {
  it('carries series names, labels, values and bubble sizes through', async () => {
    const { chart, data } = await compileChart(baseColors, {
      type: 'bubble',
      data: [
        { name: 'Alpha', labels: ['a', 'b'], values: [1, 2], sizes: [3, 4] },
        { labels: ['a', 'b'], values: [5, 6] },
      ],
    });

    expect(chart.series).toEqual([
      { name: 'Alpha', labels: ['a', 'b'], values: [1, 2], sizes: [3, 4] },
      { labels: ['a', 'b'], values: [5, 6] },
    ]);
    expect(data).toEqual([
      { name: 'Alpha', labels: ['a', 'b'], values: [1, 2], sizes: [3, 4] },
      { labels: ['a', 'b'], values: [5, 6] },
    ]);
  });

  it('drops the chart and warns when there are no data series', async () => {
    const { ir, warnings } = await compile(
      baseColors,
      { data: [] },
      { validation: { enabled: false } }
    );
    assertValidPptxIr(ir);

    expect(ir.slides[0].elements).toEqual([]);
    expect(warnings).toEqual([
      {
        code: 'CHART_NO_DATA',
        component: 'chart',
        message: 'Chart component has no data series',
      },
    ]);
  });

  it('drops the chart and warns when a named series has no values', async () => {
    const { ir, warnings } = await compile(baseColors, {
      data: [{ name: 'S', labels: ['a', 'b'] }],
    });
    assertValidPptxIr(ir);

    expect(ir.slides[0].elements).toEqual([]);
    expect(warnings).toEqual([
      {
        code: 'CHART_INVALID_SERIES',
        component: 'chart',
        message: 'Chart series "S" missing labels or values',
      },
    ]);
  });

  it('names an unnamed invalid series "(unnamed)"', async () => {
    const { ir, warnings } = await compile(baseColors, {
      data: [{ values: [1, 2] }],
    });
    assertValidPptxIr(ir);

    expect(ir.slides[0].elements).toEqual([]);
    expect(warnings).toEqual([
      {
        code: 'CHART_INVALID_SERIES',
        component: 'chart',
        message: 'Chart series "(unnamed)" missing labels or values',
      },
    ]);
  });

  it('warns but still compiles a multi-series pie chart', async () => {
    // PowerPoint renders only the first series; the chart is kept so the deck
    // still shows something rather than a hole.
    const { chart, warnings } = await compileChart(baseColors, {
      type: 'pie',
      data: [
        { name: 'A', labels: ['a', 'b'], values: [1, 2] },
        { name: 'B', labels: ['a', 'b'], values: [3, 4] },
      ],
    });

    expect(chart.series).toHaveLength(2);
    expect(warnings).toEqual([
      {
        code: 'CHART_MULTI_SERIES',
        component: 'chart',
        message: 'pie chart has 2 series — only the first will render',
      },
    ]);
  });
});

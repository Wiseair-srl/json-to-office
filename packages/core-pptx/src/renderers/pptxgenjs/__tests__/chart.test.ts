import type PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../../core/generateFromIr';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../../types';
import type { PptxIrChartElement, PptxIrChartType } from '../../../ir/types';
import { emitChart } from '../chart';

const theme: PptxThemeConfig = {
  name: 'chart-test',
  colors: {
    primary: '#0066cc',
    secondary: '#6c757d',
    accent: '#17a2b8',
    text: '#000000',
    background: '#FFFFFF',
  },
  fonts: { heading: 'Geist', body: 'Inter' },
  defaults: { fontSize: 18, fontColor: '#000000' },
};

async function emitted(props: Record<string, unknown> = {}) {
  const document = {
    name: 'pptx',
    props: { theme },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'chart',
            props: {
              type: 'bar',
              data: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
              ...props,
            },
          },
        ],
      },
    ],
  } as PresentationComponentDefinition;
  const { ir } = await compileDocumentToIr(document);
  const chart = ir.slides[0].elements[0] as PptxIrChartElement;
  const calls: unknown[][] = [];
  emitChart(
    {
      addChart: (...args: unknown[]) => calls.push(args),
    } as unknown as PptxGenJS.Slide,
    chart
  );
  const [type, data, options] = calls[0];
  return {
    type: type as string,
    data: data as Array<Record<string, unknown>>,
    options: options as Record<string, unknown>,
  };
}

describe('PptxGenJS chart adapter', () => {
  it('maps palette, styling, axes and fonts', async () => {
    const { options } = await emitted({
      chartColors: ['primary', 'accent'],
      dataBorder: { pt: 0.75, color: 'primary' },
      valGridLine: { style: 'dash', size: 0.5, color: 'accent' },
      catAxisTitle: 'Quarter',
      catAxisHidden: false,
      catAxisLabelRotate: -45,
      valAxisTitle: 'Revenue',
      valAxisMinVal: 0,
      valAxisMaxVal: 100,
      valAxisMajorUnit: 25,
      valAxisLabelFormatCode: '$0.00',
      titleFontFace: 'Inter',
      titleFontWeight: 300,
      dataLabelFontFace: 'Inter',
      dataLabelFontWeight: 700,
    });
    expect(options).toMatchObject({
      chartColors: ['0066CC', '17A2B8'],
      dataBorder: { pt: 0.75, color: '0066CC' },
      valGridLine: { style: 'dash', size: 0.5, color: '17A2B8' },
      catAxisTitle: 'Quarter',
      showCatAxisTitle: true,
      catAxisHidden: false,
      catAxisLabelRotate: -45,
      valAxisTitle: 'Revenue',
      showValAxisTitle: true,
      valAxisMinVal: 0,
      valAxisMaxVal: 100,
      valAxisMajorUnit: 25,
      valAxisLabelFormatCode: '$0.00',
      titleFontFace: 'Inter Light',
      titleBold: false,
      dataLabelFontFace: 'Inter',
      dataLabelFontBold: true,
    });
  });

  it('passes every chart type and series data to addChart', async () => {
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
    for (const type of types) {
      const result = await emitted({ type });
      expect(result.type).toBe(type);
      expect(result.data).toEqual([
        { name: 'S', labels: ['a', 'b'], values: [1, 2] },
      ]);
    }
  });
});

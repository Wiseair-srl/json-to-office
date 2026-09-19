import JSZip from 'jszip';
import type PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
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

  it('sizes, faces and colours the axis titles from their tick labels', async () => {
    // pptxgenjs writes an axis title's `sz` only when handed one, so a title
    // left to it drew at PowerPoint's own large default.
    const { options } = await emitted({
      catAxisTitle: 'Quarter',
      valAxisTitle: 'Revenue',
      catAxisLabelFontSize: 11,
      valAxisLabelColor: 'accent',
    });
    expect(options).toMatchObject({
      catAxisTitleFontSize: 11,
      catAxisTitleFontFace: 'Inter',
      catAxisTitleColor: '000000',
      // No label size anywhere: the size pptxgenjs gives an unsized label.
      valAxisTitleFontSize: 12,
      valAxisTitleFontFace: 'Inter',
      valAxisTitleColor: '17A2B8',
    });
    expect(options).not.toHaveProperty('catAxisTitleRotate');
    expect(options).not.toHaveProperty('valAxisTitleRotate');
  });

  it('lets the author override an axis title font by its native name', async () => {
    const { options } = await emitted({
      catAxisTitle: 'Quarter',
      catAxisTitleFontSize: 9,
      catAxisTitleFontFace: 'Georgia',
      catAxisTitleColor: 'primary',
      valAxisTitle: 'Revenue',
      valAxisTitleRotate: -90,
    });
    expect(options).toMatchObject({
      catAxisTitleFontSize: 9,
      catAxisTitleFontFace: 'Georgia',
      catAxisTitleColor: '0066CC',
      valAxisTitleRotate: -90,
    });
  });

  it('passes no axis title font when there is no title', async () => {
    const { options } = await emitted({});
    expect(options).not.toHaveProperty('catAxisTitleFontSize');
    expect(options).not.toHaveProperty('valAxisTitleFontSize');
  });

  it('writes a sized, faced, coloured axis title into the chart part', async () => {
    const { buffer } = await generateBufferViaIr({
      name: 'pptx',
      props: { theme },
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'chart',
              props: {
                type: 'bar',
                data: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
                catAxisTitle: 'Quarter',
                valAxisTitle: 'Revenue',
                x: 1,
                y: 1,
                w: 6,
                h: 3,
              },
            },
          ],
        },
      ],
    } as PresentationComponentDefinition);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/charts/chart1.xml')!.async('string');
    for (const tag of ['catAx', 'valAx']) {
      const axis = xml.slice(
        xml.indexOf(`<c:${tag}>`),
        xml.indexOf(`</c:${tag}>`)
      );
      const title = axis.slice(
        axis.indexOf('<c:title>'),
        axis.indexOf('</c:title>')
      );
      expect(title, tag).toMatch(/<a:defRPr sz="1200" b="0"/);
      expect(title, tag).toContain('<a:srgbClr val="000000"/>');
      expect(title, tag).toContain('<a:latin typeface="Inter"/>');
    }
  });
});

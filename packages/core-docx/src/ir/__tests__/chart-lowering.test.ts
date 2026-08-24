/**
 * Lowering a `chart` component into DocxIR.
 *
 * The IR node is backend-neutral: it carries resolved series, resolved colours
 * and an EMU frame, never a backend's option vocabulary. What is tested here is
 * that the authoring surface's rules are enforced *at compile time* — a series
 * missing its data, a palette that has to come from the theme — so no backend
 * ever has to guess, and a backend without `charts` refuses the document rather
 * than dropping the graphic.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { ReportComponentDefinition } from '../../types';
import type { DocxIrChartRun, DocxIrParagraph } from '../types';

function documentWith(props: Record<string, unknown>) {
  return {
    name: 'docx',
    renderer: 'office-open',
    props: {},
    children: [{ name: 'section', children: [{ name: 'chart', props }] }],
  } as never;
}

const series = [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }];

async function chartFrom(props: Record<string, unknown>) {
  const compiled = await compileDocumentToIr(
    documentWith(props) as ReportComponentDefinition,
    { validation: { enabled: false } }
  );
  const run = compiled.ir.sections
    .flatMap((section) => section.children)
    .filter((block): block is DocxIrParagraph => block.kind === 'paragraph')
    .flatMap((paragraph) => paragraph.children)
    .find((child) => child.kind === 'chart');
  return { ir: compiled, chart: run as DocxIrChartRun | undefined };
}

describe('chart lowering', () => {
  it('lowers a chart component to a chart run', async () => {
    const { chart } = await chartFrom({ type: 'bar', data: series });
    expect(chart).toBeDefined();
    expect(chart!.chartType).toBe('bar');
    expect(chart!.series).toEqual([
      { name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] },
    ]);
  });

  it('requires the charts feature so a backend without it refuses', async () => {
    const { ir } = await chartFrom({ type: 'bar', data: series });
    expect(ir.required.map((r) => r.feature)).toContain('charts');
  });

  it('defaults the frame and honours an authored one', async () => {
    const { chart } = await chartFrom({ type: 'bar', data: series });
    expect(chart!.widthEmu).toBeGreaterThan(0);
    expect(chart!.heightEmu).toBeGreaterThan(0);

    const sized = await chartFrom({
      type: 'bar',
      data: series,
      width: 4,
      height: 2,
    });
    // 914400 EMU to the inch.
    expect(sized.chart!.widthEmu).toBe(4 * 914400);
    expect(sized.chart!.heightEmu).toBe(2 * 914400);
  });

  it('injects the theme palette when chartColors is unset', async () => {
    const { chart } = await chartFrom({ type: 'bar', data: series });
    expect(chart!.colors.length).toBeGreaterThan(0);
    for (const color of chart!.colors) {
      expect(color).toMatch(/^[0-9A-Fa-f]{6}$/);
    }
  });

  it('lets an explicit palette win, resolving semantic names', async () => {
    const { chart } = await chartFrom({
      type: 'bar',
      data: series,
      chartColors: ['#FF0000', 'primary'],
    });
    expect(chart!.colors[0]).toBe('FF0000');
    expect(chart!.colors[1]).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(chart!.colors).toHaveLength(2);
  });

  it('refuses a series missing its values, naming the series', async () => {
    await expect(
      chartFrom({ type: 'bar', data: [{ name: 'Broken', labels: ['Q1'] }] })
    ).rejects.toThrow(/Broken/);
  });

  it('refuses labels and values of different lengths', async () => {
    await expect(
      chartFrom({
        type: 'bar',
        data: [{ name: 'Ragged', labels: ['Q1', 'Q2'], values: [1] }],
      })
    ).rejects.toThrow(/Ragged/);
  });

  it('refuses series that disagree about the categories', async () => {
    await expect(
      chartFrom({
        type: 'bar',
        data: [
          { name: 'First', labels: ['Q1', 'Q2'], values: [1, 2] },
          { name: 'Second', labels: ['Q1', 'Q3'], values: [3, 4] },
        ],
      })
    ).rejects.toThrow(/Second[\s\S]*category axis|category axis/);
  });

  it('carries the title, legend and alt text through', async () => {
    const { chart } = await chartFrom({
      type: 'line',
      data: series,
      title: 'Quarterly revenue',
      showLegend: true,
      legendPos: 'b',
      alt: 'A line chart',
    });
    expect(chart!.title).toBe('Quarterly revenue');
    expect(chart!.showLegend).toBe(true);
    expect(chart!.legendPosition).toBe('b');
    expect(chart!.altText).toBe('A line chart');
  });
});

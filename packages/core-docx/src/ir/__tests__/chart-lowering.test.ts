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
import type { GenerationWarning } from '@json-to-office/shared';

function documentWith(
  props: Record<string, unknown>,
  rootProps: Record<string, unknown> = {}
) {
  return {
    name: 'docx',
    renderer: 'office-open',
    props: rootProps,
    children: [{ name: 'section', children: [{ name: 'chart', props }] }],
  } as never;
}

const series = [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }];

async function chartFrom(
  props: Record<string, unknown>,
  rootProps: Record<string, unknown> = {}
) {
  const compiled = await compileDocumentToIr(
    documentWith(props, rootProps) as ReportComponentDefinition,
    { validation: { enabled: false }, warnings: [] }
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

  it('resolves the chart text font from the theme, capped at 10pt', async () => {
    const { chart } = await chartFrom({ type: 'bar', data: series });
    expect(chart!.textFont.fontFamily).toMatch(/\S/);
    expect(chart!.textFont.fontSize).toBeGreaterThan(0);
    expect(chart!.textFont.fontSize).toBeLessThanOrEqual(10);
    expect(chart!.textFont.bold).toBe(false);
    expect(chart!.textFont.color).toMatch(/^[0-9A-F]{6}$/);
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

  it('refuses a bubble chart, which has no bubble sizes to draw', async () => {
    // A bubble needs a size for every point, and a series here is labels and
    // values. The schema drops the type too — this is the guard for a caller
    // that skipped validation.
    await expect(chartFrom({ type: 'bubble', data: series })).rejects.toThrow(
      /bubble[\s\S]*no bubble sizes/
    );
  });

  it('refuses a pie with more than one series', async () => {
    await expect(
      chartFrom({
        type: 'pie',
        data: [
          { name: 'This year', labels: ['A', 'B'], values: [1, 2] },
          { name: 'Last year', labels: ['A', 'B'], values: [2, 1] },
        ],
      })
    ).rejects.toThrow(/sections\[0\]\.children\[0\][\s\S]*pie with 2 series/);
  });

  it.each(['pie', 'doughnut'])(
    'refuses a negative value in a %s, naming the series',
    async (type) => {
      await expect(
        chartFrom({
          type,
          data: [{ name: 'Swing', labels: ['A', 'B'], values: [3, -1] }],
        })
      ).rejects.toThrow(/"Swing"[\s\S]*negative value \(-1 at "B"\)/);
    }
  );

  it('refuses a series with no data points', async () => {
    await expect(
      chartFrom({
        type: 'bar',
        data: [{ name: 'Empty', labels: [], values: [] }],
      })
    ).rejects.toThrow(/"Empty"[\s\S]*no data points/);
  });

  it('refuses a value that is not a finite number', async () => {
    await expect(
      chartFrom({
        type: 'bar',
        data: [{ name: 'Typo', labels: ['Q1'], values: ['x'] }],
      })
    ).rejects.toThrow(/"Typo"[\s\S]*not a finite number \("x" at "Q1"\)/);
  });

  it('refuses a chart with no room to draw in', async () => {
    await expect(
      chartFrom({ type: 'bar', data: series, width: 1e-9 })
    ).rejects.toThrow(
      /sections\[0\]\.children\[0\] has no room: it would be 0×3 in/
    );
  });

  it('warns once that a scatter chart places text labels in order', async () => {
    const warnings: GenerationWarning[] = [];
    await compileDocumentToIr(
      documentWith({
        type: 'scatter',
        data: [
          { name: 'A', labels: ['Jan', 'Feb', '3'], values: [1, 2, 3] },
          { name: 'B', labels: ['Jan', 'Feb', '3'], values: [3, 2, 1] },
        ],
      }) as ReportComponentDefinition,
      { validation: { enabled: false } },
      warnings
    );
    const placed = warnings.filter((warning) =>
      /scatter chart whose labels are not all finite numbers/.test(
        warning.message
      )
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].component).toBe('chart');
  });

  it('says nothing about a scatter chart whose labels are numbers', async () => {
    const warnings: GenerationWarning[] = [];
    await compileDocumentToIr(
      documentWith({
        type: 'scatter',
        data: [{ name: 'A', labels: ['1', '2.5', '-4e1'], values: [1, 2, 3] }],
      }) as ReportComponentDefinition,
      { validation: { enabled: false } },
      warnings
    );
    expect(warnings.filter((w) => w.component === 'chart')).toEqual([]);
  });

  it.each(['pie', 'doughnut'])(
    'warns that a %s draws no axis titles, and keeps them in the IR',
    async (type) => {
      const warnings: GenerationWarning[] = [];
      const compiled = await compileDocumentToIr(
        documentWith({
          type,
          data: series,
          catAxisTitle: 'Quarter',
        }) as ReportComponentDefinition,
        { validation: { enabled: false } },
        warnings
      );
      expect(
        warnings.filter((warning) =>
          /has no axes; its axis titles are not drawn/.test(warning.message)
        )
      ).toHaveLength(1);
      // Office-open's part is unchanged; docx.js leaves them out.
      const run = compiled.ir.sections[0].children
        .filter((block): block is DocxIrParagraph => block.kind === 'paragraph')
        .flatMap((paragraph) => paragraph.children)
        .find((child): child is DocxIrChartRun => child.kind === 'chart');
      expect(run!.categoryAxisTitle).toBe('Quarter');
    }
  );

  it('floors the chart text size at 1pt', async () => {
    const { chart } = await chartFrom(
      { type: 'bar', data: series },
      { themeOverrides: { fonts: { body: { size: 0.5 } } } }
    );
    expect(chart!.textFont.fontSize).toBe(1);
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

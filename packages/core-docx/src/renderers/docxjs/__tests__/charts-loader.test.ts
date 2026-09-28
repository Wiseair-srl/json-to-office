/**
 * `docx/charts` is loaded at render time, and a docx without it fails only a
 * document that draws a chart.
 *
 * `docx` is a peer dependency and the entry exists from 9.8.0 on. Each test
 * imports a fresh copy of the renderer's chart module, since the load is kept
 * per process.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocxIrChartRun } from '../../../ir/types';

const CHART: DocxIrChartRun = {
  kind: 'chart',
  chartType: 'column',
  series: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }],
  colors: [],
  widthEmu: 5486400,
  heightEmu: 2743200,
  textFont: {
    fontFamily: 'Carlito',
    fontSize: 10,
    bold: false,
    color: '000000',
  },
};

describe('the docx/charts loader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('docx/charts');
  });

  it('says to load it first when a chart is emitted before any load', async () => {
    const { emitChart } = await import('../charts');
    expect(() => emitChart(CHART)).toThrow(/not loaded/);
  });

  it('draws a chart once loaded', async () => {
    const { emitChart, loadDocxCharts } = await import('../charts');
    await loadDocxCharts();
    expect(emitChart(CHART)).toBeTruthy();
  });

  it('names the docx it needs when the entry is missing, and only then', async () => {
    vi.doMock('docx/charts', () => {
      throw new Error('Package subpath ./charts is not defined by "exports"');
    });
    const { emitChart, loadDocxCharts } = await import('../charts');

    // The load itself never fails: a document without a chart still renders.
    await expect(loadDocxCharts()).resolves.toBeUndefined();
    expect(() => emitChart(CHART)).toThrow(/docx 9\.8\.0/);
  });
});

/**
 * Native chart parity between the legacy pipeline and the IR pipeline.
 *
 * Charts carry the widest option surface in the deck and produce an embedded
 * workbook alongside the chart part, so these compare the whole package rather
 * than a single slide.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../../../core/generator';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

async function entries(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<string, string>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out.set(
      path,
      path.endsWith('.xml') || path.endsWith('.rels')
        ? await entry.async('string')
        : `sha256:${createHash('sha256')
            .update(await entry.async('nodebuffer'))
            .digest('hex')}`
    );
  }
  return out;
}

async function expectSamePackage(
  document: PresentationComponentDefinition
): Promise<void> {
  const legacy = (await generateBufferFromJson(
    structuredClone(document) as never
  )) as Buffer;
  const { buffer: ir } = await generateBufferViaIr(
    structuredClone(document) as never
  );

  const legacyEntries = await entries(legacy);
  const irEntries = await entries(ir);

  expect([...irEntries.keys()].sort()).toEqual(
    [...legacyEntries.keys()].sort()
  );
  for (const [path, legacyValue] of legacyEntries) {
    expect({ path, xml: irEntries.get(path) }).toEqual({
      path,
      xml: legacyValue,
    });
  }
}

const chart = (props: Record<string, unknown>): unknown => ({
  name: 'chart',
  props: { x: 0.5, y: 0.5, w: 6, h: 4, ...props },
});

const deck = (children: unknown[]): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Charts' },
    children: [{ name: 'slide', props: {}, children }],
  }) as PresentationComponentDefinition;

const SERIES = [
  { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 15] },
];
const TWO_SERIES = [
  ...SERIES,
  { name: 'Cost', labels: ['Q1', 'Q2', 'Q3'], values: [5, 9, 7] },
];

describe('chart parity', () => {
  it('matches for a bar chart with the implicit theme palette', async () => {
    await expectSamePackage(deck([chart({ type: 'bar', data: SERIES })]));
  });

  it('matches for each supported chart type', async () => {
    for (const type of [
      'area',
      'bar',
      'bar3D',
      'line',
      'pie',
      'doughnut',
      'radar',
    ]) {
      await expectSamePackage(deck([chart({ type, data: SERIES })]));
    }
    // Seven full package builds, compared byte for byte, in one body.
  }, 30_000);

  it('matches for multiple series', async () => {
    await expectSamePackage(deck([chart({ type: 'line', data: TWO_SERIES })]));
  });

  it('matches for an explicit colour palette', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: TWO_SERIES,
          chartColors: ['primary', 'accent', 'FF00FF'],
        }),
      ])
    );
  });

  it('matches for title, legend and label toggles', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: SERIES,
          showTitle: true,
          title: 'Quarterly',
          titleFontSize: 18,
          titleColor: 'primary',
          showLegend: true,
          legendPos: 'b',
          legendFontSize: 11,
          showValue: true,
          showLabel: true,
          showPercent: false,
          showSerName: false,
        }),
      ])
    );
  });

  it('matches for axis configuration', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: SERIES,
          catAxisTitle: 'Quarter',
          catAxisLabelRotate: 45,
          catAxisLabelFontSize: 9,
          catAxisLineShow: false,
          catGridLine: { style: 'dash', size: 1, color: 'EEEEEE' },
          valAxisTitle: 'Amount',
          valAxisMinVal: 0,
          valAxisMaxVal: 30,
          valAxisMajorUnit: 5,
          valAxisLabelFormatCode: '#,##0',
          valAxisLabelFontSize: 9,
          valGridLine: { style: 'solid', size: 1, color: 'DDDDDD' },
        }),
      ])
    );
  });

  it('matches for a hidden axis', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: SERIES,
          catAxisHidden: true,
          valAxisHidden: true,
        }),
      ])
    );
  });

  it('matches for bar-specific options', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: TWO_SERIES,
          barDir: 'col',
          barGrouping: 'stacked',
          barGapWidthPct: 40,
          barOverlapPct: 100,
        }),
      ])
    );
  });

  it('matches for line-specific options', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'line',
          data: SERIES,
          lineSmooth: true,
          lineDataSymbol: 'circle',
          lineSize: 3,
          lineDataSymbolSize: 8,
        }),
      ])
    );
  });

  it('matches for doughnut hole and first slice angle', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'doughnut',
          data: SERIES,
          holeSize: 60,
          firstSliceAng: 90,
        }),
      ])
    );
  });

  it('matches for a data border and data labels', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: SERIES,
          dataBorder: { pt: 1, color: 'primary' },
          showValue: true,
          dataLabelColor: 'text',
          dataLabelFontSize: 10,
          dataLabelPosition: 'outEnd',
          dataLabelFontBold: true,
        }),
      ])
    );
  });

  it('matches for a non-RIBBI weight on chart labels', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: SERIES,
          showTitle: true,
          title: 'Weighted',
          titleFontFace: 'Inter',
          titleFontWeight: 300,
          catAxisLabelFontFace: 'Inter',
          catAxisLabelFontWeight: 600,
          dataLabelFontFace: 'Inter',
          dataLabelFontWeight: 700,
        }),
      ])
    );
  });

  it('matches when a bold weight is dropped on the legend', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bar',
          data: SERIES,
          showLegend: true,
          legendFontFace: 'Arial',
          legendFontWeight: 700,
        }),
      ])
    );
  });

  it('matches for a pie chart given more series than it can show', async () => {
    await expectSamePackage(deck([chart({ type: 'pie', data: TWO_SERIES })]));
  });

  it('matches for two charts on one slide', async () => {
    await expectSamePackage(
      deck([
        chart({ type: 'bar', data: SERIES, x: 0.5, y: 0.5, w: 4, h: 3 }),
        chart({ type: 'line', data: SERIES, x: 5, y: 0.5, w: 4, h: 3 }),
      ])
    );
  });

  it('matches for a bubble chart with sizes', async () => {
    await expectSamePackage(
      deck([
        chart({
          type: 'bubble',
          data: [
            {
              name: 'Sizes',
              labels: ['a', 'b', 'c'],
              values: [1, 2, 3],
              sizes: [4, 5, 6],
            },
          ],
        }),
      ])
    );
  });
});

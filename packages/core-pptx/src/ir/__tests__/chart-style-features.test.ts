/**
 * What a chart's styling demands of a backend.
 *
 * `charts` says a backend can draw a chart from data. It says nothing about
 * whether that backend honours the options the chart was styled with, and one
 * coarse feature let the office-open renderer accept a chart, draw it, and
 * ignore half of what was asked for — an ignored `valAxisMaxVal` draws a
 * different chart from the authored one, with nothing in the file to say so.
 *
 * These tests pin the first half of the fix: the compiler records one
 * requirement per *authored* styling prop, at that prop's own path. The second
 * half — actually emitting them — moves each capability into the office-open
 * adapter's declared set one at a time, and each move flips that capability's
 * case in `chart-parts.test.ts` from refused to rendered.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { generateBufferViaIr } from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';
import { PPTX_FEATURES } from '../features';
import { createOfficeOpenPptxRenderer } from '../../renderers/office-open';

const deck = (chartProps: Record<string, unknown> = {}) =>
  ({
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        children: [
          {
            name: 'chart',
            props: {
              type: 'bar',
              data: [{ name: 'S', labels: ['a', 'b'], values: [1, 2] }],
              x: 1,
              y: 1,
              w: 4,
              h: 3,
              ...chartProps,
            },
          },
        ],
      },
    ],
  }) as unknown as PresentationComponentDefinition;

async function requirementsOf(
  chartProps: Record<string, unknown> = {}
): Promise<Array<{ feature: string; path: string }>> {
  const compiled = await compileDocumentToIr(deck(chartProps), {
    validation: { enabled: false },
  });
  return compiled.required.map(({ feature, path }) => ({ feature, path }));
}

/** Every styling prop, and the capability it demands. */
const PROP_FEATURES: ReadonlyArray<[string, unknown, string]> = [
  ['showValue', true, 'chart-data-labels'],
  ['showPercent', true, 'chart-data-labels'],
  ['showLabel', true, 'chart-data-labels'],
  ['showSerName', true, 'chart-data-labels'],
  ['dataLabelPosition', 'ctr', 'chart-data-labels'],
  ['dataBorder', { pt: 1, color: '000000' }, 'chart-data-border'],
  ['catAxisHidden', true, 'chart-axis-visibility'],
  ['valAxisHidden', true, 'chart-axis-visibility'],
  ['catAxisLineShow', false, 'chart-axis-visibility'],
  ['valAxisLineShow', false, 'chart-axis-visibility'],
  ['catAxisLabelRotate', 45, 'chart-axis-style'],
  ['catGridLine', { style: 'solid' }, 'chart-axis-style'],
  ['valGridLine', { style: 'dash' }, 'chart-axis-style'],
  ['valAxisMinVal', 0, 'chart-axis-scale'],
  ['valAxisMaxVal', 99, 'chart-axis-scale'],
  ['valAxisMajorUnit', 10, 'chart-axis-scale'],
  ['valAxisLabelFormatCode', '#,##0', 'chart-axis-scale'],
  ['barGapWidthPct', 20, 'chart-bar-style'],
  ['barOverlapPct', -10, 'chart-bar-style'],
  ['firstSliceAng', 90, 'chart-pie-style'],
  ['holeSize', 70, 'chart-pie-style'],
  ['lineSmooth', true, 'chart-line-style'],
  ['lineDataSymbol', 'circle', 'chart-line-style'],
  ['lineSize', 3, 'chart-line-style'],
  ['lineDataSymbolSize', 8, 'chart-line-style'],
  ['radarStyle', 'marker', 'chart-radar-style'],
  ['titleFontSize', 20, 'chart-text-style'],
  ['titleColor', 'FF0000', 'chart-text-style'],
  ['titleFontFace', 'Inter', 'chart-text-style'],
  ['legendFontSize', 10, 'chart-text-style'],
  ['legendColor', '333333', 'chart-text-style'],
  ['catAxisLabelFontSize', 9, 'chart-text-style'],
  ['valAxisLabelColor', '666666', 'chart-text-style'],
  ['dataLabelFontSize', 8, 'chart-text-style'],
];

describe('chart styling requirements', () => {
  it('demands nothing extra of a chart that styles nothing', async () => {
    const features = (await requirementsOf()).map((r) => r.feature);
    expect(features).toContain('charts');
    expect(features.filter((f) => f.startsWith('chart-'))).toEqual([]);
  });

  it.each(PROP_FEATURES)('requires %s -> %s', async (prop, value, feature) => {
    const required = await requirementsOf({ [prop as string]: value });
    const match = required.find((r) => r.feature === feature);
    expect(match, `${prop} did not require ${feature}`).toBeDefined();
    // The path names the prop, not just the chart: a refusal has to point at
    // the line the author has to change.
    expect(match!.path).toBe(`slides[0].elements[0].${prop}`);
  });

  it('treats an explicit false as authored', async () => {
    // An author who turns a data label off means it; a backend that ignores
    // the instruction draws a label they asked not to see.
    const required = await requirementsOf({ showValue: false });
    expect(required.map((r) => r.feature)).toContain('chart-data-labels');
  });

  it('does not demand a text capability for a compiler font default', async () => {
    // `compileChartLabelFont` falls back to the theme body font when a weight
    // is authored without a face, so the compiled font object holds a family
    // the author never wrote. Keying off the authored props keeps that from
    // demanding `chart-text-style` of a chart that only styled its weight...
    const weighted = await requirementsOf({ titleFontWeight: 700 });
    expect(weighted.map((r) => r.feature)).toContain('chart-text-style');

    // ...and keeps a chart that styled nothing free of the requirement, even
    // though its IR still carries resolved font objects.
    const plain = await requirementsOf({ title: 'Just a title' });
    expect(plain.map((r) => r.feature)).not.toContain('chart-text-style');
  });

  it('names every chart capability in the feature vocabulary', () => {
    const declared = PPTX_FEATURES.filter((f) => f.startsWith('chart-'));
    expect(declared.sort()).toEqual(
      [
        'chart-axis-scale',
        'chart-axis-style',
        'chart-axis-visibility',
        'chart-bar-style',
        'chart-data-border',
        'chart-data-labels',
        'chart-line-style',
        'chart-pie-style',
        'chart-radar-style',
        'chart-text-style',
      ].sort()
    );
  });
});

describe('chart styling across the two renderers', () => {
  it('renders a styled chart on pptxgenjs, which honours all of it', async () => {
    const { buffer } = await generateBufferViaIr(
      deck({ showValue: true, valAxisMaxVal: 99, holeSize: 70 }),
      { renderer: 'pptxgenjs' }
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  it.each([
    ['chart-data-labels', { showValue: true }],
    ['chart-data-border', { dataBorder: { pt: 1, color: '000000' } }],
    ['chart-axis-scale', { valAxisMaxVal: 99 }],
    ['chart-axis-visibility', { catAxisHidden: true }],
    ['chart-axis-style', { valGridLine: { style: 'dash' } }],
    ['chart-bar-style', { barGapWidthPct: 20 }],
    ['chart-line-style', { lineSmooth: true }],
    ['chart-pie-style', { holeSize: 70 }],
    ['chart-radar-style', { radarStyle: 'marker' }],
    ['chart-text-style', { titleFontSize: 20 }],
  ] as ReadonlyArray<[string, Record<string, unknown>]>)(
    'office-open renders %s when it declares it, and refuses it otherwise',
    async (feature, props) => {
      // Derived from the adapter's own capability set rather than hardcoded, so
      // implementing a capability flips this case without anyone remembering
      // to edit it — and forgetting to declare one shows up as a refusal.
      const renderer = await createOfficeOpenPptxRenderer();
      const declared = renderer.capabilities.has(feature as never);

      let caught: unknown;
      try {
        await generateBufferViaIr(deck(props), { renderer: 'office-open' });
      } catch (error) {
        caught = error;
      }

      if (declared) {
        expect(caught, `${feature} is declared but the render failed`).toBe(
          undefined
        );
        return;
      }

      const error = caught as Error & { features?: string[] };
      expect(error, `${feature} is not declared but rendered`).toBeDefined();
      expect(error.features).toContain(feature);
    }
  );

  it('names the prop, not just the chart, when it refuses', async () => {
    // `titleFontSize` rather than an axis prop: the axis capabilities are
    // implemented now, so a refusal has to be asked of one that is not.
    let caught: unknown;
    try {
      await generateBufferViaIr(deck({ titleFontSize: 20 }), {
        renderer: 'office-open',
      });
    } catch (error) {
      caught = error;
    }
    const error = caught as Error & { paths?: string[] };
    expect(error.paths).toContain('slides[0].elements[0].titleFontSize');
  });

  it('still renders an unstyled chart on office-open', async () => {
    // The gate has to be about styling, not about charts: the native-chart
    // support this builds on must keep working untouched.
    const { buffer } = await generateBufferViaIr(deck({ title: 'Fine' }), {
      renderer: 'office-open',
    });
    expect(buffer.length).toBeGreaterThan(0);
  });
});

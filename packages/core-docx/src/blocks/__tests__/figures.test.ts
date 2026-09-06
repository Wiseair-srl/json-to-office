/**
 * The report's figures from the playground template: `chart-figure`,
 * `figure` and `footnotes`. A chart is drawn by an export server, so the
 * fetch here is a stub that records the request and returns a pixel; what
 * the tests pin is everything around it — the numbering, the sources, the
 * theme reaching the request, and a missing server failing the document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { validateDocument } from '@json-to-office/shared-docx';
import { QUALITY_CODES } from '@json-to-office/quality';
import { generateBufferWithWarnings } from '../../core/generator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { resolveDocxDesignSystem } from '../../themes/design-system';
import {
  consultingTheme,
  minimalTheme,
  vermilionTheme,
  devportalTheme,
} from '../../styles';

vi.mock('../../utils/environment', () => ({
  isNodeEnvironment: vi.fn().mockReturnValue(true),
  isBrowserEnvironment: vi.fn().mockReturnValue(false),
}));

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(PNG_B64),
  });
});

import { EXAMPLE, invocation } from './example';
/** The template's figure, with its image inline so nothing reads the disk. */
const figure = (caption = 'The delivery model') => {
  const block = invocation('figure');
  block.props.slots.image = {
    name: 'image',
    props: { base64: `data:image/png;base64,${PNG_B64}`, width: '50%' },
  };
  block.props.slots.caption = caption;
  return block;
};
const chartFigure = (caption: string, source?: string) => {
  const block = invocation('chart-figure');
  block.props.slots.caption = caption;
  if (source !== undefined) block.props.slots.source = source;
  return block;
};
const on = (theme: string, ...blocks: unknown[]) => ({
  ...structuredClone(EXAMPLE),
  props: { ...structuredClone(EXAMPLE.props), theme },
  children: [{ name: 'section', children: blocks }],
});
const lastRequest = () =>
  JSON.parse((mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body as string);
async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}
const text = (xml: string) => xml.replace(/<[^>]+>/g, '|');

describe('figures from the playground template', () => {
  it('requires a source under a chart, as a coded issue at the slot', () => {
    const doc = on('consulting', chartFigure('Revenue by quarter'));
    delete doc.children[0].children[0].props.slots.source;
    expect(validateDocument(doc).errors).toEqual([
      expect.objectContaining({
        code: 'block_required_slot',
        path: '/children/0/children/0/props/slots/source',
      }),
    ]);
  });

  it('hands the theme palette and typography to the export server', async () => {
    await generateBufferWithWarnings(
      on('consulting', chartFigure('Revenue by quarter'))
    );
    const { infile } = lastRequest();
    const design = resolveDocxDesignSystem(consultingTheme);
    expect(infile.colors[0]).toBe(`#${design.colors.accent.replace('#', '')}`);
    expect(infile.colors).toHaveLength(design.palette!.chart!.length);
    expect(infile.chart.style.fontFamily).toContain('Calibri');
    expect(infile.yAxis.title.text).toBe('Revenue (€m)');
  });

  it('fails the document when the export server is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      generateBufferWithWarnings(on('consulting', chartFigure('Revenue')))
    ).rejects.toThrow(/not running.*enableServer/s);
  });

  it('draws a native chart with no service on the office-open renderer', async () => {
    const block = chartFigure('Revenue by quarter');
    block.props.slots.chart = {
      name: 'chart',
      props: {
        type: 'column',
        valAxisTitle: 'Revenue (€m)',
        data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [1.9, 2.4] }],
      },
    };
    const doc = { ...on('consulting', block), renderer: 'office-open' };
    const { buffer, warnings } = await generateBufferWithWarnings(doc);
    expect(warnings).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await documentXml(buffer as Buffer)).toContain('Figure ');
  });

  it('offers the palette patch for a chart placed through a slot, never for one a definition draws', () => {
    const native = {
      name: 'chart',
      props: {
        type: 'column',
        valAxisTitle: 'Revenue (€m)',
        data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [1.9, 2.4] }],
      },
    };
    const colours = (doc: any) =>
      analyzeDocxQuality({
        ...doc,
        renderer: 'office-open',
      }).diagnostics.filter(
        (d) => d.code === QUALITY_CODES.CHART_SERIES_COLORS
      );
    const slotted = chartFigure('Revenue');
    slotted.props.slots.chart = native;
    const [viaSlot] = colours(on('consulting', slotted));
    expect(viaSlot.fixes?.[0].path).toBe(
      '/children/0/children/0/props/slots/chart/props/chartColors'
    );
    const doc = on('consulting', { name: 'block', props: { ref: 'drawn' } });
    doc.props.blocks.drawn = { slots: {}, body: [native] };
    const [drawn] = colours(doc);
    expect(drawn.path).toMatch(/^\/children\/0\/children\/0/);
    expect(drawn.fixes).toBeUndefined();
  });

  it('states a takeaway and a source for the chart, so no annotation is asked for', () => {
    const findings = analyzeDocxQuality(
      on('consulting', chartFigure('Revenue by quarter'))
    ).diagnostics.filter((d) =>
      [QUALITY_CODES.CHART_ANNOTATION, QUALITY_CODES.CHART_UNITS].includes(
        d.code as never
      )
    );
    expect(findings).toEqual([]);
  });

  describe.each([
    ['consulting', consultingTheme],
    ['minimal', minimalTheme],
    ['vermilion', vermilionTheme],
    ['devportal', devportalTheme],
  ])('on the %s theme', (theme) => {
    it('numbers two charts and a figure, cites their sources once each, warning-clean', async () => {
      const doc = on(
        theme,
        chartFigure('Revenue by quarter', 'Source: operating review, 2026.'),
        figure(),
        chartFigure(
          'Retention by segment',
          'Source: CRM export, September 2026.'
        ),
        invocation('footnotes')
      );
      expect(validateDocument(doc).errors).toEqual([]);
      const { buffer, warnings } = await generateBufferWithWarnings(doc);
      expect(warnings).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const xml = await documentXml(buffer as Buffer);
      expect(xml.match(/SEQ figure \\\* ARABIC/g)).toHaveLength(3);
      const numbers = [...text(xml).matchAll(/\|(\d)\|/g)].map((m) => m[1]);
      expect(numbers).toEqual(['1', '2', '3']);
      expect(xml).toContain('Notes and sources');
      const sources = [
        'Source: operating review, 2026.',
        'Source: operating handbook, 2026 edition.',
        'Source: CRM export, September 2026.',
      ];
      for (const source of sources) expect(xml.split(source)).toHaveLength(3); // under its figure, and listed once
      expect(
        analyzeDocxQuality(doc).diagnostics.filter(
          (finding) => finding.severity !== 'info'
        )
      ).toEqual([]);
    });
  });
});

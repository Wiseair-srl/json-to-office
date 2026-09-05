/**
 * The house theme, as a document sees it.
 *
 * `consulting` is the first bundled theme to carry the shared visual layers in
 * full, and the one the design-quality programme's reports will be set in. What
 * matters about it is observable from outside: which fonts it names, what its
 * roles resolve to, that a plain document on it stays as warning-clean as on
 * `minimal`, that it adds no chrome of its own, and that a chart on it is set
 * in the house type. Its schema validity is covered by `bundled-themes.test.ts`
 * and its rendered bytes by the corpus golden `theme/builtin-consulting`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { collectFontNamesFromDocx, isSafeFont } from '@json-to-office/shared';
import { CASES as THEME_CASES } from '../../__tests__/fixtures/corpus-theme';
import { generateBufferFromJson } from '../../core/generator';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { consultingTheme } from '../../templates/themes';
import { resolveDocxDesignSystem } from '../design-system';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** The corpus sampler every bundled theme renders, on the named theme. */
function sampler(theme: string): Record<string, unknown> {
  const base = THEME_CASES.find(
    (entry) => entry.name === 'theme/builtin-minimal'
  )!.document as { props: Record<string, unknown> };
  return structuredClone({ ...base, props: { ...base.props, theme } });
}

/** A client-report starter: heading, prose, a statistic and a numeric table. */
const starter = {
  name: 'docx',
  props: {
    theme: 'consulting',
    metadata: { title: 'Quarterly report', author: 'Author' },
  },
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { text: 'Summary', level: 1 } },
        {
          name: 'paragraph',
          props: { text: 'One paragraph of context before the numbers.' },
        },
        {
          name: 'statistic',
          props: {
            number: '42',
            unit: '%',
            description: 'Year-on-year growth',
          },
        },
        {
          name: 'table',
          props: {
            columns: [
              {
                header: { content: 'Metric' },
                cells: [{ content: 'Revenue' }, { content: 'Churn' }],
              },
              {
                header: { content: 'Value (EUR k)' },
                cellDefaults: { horizontalAlignment: 'right' },
                cells: [{ content: '1,240' }, { content: '38' }],
              },
            ],
          },
        },
      ],
    },
  ],
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(PNG_B64),
  });
});

describe('the consulting house theme', () => {
  it('names safe fonts only and registers none', () => {
    const families = [...collectFontNamesFromDocx(consultingTheme)];
    expect(families.length).toBeGreaterThan(0);
    expect(families.filter((family) => !isSafeFont(family))).toEqual([]);
    expect(consultingTheme.fontRegistry).toBeUndefined();
  });

  it('resolves every type role, the scale and the safe area', () => {
    const resolved = resolveDocxDesignSystem(consultingTheme);
    expect(resolved.styles).toMatchObject({
      display: { size: 22, fontWeight: 700, font: 'heading' },
      stat: { size: 18, fontWeight: 700, color: 'accent' },
      quote: { size: 12 },
      chartLabel: { size: 9, fontWeight: 400 },
      source: { size: 8, color: 'textMuted' },
      tracker: { size: 8, case: 'upper' },
      tableHeader: { size: 9, fontWeight: 700 },
      tableCell: { size: 9.5 },
    });
    expect(resolved.page.margins).toMatchObject({
      top: 1440,
      bottom: 1440,
      left: 1440,
      right: 1440,
    });
  });

  it('keeps a plain document exactly as warning-clean as minimal does', () => {
    const codes = (theme: string) =>
      analyzeDocxQuality(sampler(theme))
        .diagnostics.map((entry) => entry.code)
        .sort();
    expect(codes('consulting')).toEqual(codes('minimal'));
    expect(analyzeDocxQuality(starter).counts).toEqual({
      error: 0,
      warning: 0,
      info: 0,
    });
  });

  for (const renderer of ['docxjs', 'office-open'] as const) {
    it(`renders the starter through both ${renderer} pipelines and adds no chrome`, async () => {
      const input = { ...starter, renderer };
      const core = await generateBufferFromJson(
        structuredClone(input) as never
      );
      const plugin = await createDocumentGenerator({}).generateBuffer(
        structuredClone(input) as never
      );
      const a = await JSZip.loadAsync(core);
      const b = await JSZip.loadAsync(plugin.buffer);
      const xml = await a.file('word/document.xml')!.async('string');
      expect(await b.file('word/document.xml')!.async('string')).toBe(xml);
      // The theme paints; it never inserts a running head, footer or tracker.
      expect(
        Object.keys(a.files).some((name) =>
          /word\/(header|footer)\d/.test(name)
        )
      ).toBe(false);
      const styles = await a.file('word/styles.xml')!.async('string');
      expect(styles).toContain('Calibri');
      expect(styles).toContain('Arial');
      expect(styles).toContain('1B4F8A');
    });
  }

  it('sets a chart in the house type and palette', async () => {
    await generateBufferFromJson(
      {
        ...starter,
        children: [
          {
            name: 'section',
            children: [
              {
                name: 'highcharts',
                props: {
                  width: '100%',
                  options: {
                    chart: { width: 900, height: 480 },
                    title: { text: 'Every region grew' },
                    series: [{ type: 'column', data: [1, 2, 3] }],
                  },
                },
              },
            ],
          },
        ],
      } as never,
      { validation: { enabled: false } }
    );
    const { infile, resources } = JSON.parse(
      (mockFetch.mock.calls[0][1] as RequestInit).body as string
    );
    expect(resources).toBeUndefined();
    expect(infile.colors).toEqual([
      '#1B4F8A',
      '#4B5563',
      '#5B8DC9',
      '#7B8794',
      '#A9C4E4',
      '#C9CED6',
    ]);
    expect(infile.chart.style).toEqual({ fontFamily: '"Calibri", sans-serif' });
    expect(infile.title.style).toEqual({
      fontFamily: '"Arial", sans-serif',
      fontSize: '21.9px',
      fontWeight: '700',
      color: '#1A1F26',
    });
    // 9pt labels over a 451.3pt measure for 900 chart pixels.
    expect(infile.legend.itemStyle).toEqual({
      fontSize: '17.9px',
      color: '#1A1F26',
      fontWeight: '400',
    });
    expect(infile.credits.style).toEqual({
      fontSize: '16px',
      color: '#4B5563',
    });
  });
});

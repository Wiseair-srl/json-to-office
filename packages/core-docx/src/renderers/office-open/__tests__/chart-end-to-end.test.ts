/**
 * A charted document, from JSON to bytes.
 *
 * The unit tests either side of this one pin the halves — what the compiler
 * lowers, what the splice writes. This pins the whole: that a `chart` component
 * reaches a real chart part with a real workbook behind it, that the default
 * backend refuses the same document by name rather than losing the figure, and
 * that two renders of it agree byte for byte.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { ReportComponentDefinition } from '../../../types';

const document = (renderer: string, extra: Record<string, unknown> = {}) =>
  ({
    name: 'docx',
    renderer,
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        children: [
          { name: 'heading', props: { text: 'Revenue', level: 1 } },
          {
            name: 'chart',
            props: {
              type: 'bar',
              data: [
                {
                  name: 'Revenue',
                  labels: ['Q1', 'Q2', 'Q3'],
                  values: [12, 18, 15],
                },
                { name: 'Cost', labels: ['Q1', 'Q2', 'Q3'], values: [7, 9, 8] },
              ],
              title: 'Quarterly revenue',
              showLegend: true,
              catAxisTitle: 'Quarter',
              valAxisTitle: 'EUR (thousands)',
              caption: 'Revenue by quarter',
              alt: 'Bar chart of quarterly revenue',
              ...extra,
            },
          },
        ],
      },
    ],
  }) as unknown as ReportComponentDefinition;

async function render(
  doc: ReportComponentDefinition,
  options: Record<string, unknown> = {}
): Promise<AdmZip> {
  const { buffer } = await generateBufferViaIr(doc, {
    validation: { enabled: false },
    // The document's own `renderer` prop is resolved by the public API; this
    // entry point takes it as an option.
    renderer: (doc as { renderer?: string }).renderer,
    ...options,
  });
  return new AdmZip(buffer);
}

const read = (zip: AdmZip, path: string): string =>
  zip.getEntry(path)!.getData().toString('utf8');

describe('native chart end to end', () => {
  it('writes a chart part and no raster media for it', async () => {
    const zip = await render(document('office-open'));
    const names = zip.getEntries().map((entry) => entry.entryName);
    expect(names).toContain('word/charts/chart1.xml');
    expect(names.filter((name) => name.startsWith('word/media/'))).toHaveLength(
      0
    );
  });

  it('ships the workbook "Edit Data" opens', async () => {
    const zip = await render(document('office-open'));
    expect(zip.getEntry('word/embeddings/chart1.xlsx')).toBeTruthy();

    const chart = read(zip, 'word/charts/chart1.xml');
    expect(chart).toContain('<c:externalData r:id="rId1">');
    expect(chart).not.toContain('<c:f/>');

    // The workbook is a real xlsx holding the same numbers the chart caches.
    const workbook = new AdmZip(
      zip.getEntry('word/embeddings/chart1.xlsx')!.getData()
    );
    const sheet = workbook
      .getEntry('xl/worksheets/sheet1.xml')!
      .getData()
      .toString('utf8');
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="C4"><v>8</v></c>');
  });

  it('follows the document theme rather than Word default colours', async () => {
    const chart = read(
      await render(document('office-open')),
      'word/charts/chart1.xml'
    );
    expect(chart).toMatch(/<a:srgbClr val="[0-9A-F]{6}"\/>/);
  });

  it('lets an explicit palette override the theme', async () => {
    const chart = read(
      await render(document('office-open', { chartColors: ['#123456'] })),
      'word/charts/chart1.xml'
    );
    expect(chart).toContain('<a:srgbClr val="123456"/>');
  });

  it('titles the axes the author named', async () => {
    const chart = read(
      await render(document('office-open')),
      'word/charts/chart1.xml'
    );
    expect(chart).toContain('<a:t>Quarter</a:t>');
    expect(chart).toContain('<a:t>EUR (thousands)</a:t>');
  });

  it('keeps the caption as an ordinary paragraph outside the chart', async () => {
    const body = read(
      await render(document('office-open')),
      'word/document.xml'
    );
    expect(body).toContain('Revenue by quarter');
  });

  it('refuses the same document on docxjs, naming the capability', async () => {
    await expect(render(document('docxjs'))).rejects.toThrow(/charts/);
  });

  it('renders byte-identically twice', async () => {
    const first = await generateBufferViaIr(document('office-open'), {
      validation: { enabled: false },
      renderer: 'office-open',
    });
    const second = await generateBufferViaIr(document('office-open'), {
      validation: { enabled: false },
      renderer: 'office-open',
    });
    expect(first.buffer.equals(second.buffer)).toBe(true);
  });

  it('states the drawing id rather than letting the backend allocate one', async () => {
    // `_docPropsIdGen` in `@office-open/docx` is module-level and never resets,
    // so a chart that leaves `wp:docPr` unnamed gets a different id on every
    // render in the same process. This is that regression, pinned: it is the
    // one thing that made two identical documents differ.
    const body = read(
      await render(document('office-open')),
      'word/document.xml'
    );
    expect(body).toMatch(/<wp:docPr id="\d+"/);

    const again = read(
      await render(document('office-open')),
      'word/document.xml'
    );
    expect(again).toBe(body);
  });

  it('pairs every chart with its own workbook, chrome included', async () => {
    // The emitter fills its array while building the backend's document
    // object; the backend numbers its parts while stringifying that object,
    // body before chrome. Pairing by position therefore handed a header chart
    // the body's workbook — "Edit Data" showed another chart's numbers. Parts
    // are matched by content instead, and this is that regression.
    const chartNode = (name: string) => ({
      name: 'chart',
      props: {
        type: 'bar',
        data: [{ name, labels: ['x'], values: [1] }],
      },
    });
    const chrome = {
      name: 'docx',
      renderer: 'office-open',
      props: {},
      children: [
        {
          name: 'section',
          props: { header: [chartNode('H1')], footer: [chartNode('F1')] },
          children: [chartNode('B1'), chartNode('B2')],
        },
        {
          name: 'section',
          props: { header: [chartNode('H2')] },
          children: [chartNode('B3')],
        },
      ],
    } as unknown as ReportComponentDefinition;

    const zip = await render(chrome);
    const parts = zip
      .getEntries()
      .map((entry) => entry.entryName)
      .filter((name) => /^word\/charts\/chart\d+\.xml$/.test(name));
    expect(parts).toHaveLength(6);

    for (const part of parts) {
      const ordinal = part.match(/chart(\d+)\.xml$/)![1];
      const inChart = read(zip, part).match(/<c:v>([A-Z]\d)<\/c:v>/)![1];
      const workbook = new AdmZip(
        zip.getEntry(`word/embeddings/chart${ordinal}.xlsx`)!.getData()
      );
      const inWorkbook = workbook
        .getEntry('xl/worksheets/sheet1.xml')!
        .getData()
        .toString('utf8')
        .match(/<t>([A-Z]\d)<\/t>/)![1];
      expect(inWorkbook, `${part} points at the wrong workbook`).toBe(inChart);
    }
  });

  it('refuses a series with fewer labels than the categories', async () => {
    // `some` walks only the shorter array, so a prefix used to pass and then
    // be padded with a zero the author never wrote.
    const ragged = {
      name: 'docx',
      renderer: 'office-open',
      props: {},
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'chart',
              props: {
                type: 'bar',
                data: [
                  {
                    name: 'Full',
                    labels: ['Q1', 'Q2', 'Q3'],
                    values: [1, 2, 3],
                  },
                  { name: 'Short', labels: ['Q1', 'Q2'], values: [9, 9] },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ReportComponentDefinition;

    await expect(render(ragged)).rejects.toThrow(/Short/);
  });

  it('numbers two charts into their own parts and workbooks', async () => {
    const twoCharts = {
      name: 'docx',
      renderer: 'office-open',
      props: {},
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'chart',
              props: {
                type: 'bar',
                data: [{ name: 'First', labels: ['A'], values: [1] }],
              },
            },
            {
              name: 'chart',
              props: {
                type: 'line',
                data: [{ name: 'Second', labels: ['B'], values: [2] }],
              },
            },
          ],
        },
      ],
    } as unknown as ReportComponentDefinition;

    const zip = await render(twoCharts);
    expect(zip.getEntry('word/charts/chart1.xml')).toBeTruthy();
    expect(zip.getEntry('word/charts/chart2.xml')).toBeTruthy();
    expect(zip.getEntry('word/embeddings/chart1.xlsx')).toBeTruthy();
    expect(zip.getEntry('word/embeddings/chart2.xlsx')).toBeTruthy();

    // Each part carries its own series, not the first one's.
    expect(read(zip, 'word/charts/chart1.xml')).toContain('<c:v>First</c:v>');
    expect(read(zip, 'word/charts/chart2.xml')).toContain('<c:v>Second</c:v>');
  });
});

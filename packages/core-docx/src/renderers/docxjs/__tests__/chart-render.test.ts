/**
 * A native chart on the docx.js renderer, from JSON to bytes.
 *
 * `chart-options.test.ts` pins the mapping onto `ChartRun`'s options; this
 * pins the package that comes out: a chart part with the workbook "Edit Data"
 * opens, every relationship declared and paired with its own chart — chrome
 * included — the theme's colours and fonts on every text element, and the
 * same bytes on every render.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
import { toDosTime } from '../../../utils/packageDocument';
import { PNG_4X2 } from '../../../__tests__/fixtures/corpus-blocks';
import type { DocxIrChartRun, DocxIrParagraph } from '../../../ir/types';

const LABELS = ['Q1', 'Q2', 'Q3'];
const GENERATED_AT = '2024-01-01T00:00:00Z';

const chart = (props: Record<string, unknown> = {}) => ({
  name: 'chart',
  props: {
    type: 'column',
    data: [
      { name: 'Revenue', labels: LABELS, values: [12, 18, 15] },
      { name: 'Cost', labels: LABELS, values: [7, 9, 8] },
    ],
    title: 'Quarterly revenue',
    catAxisTitle: 'Quarter',
    valAxisTitle: 'EUR (thousands)',
    ...props,
  },
});

const documentOf = (
  children: unknown[],
  sectionProps: Record<string, unknown> = {}
) => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'section', props: sectionProps, children }],
});

async function render(
  document: unknown,
  options: Record<string, unknown> = {}
): Promise<AdmZip> {
  const { buffer } = await generateBufferViaIr(document as never, {
    renderer: 'docxjs',
    validation: { enabled: false },
    ...options,
  });
  return new AdmZip(buffer);
}

const read = (zip: AdmZip, name: string): string =>
  zip.getEntry(name)!.getData().toString('utf8');

const names = (zip: AdmZip): string[] =>
  zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName);

/** `word/document.xml` → `word/_rels/document.xml.rels`. */
function relsPartFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/** A relationship's target, resolved against its source part's directory. */
function resolveTarget(partName: string, target: string): string {
  const parts = partName.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

/** Relationship id → target part, for one source part. */
function relationships(zip: AdmZip, partName: string): Map<string, string> {
  const rels = zip.getEntry(relsPartFor(partName));
  if (!rels) return new Map();
  return new Map(
    [
      ...rels
        .getData()
        .toString('utf8')
        .matchAll(/<Relationship\b[^>]*>/g),
    ].map((match) => {
      const tag = match[0];
      const id = /\bId="([^"]+)"/.exec(tag)![1];
      const target = /\bTarget="([^"]+)"/.exec(tag)![1];
      return [
        id,
        /TargetMode="External"/.test(tag)
          ? target
          : resolveTarget(partName, target),
      ];
    })
  );
}

/** Every `r:id|embed|link` in a content part that its rels do not declare. */
function undeclared(zip: AdmZip): string[] {
  const out: string[] = [];
  for (const name of names(zip)) {
    if (!name.endsWith('.xml') || name.includes('/_rels/')) continue;
    const declared = relationships(zip, name);
    for (const match of read(zip, name).matchAll(
      /\br:(?:id|embed|link)="([^"]*)"/g
    )) {
      if (!declared.has(match[1])) out.push(`${name} ${match[1]}`);
    }
  }
  return out;
}

/** The workbook behind a chart part. */
function workbookOf(zip: AdmZip, chartPart: string): AdmZip {
  const id = /<c:externalData r:id="([^"]+)"/.exec(read(zip, chartPart))![1];
  const target = relationships(zip, chartPart).get(id);
  expect(target, `${chartPart} names no workbook`).toMatch(
    /^word\/embeddings\/.+\.xlsx$/
  );
  return new AdmZip(zip.getEntry(target!)!.getData());
}

/** Series colours in document order, one per `c:ser`. */
const seriesColors = (xml: string): string[] =>
  [
    ...xml.matchAll(
      /<c:ser>[\s\S]*?<c:spPr><a:solidFill><a:srgbClr val="([0-9A-F]{6})"/g
    ),
  ].map((match) => match[1]);

async function compiledChart(document: unknown): Promise<DocxIrChartRun> {
  const { ir } = await compileDocumentToIr(document as never, {
    validation: { enabled: false },
  });
  return ir.sections
    .flatMap((section) => section.children)
    .filter((block): block is DocxIrParagraph => block.kind === 'paragraph')
    .flatMap((paragraph) => paragraph.children)
    .find((child): child is DocxIrChartRun => child.kind === 'chart')!;
}

describe('native chart on docxjs', () => {
  it('writes a chart part, its workbook and their content types, and no picture', async () => {
    const zip = await render(documentOf([chart()]));
    const parts = names(zip);

    expect(parts).toContain('word/charts/chart1.xml');
    expect(parts.filter((name) => name.startsWith('word/media/'))).toEqual([]);
    const workbooks = parts.filter((name) =>
      /^word\/embeddings\/.+\.xlsx$/.test(name)
    );
    expect(workbooks).toHaveLength(1);

    const types = read(zip, '[Content_Types].xml');
    expect(types).toMatch(
      /<Override ContentType="application\/vnd\.openxmlformats-officedocument\.drawingml\.chart\+xml" PartName="\/word\/charts\/chart1\.xml"\/>/
    );
    expect(types).toContain(`PartName="/${workbooks[0]}"`);
  }, 60_000);

  it('declares every relationship it references, under a stable id', async () => {
    const zip = await render(
      documentOf([chart(), chart({ type: 'doughnut' })])
    );

    expect(undeclared(zip)).toEqual([]);
    for (const name of names(zip).filter((n) => n.endsWith('.rels'))) {
      for (const match of read(zip, name).matchAll(/\bId="([^"]+)"/g)) {
        expect({ name, id: match[1] }).toEqual({
          name,
          id: expect.stringMatching(/^rId\d+$/),
        });
      }
    }
  }, 60_000);

  it('ships the workbook "Edit Data" opens, holding the numbers and names', async () => {
    const zip = await render(documentOf([chart()]));
    const workbook = workbookOf(zip, 'word/charts/chart1.xml');

    const sheet = workbook.readAsText('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="C4"><v>8</v></c>');
    const strings = workbook.readAsText('xl/sharedStrings.xml');
    expect(strings).toContain('<t>Revenue</t>');
    expect(strings).toContain('<t>Cost</t>');
    expect(strings).toContain('<t>Q3</t>');
  }, 60_000);

  it("colours the series from the theme, or from the author's palette", async () => {
    const themed = documentOf([chart()]);
    const expected = (await compiledChart(themed)).colors.slice(0, 2);
    expect(expected).toHaveLength(2);
    expect(
      seriesColors(read(await render(themed), 'word/charts/chart1.xml'))
    ).toEqual(expected);

    const explicit = await render(
      documentOf([chart({ chartColors: ['#123456', '#ABCDEF'] })])
    );
    expect(seriesColors(read(explicit, 'word/charts/chart1.xml'))).toEqual([
      '123456',
      'ABCDEF',
    ]);
  }, 60_000);

  it('colours a pie slice by slice', async () => {
    const xml = read(
      await render(
        documentOf([
          chart({
            type: 'pie',
            data: [{ name: 'Share', labels: LABELS, values: [50, 30, 20] }],
            chartColors: ['#111111', '#222222', '#333333'],
          }),
        ])
      ),
      'word/charts/chart1.xml'
    );
    const points = [
      ...xml.matchAll(
        /<c:dPt><c:idx val="(\d)"\/>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/g
      ),
    ].map((match) => [match[1], match[2]]);
    expect(points).toEqual([
      ['0', '111111'],
      ['1', '222222'],
      ['2', '333333'],
    ]);
  }, 60_000);

  it('states the theme font on every text element', async () => {
    const xml = read(
      await render(documentOf([chart({ legendPos: 'r' })])),
      'word/charts/chart1.xml'
    );
    const font = (size: number, bold: 0 | 1, text: string): RegExp =>
      new RegExp(
        `<a:defRPr sz="${size}" b="${bold}"[^>]*><a:solidFill><a:srgbClr val="[0-9A-F]{6}"/></a:solidFill><a:latin typeface="[^"]+"/>[\\s\\S]*?<a:t>${text}</a:t>`
      );
    // Axis titles at the chart size and not bold, rather than Word's large
    // bold default; the title at 1.4x and bold.
    expect(xml).toMatch(font(1000, 0, 'Quarter'));
    expect(xml).toMatch(font(1000, 0, 'EUR \\(thousands\\)'));
    expect(xml).toMatch(font(1400, 1, 'Quarterly revenue'));

    // Tick labels and the legend: every axis's and the legend's own txPr.
    const txPrSizes = (element: string): string[] =>
      [
        ...xml.matchAll(
          new RegExp(
            `<${element}>(?:(?!</${element}>)[\\s\\S])*?</c:title>(?:(?!</${element}>)[\\s\\S])*?<c:txPr>[\\s\\S]*?<a:defRPr sz="(\\d+)"`,
            'g'
          )
        ),
      ].map((match) => match[1]);
    expect(txPrSizes('c:catAx')).toEqual(['1000']);
    expect(txPrSizes('c:valAx')).toEqual(['1000']);
    const legend = xml.slice(xml.indexOf('<c:legend>'));
    expect(legend).toMatch(/<c:legendPos val="r"\/>/);
    expect(legend).toMatch(/<c:txPr>[\s\S]*?<a:defRPr sz="1000" b="0"/);
  }, 60_000);

  it('draws no title, not even a placeholder, when the title is hidden', async () => {
    const xml = read(
      await render(documentOf([chart({ showTitle: false })])),
      'word/charts/chart1.xml'
    );
    expect(xml.slice(0, xml.indexOf('<c:plotArea>'))).not.toContain(
      '<c:title>'
    );
    expect(xml).toContain('<c:autoTitleDeleted val="1"/>');
  }, 60_000);

  it('drops the legend when asked, and places it top right', async () => {
    const zip = await render(
      documentOf([chart({ showLegend: false }), chart({ legendPos: 'tr' })])
    );
    expect(read(zip, 'word/charts/chart1.xml')).not.toContain('<c:legend>');
    expect(read(zip, 'word/charts/chart2.xml')).toContain(
      '<c:legendPos val="tr"/>'
    );
  }, 60_000);

  it("plots a scatter point's label as a number", async () => {
    const xml = read(
      await render(
        documentOf([
          chart({
            type: 'scatter',
            data: [
              { name: 'Fit', labels: ['1', '2.5', '4'], values: [3, 1, 2] },
            ],
          }),
        ])
      ),
      'word/charts/chart1.xml'
    );
    expect(xml).toMatch(
      /<c:xVal><c:numRef>[\s\S]*?<c:pt idx="1"><c:v>2\.5<\/c:v><\/c:pt>[\s\S]*?<\/c:xVal>/
    );
  }, 60_000);

  it('pairs every chart with its own workbook, chrome included', async () => {
    // The docx.js twin of office-open's regression: a header chart must not
    // open the body's numbers.
    const named = (name: string) =>
      chart({ data: [{ name, labels: ['x'], values: [1] }] });
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { header: [named('H1')], footer: [named('F1')] },
          children: [named('B1'), named('B2')],
        },
        {
          name: 'section',
          props: { header: [named('H2')] },
          children: [named('B3')],
        },
      ],
    };
    const zip = await render(document);
    expect(undeclared(zip)).toEqual([]);

    const seen: string[] = [];
    for (const part of names(zip).filter((name) =>
      /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)
    )) {
      const rels = relationships(zip, part);
      for (const match of read(zip, part).matchAll(
        /<c:chart\b[^>]*\br:id="([^"]+)"/g
      )) {
        const chartPart = rels.get(match[1])!;
        const own = /<c:tx>[\s\S]*?<c:v>([A-Z]\d)<\/c:v>/.exec(
          read(zip, chartPart)
        )![1];
        const strings = workbookOf(zip, chartPart).readAsText(
          'xl/sharedStrings.xml'
        );
        expect(strings, `${part} → ${chartPart}`).toContain(`<t>${own}</t>`);
        seen.push(own);
      }
    }
    expect(seen.sort()).toEqual(['B1', 'B2', 'B3', 'F1', 'H1', 'H2']);
  }, 60_000);

  it('resolves an image, then a link, then a chart in one part', async () => {
    const zip = await render(
      documentOf([
        { name: 'image', props: { base64: PNG_4X2 } },
        {
          name: 'paragraph',
          props: { text: 'See [alpha](https://example.com/a).' },
        },
        chart(),
      ])
    );
    expect(undeclared(zip)).toEqual([]);

    const body = read(zip, 'word/document.xml');
    const rels = relationships(zip, 'word/document.xml');
    const link = /<w:hyperlink\b[^>]*\br:id="([^"]+)"/.exec(body)![1];
    expect(rels.get(link)).toBe('https://example.com/a');
    const chartId = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(body)![1];
    expect(rels.get(chartId)).toBe('word/charts/chart1.xml');
  }, 60_000);

  it('anchors a floating chart', async () => {
    const body = read(
      await render(
        documentOf([
          chart({
            width: 3,
            floating: {
              horizontalPosition: { relative: 'margin', align: 'right' },
              verticalPosition: { relative: 'paragraph', align: 'top' },
              wrap: { type: 'square', side: 'bothSides' },
            },
          }),
          { name: 'paragraph', props: { text: 'Wrapped around the chart.' } },
        ])
      ),
      'word/document.xml'
    );
    expect(body).toMatch(/<wp:anchor\b[\s\S]*?<c:chart\b[\s\S]*?<\/wp:anchor>/);
    expect(body).not.toContain('<wp:inline');
  }, 60_000);

  it('numbers drawing ids once per package, the same on every render', async () => {
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { header: [chart()], footer: [chart()] },
          children: [{ name: 'image', props: { base64: PNG_4X2 } }, chart()],
        },
      ],
    };
    const ids = (zip: AdmZip): string[] =>
      names(zip)
        .filter((name) => /^word\/[^/]+\.xml$/.test(name))
        .flatMap((name) =>
          [...read(zip, name).matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map(
            (match) => match[1]
          )
        );

    const first = ids(await render(document));
    expect(first).toHaveLength(4);
    expect(new Set(first).size).toBe(first.length);
    // Something else built in between moves docx's process-wide counter.
    await render(documentOf([chart(), chart(), chart()]));
    expect(ids(await render(document))).toEqual(first);
  }, 60_000);

  it('renders the same bytes every time, in sequence and concurrently', async () => {
    const document = documentOf([chart(), chart({ type: 'doughnut' })]);
    const once = async (): Promise<Buffer> =>
      (
        await generateBufferViaIr(structuredClone(document) as never, {
          renderer: 'docxjs',
          validation: { enabled: false },
          generatedAt: GENERATED_AT,
        })
      ).buffer;

    const first = await once();
    const second = await once();
    const [third, fourth] = await Promise.all([once(), once()]);
    expect(second.equals(first)).toBe(true);
    expect(third.equals(first)).toBe(true);
    expect(fourth.equals(first)).toBe(true);
  }, 60_000);

  it("stamps the workbook's own entries with generatedAt", async () => {
    const zip = await render(documentOf([chart()]), {
      generatedAt: GENERATED_AT,
    });
    const workbook = workbookOf(zip, 'word/charts/chart1.xml');
    expect(workbook.getEntries().length).toBeGreaterThan(0);
    for (const entry of workbook.getEntries()) {
      expect(
        (entry.header as unknown as { timeval: number }).timeval,
        entry.entryName
      ).toBe(toDosTime(new Date(GENERATED_AT)));
    }
  }, 60_000);
});

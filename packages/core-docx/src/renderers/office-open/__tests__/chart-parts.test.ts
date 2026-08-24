/**
 * What the backend leaves out of a chart, and this pass puts back.
 *
 * `@office-open/docx` 0.11.0 forwards eight fields of `ChartSpaceOptions` from
 * a chart run — type, title, series, categories, showLegend, style, threeD,
 * view3D — and drops the rest on the floor. Verified against the package, not
 * its types: `externalData` never reaches the XML, `axes` never reaches the
 * XML, and every `<c:f>` comes out empty, so the chart has cached values and no
 * source for them. There is also nowhere on `ChartSeriesCommon` or
 * `DataPointOptions` to put a series colour.
 *
 * The consequences in Word are concrete: "Edit Data" fails, axis titles are
 * absent, and every series draws in Word's default palette rather than the
 * document theme. So this pass splices the missing parts into the emitted
 * package — the same technique the pptx pptxgenjs adapter already uses for
 * gradient and pattern fills, for the same reason.
 *
 * These tests pin the seam against the *real* backend output. If the package
 * starts emitting any of it, a test here fails and the splice for it goes away.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { spliceChartParts } from '../chartParts';
import type { DocxIrChartRun } from '../../../ir/types';

const chart: DocxIrChartRun = {
  kind: 'chart',
  chartType: 'bar',
  series: [
    { name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] },
    { name: 'Cost', labels: ['Q1', 'Q2'], values: [7, 9] },
  ],
  colors: ['1F4E79', 'C00000'],
  widthEmu: 5486400,
  heightEmu: 2743200,
  title: 'Quarterly revenue',
  categoryAxisTitle: 'Quarter',
  valueAxisTitle: 'EUR',
};

/** A package shaped exactly as the backend emits one, for one bar chart. */
async function renderedPackage(): Promise<Buffer> {
  const { generateDocument } = (await import('@office-open/docx')) as {
    generateDocument: (
      options: Record<string, unknown>,
      packer?: { type?: string }
    ) => Promise<Uint8Array>;
  };
  const bytes = await generateDocument(
    {
      sections: [
        {
          children: [
            {
              paragraph: {
                children: [
                  {
                    chart: {
                      type: 'bar',
                      title: chart.title,
                      categories: chart.series[0].labels,
                      series: chart.series.map((entry) => ({
                        name: entry.name,
                        values: entry.values,
                      })),
                      transformation: {
                        width: chart.widthEmu,
                        height: chart.heightEmu,
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    { type: 'uint8array' }
  );
  return Buffer.from(bytes);
}

async function spliced(): Promise<AdmZip> {
  const zip = new AdmZip(await renderedPackage());
  spliceChartParts(zip, [chart]);
  return new AdmZip(zip.toBuffer());
}

const read = (zip: AdmZip, path: string): string =>
  zip.getEntry(path)!.getData().toString('utf8');

describe('chart part splicing', () => {
  it('confirms the backend still leaves the gaps this pass fills', async () => {
    const before = read(
      new AdmZip(await renderedPackage()),
      'word/charts/chart1.xml'
    );
    expect(before).toContain('<c:f/>');
    expect(before).toContain('<c:spPr/>');
    expect(before).not.toContain('externalData');
  });

  it('adds the workbook, its relationship and its content type', async () => {
    const zip = await spliced();
    expect(zip.getEntry('word/embeddings/chart1.xlsx')).toBeTruthy();

    const rels = read(zip, 'word/charts/_rels/chart1.xml.rels');
    expect(rels).toContain('relationships/package');
    expect(rels).toContain('../embeddings/chart1.xlsx');

    expect(read(zip, '[Content_Types].xml')).toContain('spreadsheetml.sheet"');
  });

  it('points the chart at the workbook so "Edit Data" resolves', async () => {
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    expect(xml).toContain(
      '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>'
    );
    // externalData is the last child of chartSpace, after txPr.
    expect(xml.indexOf('<c:externalData')).toBeGreaterThan(
      xml.indexOf('<c:txPr>')
    );
  });

  it('fills every empty formula with the cell range it caches', async () => {
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    expect(xml).not.toContain('<c:f/>');
    // Series 1: name in B1, categories in A2:A3, values in B2:B3.
    expect(xml).toContain('<c:f>Sheet1!$B$1</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$A$2:$A$3</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$B$2:$B$3</c:f>');
    // Series 2 moves one column right.
    expect(xml).toContain('<c:f>Sheet1!$C$1</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$C$2:$C$3</c:f>');
  });

  it('paints each series its resolved colour', async () => {
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    expect(xml).toContain(
      '<c:spPr><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill></c:spPr>'
    );
    expect(xml).toContain(
      '<c:spPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></c:spPr>'
    );
    // The chartSpace and legend keep their own non-empty spPr untouched.
    expect(xml).toContain('<c:spPr><a:noFill/>');
  });

  it('strokes a line series rather than filling it', async () => {
    // A `a:solidFill` on a line series is accepted and drawn nowhere: the line
    // keeps the reader's default colour. Caught by looking at a LibreOffice
    // render, which drew a blue line under an `accent` palette.
    const zip = new AdmZip(await renderedPackage());
    spliceChartParts(zip, [
      { ...chart, chartType: 'line', colors: ['00AA00'] },
    ]);
    const xml = read(new AdmZip(zip.toBuffer()), 'word/charts/chart1.xml');
    expect(xml).toContain(
      '<c:spPr><a:ln><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></a:ln></c:spPr>'
    );
    expect(xml).toContain('<c:marker>');
  });

  it('cycles a palette shorter than the series list', async () => {
    const zip = new AdmZip(await renderedPackage());
    spliceChartParts(zip, [{ ...chart, colors: ['00FF00'] }]);
    const xml = read(new AdmZip(zip.toBuffer()), 'word/charts/chart1.xml');
    expect(xml.match(/<a:srgbClr val="00FF00"\/>/g)).toHaveLength(2);
  });

  it('leaves series unpainted when the theme yields no palette', async () => {
    const zip = new AdmZip(await renderedPackage());
    spliceChartParts(zip, [{ ...chart, colors: [] }]);
    const xml = read(new AdmZip(zip.toBuffer()), 'word/charts/chart1.xml');
    expect(xml).toContain('<c:spPr/>');
    expect(xml).not.toContain('srgbClr');
  });

  it('titles both axes, in the position the schema demands', async () => {
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    expect(xml).toContain('<a:t>Quarter</a:t>');
    expect(xml).toContain('<a:t>EUR</a:t>');
    // CT_CatAx orders title after axPos and before numFmt/crossAx.
    const catAx = xml.slice(
      xml.indexOf('<c:catAx>'),
      xml.indexOf('</c:catAx>')
    );
    expect(catAx.indexOf('<c:title>')).toBeGreaterThan(
      catAx.indexOf('<c:axPos')
    );
    expect(catAx.indexOf('<c:title>')).toBeLessThan(
      catAx.indexOf('<c:crossAx')
    );
  });

  it('omits an axis title that was never authored', async () => {
    const zip = new AdmZip(await renderedPackage());
    spliceChartParts(zip, [
      { ...chart, categoryAxisTitle: undefined, valueAxisTitle: undefined },
    ]);
    const xml = read(new AdmZip(zip.toBuffer()), 'word/charts/chart1.xml');
    const catAx = xml.slice(
      xml.indexOf('<c:catAx>'),
      xml.indexOf('</c:catAx>')
    );
    expect(catAx).not.toContain('<c:title>');
  });

  it('moves the legend where the author asked', async () => {
    // `legendPosition` is not one of the eight fields the backend forwards, so
    // every legend came out at the default `b` whatever the prop said.
    const zip = new AdmZip(await renderedPackage());
    spliceChartParts(zip, [{ ...chart, legendPosition: 'r' }]);
    const xml = read(new AdmZip(zip.toBuffer()), 'word/charts/chart1.xml');
    expect(xml).toContain('<c:legendPos val="r"/>');
    expect(xml).not.toContain('<c:legendPos val="b"/>');
  });

  it('escapes an axis title rather than letting it break the part', async () => {
    const zip = new AdmZip(await renderedPackage());
    spliceChartParts(zip, [{ ...chart, categoryAxisTitle: 'A & <B>' }]);
    const xml = read(new AdmZip(zip.toBuffer()), 'word/charts/chart1.xml');
    expect(xml).toContain('A &amp; &lt;B&gt;');
  });
});

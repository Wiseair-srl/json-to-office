/**
 * A chart's look, references and workbook, asked of the backend as options.
 *
 * `@office-open/docx` 0.14 hands a chart run's `ChartSpaceOptions` to the part
 * whole and embeds the workbook `externalData` carries, with its relationship
 * and content type; 0.11 forwarded eight fields and wrote no workbook, which
 * is what the splice these tests used to pin put back. The consequences of any
 * of it going missing are concrete in Word: "Edit Data" fails, axis titles are
 * absent, and every series draws in Word's default palette rather than the
 * document theme.
 *
 * These tests render through the emitter and the *real* backend, then the one
 * post-generation pass left (`finishChartParts`).
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { finishChartParts } from '../chartParts';
import { block, emptyContext } from '../emit';
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
  textFont: {
    fontFamily: 'Calibri',
    fontSize: 10,
    bold: false,
    color: '3B3C38',
  },
};

/** A package holding `runs`, emitted and finished as the renderer does. */
async function rendered(...runs: DocxIrChartRun[]): Promise<AdmZip> {
  const { generateDocument } = await import('@office-open/docx');
  const ctx = emptyContext();
  const children = runs.map((run, index) =>
    block(
      { kind: 'paragraph', id: `p${index}`, path: 'p', children: [run] },
      ctx
    )
  );
  const bytes = await generateDocument(
    { sections: [{ children }] },
    { type: 'uint8array' }
  );
  const zip = new AdmZip(Buffer.from(bytes));
  finishChartParts(zip, ctx.charts ?? []);
  return new AdmZip(zip.toBuffer());
}

const spliced = (): Promise<AdmZip> => rendered(chart);

const read = (zip: AdmZip, path: string): string =>
  zip.getEntry(path)!.getData().toString('utf8');

describe('native charts as backend options', () => {
  it('embeds the workbook, its relationship and its content type', async () => {
    const zip = await spliced();
    expect(zip.getEntry('word/embeddings/chart1.xlsx')).toBeTruthy();

    const rels = read(zip, 'word/charts/_rels/chart1.xml.rels');
    expect(rels).toContain('relationships/package');
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('../embeddings/chart1.xlsx');

    expect(read(zip, '[Content_Types].xml')).toContain(
      '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>'
    );
  });

  it('names each workbook for its own chart', async () => {
    // The backend embeds one file per name and points each chart at the name
    // it was given: two charts sharing one would share the first's numbers.
    const second: DocxIrChartRun = {
      ...chart,
      series: [{ name: 'Other', labels: ['Q1', 'Q2'], values: [1, 2] }],
    };
    const zip = await rendered(chart, second);
    for (const ordinal of [1, 2]) {
      expect(read(zip, `word/charts/_rels/chart${ordinal}.xml.rels`)).toContain(
        `../embeddings/chart${ordinal}.xlsx`
      );
    }
    const sheet = (name: string) =>
      new AdmZip(zip.getEntry(`word/embeddings/${name}`)!.getData()).readAsText(
        'xl/worksheets/sheet1.xml'
      );
    expect(sheet('chart1.xlsx')).toContain('Revenue');
    expect(sheet('chart2.xlsx')).toContain('Other');
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

  it('names the cells behind every cached value', async () => {
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    expect(xml).not.toMatch(/<c:f><\/c:f>|<c:f\/>/);
    // Series 1: name in B1, categories in A2:A3, values in B2:B3.
    expect(xml).toContain('<c:f>Sheet1!$B$1</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$A$2:$A$3</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$B$2:$B$3</c:f>');
    // Series 2 moves one column right.
    expect(xml).toContain('<c:f>Sheet1!$C$1</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$C$2:$C$3</c:f>');
  });

  it('paints each series its resolved colour', async () => {
    // With no outline, as Word draws a bar (`chartLook.ts`).
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    expect(xml).toContain(
      '<c:spPr><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill>' +
        '<a:ln><a:noFill/></a:ln></c:spPr>'
    );
    expect(xml).toContain(
      '<c:spPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill>' +
        '<a:ln><a:noFill/></a:ln></c:spPr>'
    );
    // The chart area and legend are stated unfilled, as Office leaves them.
    expect(xml).toContain(
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr>'
    );
  });

  it('strokes a line series rather than filling it', async () => {
    // A `a:solidFill` on a line series is accepted and drawn nowhere: the line
    // keeps the reader's default colour. Caught by looking at a LibreOffice
    // render, which drew a blue line under an `accent` palette.
    const xml = read(
      await rendered({ ...chart, chartType: 'line', colors: ['00AA00'] }),
      'word/charts/chart1.xml'
    );
    // 2.25pt with round caps and joins, as Word draws a line series.
    expect(xml).toContain(
      '<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="00AA00"/>' +
        '</a:solidFill><a:round/></a:ln></c:spPr>'
    );
    // The marker keeps its symbol and size under the colour.
    expect(xml).toContain(
      '<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>'
    );
  });

  it('cycles a palette shorter than the series list', async () => {
    const xml = read(
      await rendered({ ...chart, colors: ['00FF00'] }),
      'word/charts/chart1.xml'
    );
    expect(xml.match(/<a:srgbClr val="00FF00"\/>/g)).toHaveLength(2);
  });

  it('leaves series unpainted when the theme yields no palette', async () => {
    const xml = read(
      await rendered({ ...chart, colors: [] }),
      'word/charts/chart1.xml'
    );
    // No fill, so the reader's palette; the outline is still stated absent.
    expect(xml).toContain('<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>');
    const series = xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? [];
    expect(series.length).toBeGreaterThan(0);
    for (const entry of series) expect(entry).not.toContain('srgbClr');
  });

  it('sizes, faces and colours both axis titles from the theme', async () => {
    // With no run properties an axis title took Word's own default — large and
    // bold, far bigger than the tick labels beside it.
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    const font =
      'sz="1000" b="0"><a:solidFill><a:srgbClr val="3B3C38"/></a:solidFill>' +
      '<a:latin typeface="Calibri"/>';
    for (const tag of ['catAx', 'valAx']) {
      const axis = xml.slice(
        xml.indexOf(`<c:${tag}>`),
        xml.indexOf(`</c:${tag}>`)
      );
      const title = axis.slice(
        axis.indexOf('<c:title>'),
        axis.indexOf('</c:title>')
      );
      expect(title, tag).toContain(
        `<a:pPr><a:defRPr ${font}</a:defRPr></a:pPr>`
      );
      expect(title, tag).toContain(`<a:rPr ${font}</a:rPr>`);
    }
  });

  it('states the chart-wide text default rather than leaving it empty', async () => {
    const xml = read(await spliced(), 'word/charts/chart1.xml');
    const chartSpaceTail = xml.slice(xml.lastIndexOf('</c:chart>'));
    expect(chartSpaceTail.match(/<c:txPr>/g)).toHaveLength(1);
    expect(chartSpaceTail).toContain(
      '<a:defRPr sz="1000"><a:solidFill><a:srgbClr val="3B3C38"/></a:solidFill>' +
        '<a:latin typeface="Calibri"/></a:defRPr>'
    );
    expect(chartSpaceTail).not.toContain('<a:defRPr/>');
    // Written at Word's title ratio, since the default now has a size.
    const head = xml.slice(0, xml.indexOf('<c:plotArea>'));
    expect(head).toContain('<a:defRPr sz="1400" b="1">');
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
    const xml = read(
      await rendered({
        ...chart,
        categoryAxisTitle: undefined,
        valueAxisTitle: undefined,
      }),
      'word/charts/chart1.xml'
    );
    const catAx = xml.slice(
      xml.indexOf('<c:catAx>'),
      xml.indexOf('</c:catAx>')
    );
    expect(catAx).not.toContain('<c:title>');
  });

  it('moves the legend where the author asked', async () => {
    const xml = read(
      await rendered({ ...chart, legendPosition: 'r' }),
      'word/charts/chart1.xml'
    );
    expect(xml).toContain('<c:legendPos val="r"/>');
    expect(xml).not.toContain('<c:legendPos val="b"/>');
  });

  it('escapes an axis title rather than letting it break the part', async () => {
    const xml = read(
      await rendered({ ...chart, categoryAxisTitle: 'A & <B>' }),
      'word/charts/chart1.xml'
    );
    expect(xml).toContain('A &amp; &lt;B&gt;');
  });

  it("draws a scatter chart's markers, which no option can ask for", async () => {
    // `chartSpaceDesc` writes `line` from a literal; `finishChartParts` is
    // what turns it into Word's `lineMarker`.
    const xml = read(
      await rendered({
        ...chart,
        chartType: 'scatter',
        series: [{ name: 'S', labels: ['1', '2.5'], values: [3, 4] }],
      }),
      'word/charts/chart1.xml'
    );
    expect(xml).toContain('<c:scatterStyle val="lineMarker"/>');
    expect(xml).not.toContain('<c:scatterStyle val="line"/>');
  });
});

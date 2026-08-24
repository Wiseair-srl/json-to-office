/**
 * Native charts on the office-open PPTX backend.
 *
 * This adapter used to refuse them outright, and the reason was specific: the
 * backend writes a chart whose `<c:f>` references are empty and ships no
 * workbook behind them, so the chart draws and "Edit Data" fails. A chart you
 * cannot edit is not the chart that was asked for.
 *
 * What changed is that the adapter now writes the missing half itself. These
 * tests pin both halves against the *real* backend: what it already emits (so a
 * repair that becomes unnecessary is noticed rather than silently doubling an
 * element), and what this adapter adds on top.
 *
 * Slightly less is missing here than on docx: `@office-open/pptx` hands its
 * whole options object to `chartSpaceDesc`, so the legend position survives
 * where the docx sibling loses it. Everything else — cell references, series
 * colours, axis titles, bar grouping and `c:externalData` — is spliced on both
 * sides. See `chartChild` for why this adapter cannot pass `axes` through.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import { createOfficeOpenPptxRenderer } from '..';
import type { PresentationComponentDefinition } from '../../../types';

const chart = (extra: Record<string, unknown> = {}) => ({
  name: 'chart',
  props: {
    type: 'bar',
    data: [
      { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [12, 18, 15] },
      { name: 'Cost', labels: ['Q1', 'Q2', 'Q3'], values: [7, 9, 8] },
    ],
    title: 'Quarterly revenue',
    showLegend: true,
    legendPos: 'r',
    catAxisTitle: 'Quarter',
    valAxisTitle: 'EUR',
    chartColors: ['1F4E79', 'C00000'],
    x: 1,
    y: 1,
    w: 6,
    h: 3,
    ...extra,
  },
});

const deck = (elements: unknown[] = [chart()]) =>
  ({
    name: 'pptx',
    props: {},
    children: [{ name: 'slide', children: elements }],
  }) as unknown as PresentationComponentDefinition;

async function render(
  document: PresentationComponentDefinition,
  options: Record<string, unknown> = {}
): Promise<JSZip> {
  const { buffer } = await generateBufferViaIr(document, {
    renderer: 'office-open',
    ...options,
  });
  return JSZip.loadAsync(buffer);
}

const read = (zip: JSZip, path: string): Promise<string> =>
  zip.file(path)!.async('string');

describe('native charts on office-open pptx', () => {
  it('no longer refuses the document', async () => {
    const zip = await render(deck());
    expect(zip.file('ppt/charts/chart1.xml')).toBeTruthy();
  });

  it('ships the workbook "Edit Data" opens, named as pptxgenjs names it', async () => {
    const zip = await render(deck());
    // `canonicalizeChartIds` renumbers charts and rewrites exactly this
    // filename through the same index map, so the convention is load-bearing.
    const workbook = zip.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx');
    expect(workbook).toBeTruthy();

    const rels = await read(zip, 'ppt/charts/_rels/chart1.xml.rels');
    expect(rels).toContain('relationships/package');
    expect(rels).toContain('../embeddings/Microsoft_Excel_Worksheet1.xlsx');
    expect(await read(zip, '[Content_Types].xml')).toContain(
      'spreadsheetml.sheet"'
    );

    const book = await JSZip.loadAsync(await workbook!.async('uint8array'));
    const sheet = await book.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="C4"><v>8</v></c>');
  });

  it('fills every empty formula with the range it caches', async () => {
    const xml = await read(await render(deck()), 'ppt/charts/chart1.xml');
    expect(xml).not.toContain('<c:f/>');
    expect(xml).toContain('<c:f>Sheet1!$B$1</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$A$2:$A$4</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$C$2:$C$4</c:f>');
  });

  it('paints each series its resolved colour', async () => {
    const xml = await read(await render(deck()), 'ppt/charts/chart1.xml');
    expect(xml).toContain('<a:srgbClr val="1F4E79"/>');
    expect(xml).toContain('<a:srgbClr val="C00000"/>');
  });

  it('lets the backend carry what it can, without doubling it', async () => {
    // externalData, the chart title and the legend position all come through
    // the emitter on this backend. The splice must not add a second copy.
    const xml = await read(await render(deck()), 'ppt/charts/chart1.xml');
    expect(xml.match(/<c:externalData/g)).toHaveLength(1);
    expect(xml).toContain('<c:legendPos val="r"/>');
    // One title per axis, and one for the chart itself.
    expect(xml.match(/<c:title>/g)).toHaveLength(3);
  });

  it('titles the axes the backend built, rather than replacing them', async () => {
    // Passing `axes` to the backend replaces its default axis pair wholesale,
    // and `AxisOptions` requires an `id`/`crossAxisId` this adapter cannot
    // allocate. Doing it emitted literal `<undefined>` elements and six
    // `val="undefined"` attributes, and dropped c:catAx entirely — which
    // LibreOffice tolerates and PowerPoint offers to repair. Asserting the
    // titles alone did not catch it, so this asserts the structure.
    const xml = await read(await render(deck()), 'ppt/charts/chart1.xml');

    expect(xml).not.toContain('undefined');
    expect(xml).not.toContain('<undefined>');
    expect(xml).toContain('<c:catAx>');
    expect(xml).toContain('<c:valAx>');
    expect(xml).toContain('<c:axPos');
    expect(xml.match(/<c:axId val="\d+"\/>/g)?.length).toBeGreaterThanOrEqual(
      4
    );

    // The titles sit inside those axes, after c:axPos, where the schema wants.
    const catAx = xml.slice(
      xml.indexOf('<c:catAx>'),
      xml.indexOf('</c:catAx>')
    );
    expect(catAx).toContain('<a:t>Quarter</a:t>');
    expect(catAx.indexOf('<c:title>')).toBeGreaterThan(
      catAx.indexOf('<c:axPos')
    );
    const valAx = xml.slice(
      xml.indexOf('<c:valAx>'),
      xml.indexOf('</c:valAx>')
    );
    expect(valAx).toContain('<a:t>EUR</a:t>');
  });

  it('spells a default bar chart as a column, not a sideways bar', async () => {
    // PowerPoint's `bar` defaults to `barDir: "col"`; `@office-open` gives that
    // its own type name. Reading it wrong lays every column on its side.
    const xml = await read(await render(deck()), 'ppt/charts/chart1.xml');
    expect(xml).toContain('<c:barDir val="col"/>');

    const sideways = await read(
      await render(deck([chart({ barDir: 'bar' })])),
      'ppt/charts/chart1.xml'
    );
    expect(sideways).toContain('<c:barDir val="bar"/>');
  });

  it('claims only the cells a short series actually has', async () => {
    // The pptx compiler accepts a ragged chart — only the docx one refuses it —
    // so the workbook has to be honest about it. Padding the rectangle with a
    // zero puts a data point in the file the author never wrote, and a range
    // longer than the cells behind it disagrees with the c:ptCount the backend
    // already cached.
    const ragged = {
      name: 'chart',
      props: {
        type: 'bar',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        data: [
          { name: 'Full', labels: ['Q1', 'Q2', 'Q3'], values: [1, 2, 3] },
          { name: 'Short', labels: ['Q1', 'Q2'], values: [9, 9] },
        ],
      },
    };
    const zip = await render(deck([ragged]));
    const xml = await read(zip, 'ppt/charts/chart1.xml');

    expect(xml).toContain('<c:f>Sheet1!$B$2:$B$4</c:f>');
    expect(xml).toContain('<c:f>Sheet1!$C$2:$C$3</c:f>');

    const book = await JSZip.loadAsync(
      await zip
        .file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx')!
        .async('uint8array')
    );
    const sheet = await book.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).not.toContain('r="C4"');
  });

  it('draws every chart type but bubble', async () => {
    // Verified against the real backend: eight of the nine types round-trip
    // with no empty formula, no unpainted series and a workbook behind them.
    for (const type of [
      'bar',
      'bar3D',
      'line',
      'pie',
      'doughnut',
      'area',
      'scatter',
      'radar',
    ]) {
      const zip = await render(deck([chart({ type })]));
      const xml = await read(zip, 'ppt/charts/chart1.xml');
      expect(xml, type).not.toContain('<c:f/>');
      expect(xml, type).not.toContain('undefined');
      expect(xml, type).toContain('<a:srgbClr val="1F4E79"/>');
      expect(
        zip.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'),
        type
      ).toBeTruthy();
    }
  });

  it('refuses a bubble chart by name rather than crashing inside the backend', async () => {
    // `@office-open` spells a bubble series as xValues/yValues/bubbleSize;
    // handing it categories and values throws a TypeError from inside its own
    // bundle, which is no use to anyone.
    const bubble = {
      name: 'chart',
      props: {
        type: 'bubble',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        data: [
          { name: 'S', labels: ['1', '2'], values: [1, 2], sizes: [3, 4] },
        ],
      },
    };
    await expect(render(deck([bubble]))).rejects.toThrow(/bubble/);

    // The same deck still renders on the backend that can draw one.
    await expect(
      render(deck([bubble]), { renderer: 'pptxgenjs' })
    ).resolves.toBeDefined();
  });

  it('matches a chart whose text the backend had to escape', async () => {
    // The part signature is read out of `<c:v>`, where the backend has already
    // escaped `&`, `<`, `>`, `"` and `'`; the input signature is built from the
    // raw IR. Comparing them unescaped made every such chart fail to match, and
    // an unmatched part was silently skipped — so the chart shipped with no
    // workbook, no c:externalData and empty `<c:f/>`.
    const awkward = {
      name: 'chart',
      props: {
        type: 'bar',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        data: [
          {
            name: 'A & B < C > D " E \' F',
            labels: ['x & y', '<z>'],
            values: [1, 2],
          },
        ],
      },
    };
    const zip = await render(deck([awkward]));
    const xml = await read(zip, 'ppt/charts/chart1.xml');
    expect(xml).not.toContain('<c:f/>');
    expect(xml).toContain('<c:externalData');
    expect(
      zip.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx')
    ).toBeTruthy();
  });

  it('colours a pie per slice, not per series', async () => {
    // A pie has one series whose slices are its data points. A series-level
    // fill paints every slice the same colour and the rest of the palette is
    // never written, so a themed pie rendered monochrome here while the same
    // document rendered normally on pptxgenjs.
    const pie = {
      name: 'chart',
      props: {
        type: 'pie',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        chartColors: ['112233', '445566', '778899'],
        data: [{ name: 'S', labels: ['a', 'b', 'c'], values: [1, 2, 3] }],
      },
    };
    const xml = await read(await render(deck([pie])), 'ppt/charts/chart1.xml');
    expect(xml.match(/<c:dPt>/g)).toHaveLength(3);
    for (const hex of ['112233', '445566', '778899']) {
      expect(xml).toContain(`<a:srgbClr val="${hex}"/>`);
    }
  });

  it('titles a scatter chart by axis position, since it has no category axis', async () => {
    // Both of a scatter's axes are `c:valAx`, X first. Titling by tag put the
    // value title on X and dropped the category title — a mislabelled chart,
    // schema-legal, so nothing complained.
    const scatter = {
      name: 'chart',
      props: {
        type: 'scatter',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        catAxisTitle: 'XT',
        valAxisTitle: 'YT',
        data: [{ name: 'S', labels: ['1', '2'], values: [1, 2] }],
      },
    };
    const xml = await read(
      await render(deck([scatter])),
      'ppt/charts/chart1.xml'
    );
    expect(xml).not.toContain('<c:catAx>');
    const axes = [...xml.matchAll(/<c:valAx>[\s\S]*?<\/c:valAx>/g)].map(
      (match) => match[0].match(/<a:t>([^<]*)<\/a:t>/)?.[1] ?? null
    );
    expect(axes).toEqual(['XT', 'YT']);
  });

  it('stacks bars the author asked to stack', async () => {
    // `ChartSpaceOptions` has no grouping field and `chartSpaceDesc` writes
    // `clustered` unconditionally, so a chart authored as "% of total" came out
    // as side-by-side bars summing to nothing. The one dropped option that
    // misrepresented the data rather than restyling it.
    const stacked = {
      name: 'chart',
      props: {
        type: 'bar',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        barGrouping: 'percentStacked',
        data: [
          { name: 'A', labels: ['a'], values: [1] },
          { name: 'B', labels: ['a'], values: [2] },
        ],
      },
    };
    const xml = await read(
      await render(deck([stacked])),
      'ppt/charts/chart1.xml'
    );
    expect(xml).toContain('<c:grouping val="percentStacked"/>');
    // Stacked bars that do not overlap are drawn side by side regardless.
    expect(xml).toContain('<c:overlap val="100"/>');
  });

  it('states no cell range for a series with no points', async () => {
    // `$A$2:$A$1` is not a range a reader accepts; an empty series states
    // nothing rather than something impossible.
    const empty = {
      name: 'chart',
      props: {
        type: 'bar',
        x: 1,
        y: 1,
        w: 4,
        h: 3,
        data: [{ name: 'A', labels: [], values: [] }],
      },
    };
    const xml = await read(
      await render(deck([empty])),
      'ppt/charts/chart1.xml'
    );
    expect(xml).not.toMatch(/\$A\$2:\$A\$1/);
    expect(xml).not.toMatch(/\$[A-Z]\$2:\$[A-Z]\$1/);
  });

  it('forwards the per-family tuning the backend carries directly', async () => {
    const bars = await read(
      await render(deck([chart({ barGapWidthPct: 20, barOverlapPct: -10 })])),
      'ppt/charts/chart1.xml'
    );
    expect(bars).toContain('<c:gapWidth val="20"/>');
    expect(bars).toContain('<c:overlap val="-10"/>');

    const ring = await read(
      await render(
        deck([chart({ type: 'doughnut', holeSize: 70, firstSliceAng: 90 })])
      ),
      'ppt/charts/chart1.xml'
    );
    expect(ring).toContain('<c:holeSize val="70"/>');
    expect(ring).toContain('<c:firstSliceAng val="90"/>');
  });

  it('labels every series, not just the first', async () => {
    // The fixture has two series. A chart that labelled only one of them would
    // be a different chart from the authored one.
    const xml = await read(
      await render(
        deck([chart({ showValue: true, dataLabelPosition: 'outEnd' })])
      ),
      'ppt/charts/chart1.xml'
    );
    // `<c:showVal/>` rather than `val="1"`: CT_Boolean's `val` is optional and
    // defaults to true, so this is the backend's spelling of the same thing.
    expect(xml.match(/<c:showVal\/>/g)).toHaveLength(2);
    expect(xml.match(/<c:dLblPos val="outEnd"\/>/g)).toHaveLength(2);
  });

  it('turns off the label flags the author did not ask for', async () => {
    // The same CT_Boolean default cuts the other way, and this is the bug it
    // caused. Every flag left *out* of `c:dLbls` also defaults to true, so
    // writing only `<c:showVal/>` asks for the value, the category name, the
    // series name, the percentage and the legend key — a chart authored with
    // `showValue: true` came out labelled `Q1; Revenue; 120`. Asserting the
    // value label alone did not catch it; a LibreOffice render did.
    const xml = await read(
      await render(deck([chart({ showValue: true })])),
      'ppt/charts/chart1.xml'
    );
    for (const flag of [
      'showCatName',
      'showSerName',
      'showPercent',
      'showBubbleSize',
      'showLegendKey',
    ]) {
      expect(xml, flag).toContain(`<c:${flag} val="0"/>`);
    }
  });

  it('keeps an explicit false, and stays silent when nothing was authored', async () => {
    // Off is a value, not an absence: an author who turns the label off means
    // it, and a backend left on its default would draw one they asked not to
    // see.
    const off = await read(
      await render(deck([chart({ showValue: false })])),
      'ppt/charts/chart1.xml'
    );
    expect(off).toContain('<c:showVal val="0"/>');

    // ...but a chart that said nothing about labels must not get an opinion
    // written into it either.
    const quiet = await read(await render(deck()), 'ppt/charts/chart1.xml');
    expect(quiet).not.toContain('<c:dLbls>');
  });

  it('applies every authored axis edit, in schema order', async () => {
    const xml = await read(
      await render(
        deck([
          chart({
            valAxisMinVal: -5,
            valAxisMaxVal: 99,
            valAxisMajorUnit: 10,
            valAxisLabelFormatCode: '#,##0',
            catAxisHidden: true,
            valAxisLineShow: false,
            catAxisLabelRotate: -45,
            valGridLine: { style: 'dash', size: 1, color: 'CCCCCC' },
          }),
        ])
      ),
      'ppt/charts/chart1.xml'
    );

    // CT_Scaling orders logBase, orientation, max, min.
    expect(xml).toContain(
      '<c:scaling><c:orientation val="minMax"/><c:max val="99"/><c:min val="-5"/></c:scaling>'
    );
    expect(xml).toContain('<c:majorUnit val="10"/>');
    expect(xml).toContain('<c:numFmt formatCode="#,##0" sourceLinked="0"/>');
    // `rot` is 60000ths of a degree.
    expect(xml).toContain('<a:bodyPr rot="-2700000"');
    expect(xml).toContain('<a:prstDash val="dash"/>');
    expect(xml).not.toContain('undefined');

    const catAx = xml.slice(
      xml.indexOf('<c:catAx>'),
      xml.indexOf('</c:catAx>')
    );
    expect(catAx).toContain('<c:delete val="1"/>');

    const valAx = xml.slice(
      xml.indexOf('<c:valAx>'),
      xml.indexOf('</c:valAx>')
    );
    // CT_ValAx fixes this order, and a reader enforces it: majorGridlines,
    // title, numFmt, spPr, then crossAx. Inserting each edit at its own anchor
    // put whichever landed last in front of the rest.
    const order = [
      '<c:axPos',
      '<c:majorGridlines>',
      '<c:title>',
      '<c:numFmt',
      '<c:crossAx',
      '<c:majorUnit',
    ].map((tag) => valAx.indexOf(tag));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // The axis-level `c:spPr` sits between numFmt and crossAx. Searched from
    // the numFmt onwards because `c:majorGridlines` carries a nested `c:spPr`
    // of its own, and a plain indexOf finds that one first.
    const axisSpPr = valAx.indexOf('<c:spPr>', valAx.indexOf('<c:numFmt'));
    expect(axisSpPr).toBeGreaterThan(valAx.indexOf('<c:numFmt'));
    expect(axisSpPr).toBeLessThan(valAx.indexOf('<c:crossAx'));
  });

  it('leaves an axis the author said nothing about alone', async () => {
    const plain = await read(await render(deck()), 'ppt/charts/chart1.xml');
    expect(plain).toContain('<c:delete val="0"/>');
    expect(plain).not.toContain('<c:majorGridlines');
    expect(plain).not.toContain('<c:majorUnit');
    expect(plain).toContain(
      '<c:numFmt formatCode="General" sourceLinked="1"/>'
    );
  });

  it('styles a line series without losing its colour', async () => {
    const xml = await read(
      await render(
        deck([
          chart({
            type: 'line',
            lineSize: 4,
            lineSmooth: true,
            lineDataSymbol: 'diamond',
            lineDataSymbolSize: 9,
          }),
        ])
      ),
      'ppt/charts/chart1.xml'
    );
    const series = xml.slice(xml.indexOf('<c:ser>'), xml.indexOf('</c:ser>'));
    // 4pt in EMU, and the series colour still on the line.
    expect(series).toContain('<a:ln w="50800">');
    expect(series).toMatch(
      /<a:ln w="50800"><a:solidFill><a:srgbClr val="1F4E79"/
    );
    expect(series).toContain('<c:smooth');
    expect(series).toContain('<c:symbol val="diamond"/>');
    expect(series).toContain('<c:size val="9"/>');
  });

  it('outlines a filled series without overwriting its fill', async () => {
    const xml = await read(
      await render(deck([chart({ dataBorder: { pt: 2, color: 'FF0000' } })])),
      'ppt/charts/chart1.xml'
    );
    const series = xml.slice(xml.indexOf('<c:ser>'), xml.indexOf('</c:ser>'));
    // Fill first, then the outline — both present in one `c:spPr`.
    expect(series).toMatch(
      /<c:spPr><a:solidFill><a:srgbClr val="1F4E79"\/><\/a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"\/>/
    );
  });

  it('outlines each slice of a pie, which is coloured per point', async () => {
    const xml = await read(
      await render(
        deck([chart({ type: 'pie', dataBorder: { pt: 1, color: '00FF00' } })])
      ),
      'ppt/charts/chart1.xml'
    );
    expect(xml).toMatch(
      /<c:dPt>[\s\S]*?<a:ln w="12700"><a:solidFill><a:srgbClr val="00FF00"/
    );
  });

  it('honours a radar style the backend writes from a literal', async () => {
    // `chartSpaceDesc` emits `<c:radarStyle val="standard"/>` with no option
    // behind it, so `marker` and `filled` became `standard` without a word.
    for (const style of ['marker', 'filled']) {
      const xml = await read(
        await render(deck([chart({ type: 'radar', radarStyle: style })])),
        'ppt/charts/chart1.xml'
      );
      expect(xml, style).toContain(`<c:radarStyle val="${style}"/>`);
    }
  });

  it('styles the chart title, legend, data labels and axis labels', async () => {
    const xml = await read(
      await render(
        deck([
          chart({
            showValue: true,
            titleFontSize: 20,
            titleColor: 'FF0000',
            titleFontFace: 'Inter',
            legendFontSize: 10,
            legendColor: '333333',
            dataLabelFontSize: 8,
            dataLabelColor: '0000FF',
            catAxisLabelFontSize: 9,
            catAxisLabelColor: '666666',
          }),
        ])
      ),
      'ppt/charts/chart1.xml'
    );

    // `sz` is hundredths of a point, and CT_TextCharacterProperties puts the
    // fill before `a:latin`.
    const head = xml.slice(0, xml.indexOf('<c:plotArea>'));
    expect(head).toContain(
      '<a:defRPr sz="2000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Inter"/></a:defRPr>'
    );

    const legend = xml.slice(
      xml.indexOf('<c:legend>'),
      xml.indexOf('</c:legend>')
    );
    expect(legend).toMatch(/<a:defRPr sz="1000">[\s\S]*?val="333333"/);
    // Filled into the `c:txPr` the backend already wrote, not added beside it.
    expect(legend.match(/<c:txPr>/g)).toHaveLength(1);

    expect(xml).toMatch(/<c:dLbls><c:txPr>[\s\S]*?sz="800"/);
  });

  it('merges an axis rotation and font into one c:txPr', async () => {
    // Two properties of the same text. A second `c:txPr` on one axis is a
    // repair prompt, not a differently-styled label.
    const xml = await read(
      await render(
        deck([chart({ catAxisLabelRotate: -45, catAxisLabelFontSize: 9 })])
      ),
      'ppt/charts/chart1.xml'
    );
    const catAx = xml.slice(
      xml.indexOf('<c:catAx>'),
      xml.indexOf('</c:catAx>')
    );
    expect(catAx.match(/<c:txPr>/g)).toHaveLength(1);
    expect(catAx).toMatch(/<a:bodyPr rot="-2700000"[\s\S]*?sz="900"/);
  });

  it('declares every chart capability now that the last one landed', async () => {
    const renderer = await createOfficeOpenPptxRenderer();
    const missing = [...renderer.capabilities];
    for (const feature of [
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
    ] as const) {
      expect(missing, feature).toContain(feature);
    }
  });

  it('renders byte-identically twice', async () => {
    const first = await generateBufferViaIr(deck(), {
      renderer: 'office-open',
    });
    const second = await generateBufferViaIr(deck(), {
      renderer: 'office-open',
    });
    expect(first.buffer.equals(second.buffer)).toBe(true);
  });

  it('gives two charts their own parts and their own workbooks', async () => {
    const second = {
      name: 'chart',
      props: {
        type: 'line',
        data: [{ name: 'Margin', labels: ['Q1'], values: [33] }],
        x: 1,
        y: 4,
        w: 4,
        h: 2,
      },
    };
    const zip = await render(deck([chart(), second]));

    for (const ordinal of [1, 2]) {
      const xml = await read(zip, `ppt/charts/chart${ordinal}.xml`);
      const book = await JSZip.loadAsync(
        await zip
          .file(`ppt/embeddings/Microsoft_Excel_Worksheet${ordinal}.xlsx`)!
          .async('uint8array')
      );
      const sheet = await book
        .file('xl/worksheets/sheet1.xml')!
        .async('string');
      const inChart = xml.match(/<c:v>(Revenue|Margin)<\/c:v>/)![1];
      const inBook = sheet.match(/<t>(Revenue|Margin)<\/t>/)![1];
      expect(inBook, `chart${ordinal} points at the wrong workbook`).toBe(
        inChart
      );
    }
  });

  it('still ships the workbook when finalization is skipped', async () => {
    // A chart without its workbook is broken, not merely undeterministic, so
    // the splice runs on both sides of the `deterministic: false` shortcut.
    const zip = await render(deck(), { deterministic: false });
    expect(
      zip.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx')
    ).toBeTruthy();
  });
});

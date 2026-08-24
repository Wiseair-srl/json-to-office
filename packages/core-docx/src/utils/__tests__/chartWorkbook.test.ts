/**
 * The workbook behind "Edit Data".
 *
 * `@office-open` writes chart XML and nothing else: `ExternalDataOptions` is
 * `{relationshipId, autoUpdate}`, a pointer, and no workbook generator exists
 * anywhere in the package. A chart shipped without the part it points at draws
 * correctly and then fails the moment a reader asks to edit it — which is why
 * the pptx sibling refuses native charts outright today.
 *
 * So these bytes are ours to write, and they have to be a real xlsx: the parts
 * an OPC reader demands, cells the chart's own references can resolve, and no
 * clock anywhere, because a document that renders twice must render the same.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { buildChartWorkbook } from '../chartWorkbook';
import type { DocxIrChartSeries } from '../../ir/types';

const series: DocxIrChartSeries[] = [
  { name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] },
  { name: 'Cost', labels: ['Q1', 'Q2'], values: [7, 9] },
];

function entries(bytes: Uint8Array): Map<string, string> {
  const zip = new AdmZip(Buffer.from(bytes));
  return new Map(
    zip
      .getEntries()
      .map((entry) => [entry.entryName, entry.getData().toString('utf8')])
  );
}

describe('chart workbook', () => {
  it('writes the parts an OPC reader demands', () => {
    const files = entries(buildChartWorkbook(series));
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('declares the sheet so the workbook relationship resolves', () => {
    const files = entries(buildChartWorkbook(series));
    expect(files.get('xl/_rels/workbook.xml.rels')).toContain(
      'worksheets/sheet1.xml'
    );
    expect(files.get('_rels/.rels')).toContain('xl/workbook.xml');
    expect(files.get('[Content_Types].xml')).toContain(
      'spreadsheetml.sheet.main+xml'
    );
  });

  it('lays the series out where the chart references them', () => {
    const sheet = entries(buildChartWorkbook(series)).get(
      'xl/worksheets/sheet1.xml'
    )!;
    // Row 1 is the header: A1 blank, then one series name per column.
    expect(sheet).toContain(
      '<c r="B1" t="inlineStr"><is><t>Revenue</t></is></c>'
    );
    expect(sheet).toContain('<c r="C1" t="inlineStr"><is><t>Cost</t></is></c>');
    // Then one row per category: the label, then that category's values.
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>Q1</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="C3"><v>9</v></c>');
  });

  it('escapes labels rather than letting them break the sheet', () => {
    const sheet = entries(
      buildChartWorkbook([{ name: 'A & B', labels: ['<tag>'], values: [1] }])
    ).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('A &amp; B');
    expect(sheet).toContain('&lt;tag&gt;');
    expect(sheet).not.toContain('<tag>');
  });

  it('is byte-identical across builds, carrying no clock', () => {
    const first = buildChartWorkbook(series);
    const second = buildChartWorkbook(series);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('distinguishes different data', () => {
    const other = buildChartWorkbook([
      { name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 19] },
    ]);
    expect(
      Buffer.from(buildChartWorkbook(series)).equals(Buffer.from(other))
    ).toBe(false);
  });
});

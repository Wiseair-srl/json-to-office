/**
 * A table's grid is its columns' widths in twips, on both backends.
 *
 * Word and LibreOffice lay a percentage-width table out from its preferred
 * width and scale `w:tblGrid` to fit, so they drew a table whose columns name
 * no width correctly while its grid said 25 twips a column. Google Docs, Apple
 * Pages and QuickLook take the grid as the physical widths (dolanmiu/docx#3476).
 * What is asserted is what those readers read: the `w:gridCol` values, whole
 * twips, adding up to the width the table stands in — the section's text width
 * with the gutter taken out, or for a table in a cell the cell's width less its
 * side margins. A table that states its widths is held to the same measure:
 * sized against the page, one in a padded text box ran past the box in Word
 * and LibreOffice alike, since a width in twips is drawn as stated.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../core/generateFromIr';
import type { DocxRendererId } from '../renderers/types';

const RENDERERS: DocxRendererId[] = ['docxjs', 'office-open'];

interface TableXml {
  widthType: string;
  width: number;
  grid: number[];
  /** Each cell's side margins, in document order. */
  margins: Array<{ left: number; right: number }>;
  /** For a table in a cell: the grid around it and that cell's side margins. */
  parent?: { grid: number[]; left: number; right: number };
}

const attribute = (tag: string, name: string): string =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

const margin = (tcMar: string, side: 'left' | 'right'): number =>
  Number(new RegExp(`<w:${side}\\b[^>]*\\bw:w="(\\d+)"`).exec(tcMar)?.[1] ?? 0);

/**
 * Every table in `xml`, outer before inner.
 *
 * A cell's `w:tcMar` comes before its content, so the last one an open table
 * saw belongs to the cell a nested table opens in.
 */
function tables(xml: string): TableXml[] {
  const found: TableXml[] = [];
  const open: Array<{ table: TableXml; left: number; right: number }> = [];
  const token =
    /<w:tbl>|<\/w:tbl>|<w:tblW\b[^>]*>|<w:gridCol\b[^>]*>|<w:tcMar>[\s\S]*?<\/w:tcMar>/g;
  for (const [tag] of xml.matchAll(token)) {
    const current = open.at(-1);
    if (tag === '<w:tbl>') {
      const table: TableXml = {
        widthType: '',
        width: 0,
        grid: [],
        margins: [],
        ...(current
          ? {
              parent: {
                grid: current.table.grid,
                left: current.left,
                right: current.right,
              },
            }
          : {}),
      };
      found.push(table);
      open.push({ table, left: 0, right: 0 });
    } else if (tag === '</w:tbl>') {
      open.pop();
    } else if (!current) {
      continue;
    } else if (tag.startsWith('<w:tblW')) {
      current.table.widthType = attribute(tag, 'w:type');
      current.table.width = Number(attribute(tag, 'w:w'));
    } else if (tag.startsWith('<w:gridCol')) {
      current.table.grid.push(Number(attribute(tag, 'w:w')));
    } else {
      current.left = margin(tag, 'left');
      current.right = margin(tag, 'right');
      current.table.margins.push({ left: current.left, right: current.right });
    }
  }
  return found;
}

/** The page less its side margins and gutter, as the section states them. */
function textWidth(xml: string): number {
  const size = /<w:pgSz\b[^>]*>/.exec(xml)![0];
  const margins = /<w:pgMar\b[^>]*>/.exec(xml)![0];
  return (
    Number(attribute(size, 'w:w')) -
    Number(attribute(margins, 'w:left')) -
    Number(attribute(margins, 'w:right')) -
    Number(attribute(margins, 'w:gutter') || 0)
  );
}

async function documentXml(
  children: unknown[],
  renderer: DocxRendererId
): Promise<string> {
  const { buffer } = await generateBufferViaIr(
    {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          // A gutter the text width has to give up, besides the margins.
          props: { page: { margins: { gutter: 720 } } },
          children,
        },
      ],
    } as never,
    { renderer }
  );
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

/** A table whose columns state no width: a percentage-width table. */
const table = (headers: string[]) => ({
  name: 'table',
  props: {
    columns: headers.map((header) => ({
      header: { content: header },
      cells: [{ content: header.toLowerCase() }],
    })),
  },
});

const paragraph = (text: string) => ({ name: 'paragraph', props: { text } });

/** A text box 300px wide, floated so its own width counts. */
const floatingBox = (children: unknown[]) => ({
  name: 'text-box',
  props: {
    width: 300,
    floating: {
      horizontalPosition: { relative: 'margin', align: 'left' },
      verticalPosition: { relative: 'paragraph', offset: 0 },
    },
  },
  children,
});

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe.each(RENDERERS)('table grid on %s', (renderer) => {
  it('fills the text width, gutter out, in whole twips', async () => {
    const xml = await documentXml([table(['A', 'B', 'C', 'D'])], renderer);
    const [only] = tables(xml);
    const measure = textWidth(xml);

    expect(xml).toMatch(/w:gutter="720"/);
    expect(only.widthType).toBe('pct');
    expect(only.grid).toHaveLength(4);
    for (const column of only.grid) {
      expect(Number.isInteger(column)).toBe(true);
      expect(Math.abs(column - measure / 4)).toBeLessThan(1);
    }
    expect(sum(only.grid)).toBe(measure);
  });

  it("fills a nested table's cell less the cell's margins", async () => {
    const xml = await documentXml(
      [
        {
          name: 'text-box',
          props: { style: { padding: { left: 36, right: 54 } } },
          children: [table(['A', 'B', 'C'])],
        },
      ],
      renderer
    );
    const [box, nested] = tables(xml);
    const measure = textWidth(xml);

    // The text box is a one-cell table as wide as the measure.
    expect(box.grid).toEqual([measure]);
    expect(nested.parent).toEqual({ grid: [measure], left: 720, right: 1080 });
    expect(nested.widthType).toBe('pct');
    expect(nested.grid).toHaveLength(3);
    for (const column of nested.grid) {
      expect(Number.isInteger(column)).toBe(true);
    }
    expect(sum(nested.grid)).toBe(measure - 720 - 1080);
  });

  it("sets a table's stated percentages against the box it is in", async () => {
    const xml = await documentXml(
      [
        {
          name: 'text-box',
          props: { style: { padding: { left: 72, right: 72 } } },
          children: [
            {
              name: 'table',
              props: {
                columns: ['A', 'B'].map((header) => ({
                  width: '50%',
                  header: { content: header },
                  cells: [{ content: header.toLowerCase() }],
                })),
              },
            },
          ],
        },
      ],
      renderer
    );
    const [, nested] = tables(xml);
    const content = textWidth(xml) - 1440 - 1440;

    // Stated widths are twips, which no reader rescales to the box.
    expect(nested.widthType).toBe('dxa');
    expect(nested.width).toBe(content);
    expect(nested.grid).toEqual([content / 2, content / 2]);
  });

  it('sets nested columns and the gaps between them against the box', async () => {
    const xml = await documentXml(
      [
        floatingBox([
          {
            name: 'columns',
            props: { columns: 2, gap: '10%' },
            children: [paragraph('Left.'), paragraph('Right.')],
          },
        ]),
      ],
      renderer
    );
    const [box, columns] = tables(xml);

    // 300px at 96 DPI, split in two, with a 10% gap halved either side of
    // the boundary: 450 twips of a 4500-twip box, not of the page.
    expect(box.grid).toEqual([4500]);
    expect(columns.grid).toEqual([2250, 2250]);
    expect(columns.margins).toEqual([
      { left: 0, right: 225 },
      { left: 225, right: 0 },
    ]);
  });
});

/**
 * Table semantics through the office-open backend: emitted, or refused.
 *
 * The backend has no table-level border, fill or inset — all three are cell
 * properties there — so "supported" means the adapter pushes them onto every
 * cell, and "unsupported" means the capability is left out and the document
 * fails before any bytes exist. Anything in between is content going missing
 * from a deck that looks complete, which is what #260 was.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

function deck(tableProps: Record<string, unknown>) {
  return {
    name: 'pptx',
    props: { title: 'Tables' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'table',
            props: {
              x: 1,
              y: 1,
              w: 6,
              rows: [
                ['Header A', 'Header B'],
                ['Body A', 'Body B'],
              ],
              ...tableProps,
            },
          },
        ],
      },
    ],
  } as unknown as PresentationComponentDefinition;
}

async function officeOpenSlide(
  tableProps: Record<string, unknown>
): Promise<string> {
  const { buffer } = await generateBufferViaIr(deck(tableProps) as never, {
    renderer: 'office-open',
  });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

function refuses(
  tableProps: Record<string, unknown>
): Promise<{ buffer: Buffer }> {
  return generateBufferViaIr(deck(tableProps) as never, {
    renderer: 'office-open',
  }) as Promise<{ buffer: Buffer }>;
}

describe('office-open tables: what it emits', () => {
  it('draws a uniform border on every cell edge', async () => {
    const xml = await officeOpenSlide({
      border: { type: 'solid', pt: 2, color: 'FF0000' },
    });

    // Four cells × four edges. The backend's own table-level `borders` reach
    // only the outer cells, which is a frame rather than a grid.
    for (const edge of ['a:lnL', 'a:lnR', 'a:lnT', 'a:lnB']) {
      expect(xml.split(`<${edge} `).length - 1).toBe(4);
    }
    expect(xml).toContain('w="25400"');
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });

  it('spells a dotted border in the dash vocabulary the backend reads', async () => {
    const xml = await officeOpenSlide({ border: { type: 'dot', pt: 1 } });

    expect(xml).toContain('<a:prstDash val="sysDot"/>');
  });

  it('draws no border at all for type none', async () => {
    const xml = await officeOpenSlide({ border: { type: 'none' } });

    expect(xml).not.toContain('<a:lnL');
  });

  it('fills every cell with the table fill', async () => {
    const xml = await officeOpenSlide({ fill: '00FF00' });

    expect(xml.split('<a:srgbClr val="00FF00"/>').length - 1).toBe(4);
  });

  it('lets a cell fill override the table fill', async () => {
    const xml = await officeOpenSlide({
      fill: '00FF00',
      rows: [
        [{ text: 'Own', fill: '0000FF' }, 'Inherited'],
        ['Inherited', 'Inherited'],
      ],
    });

    expect(xml).toContain('<a:srgbClr val="0000FF"/>');
    expect(xml.split('<a:srgbClr val="00FF00"/>').length - 1).toBe(3);
  });
});

describe('office-open tables: what it refuses', () => {
  it('refuses rounded corners', async () => {
    await expect(refuses({ borderRadius: 0.2 })).rejects.toThrow(
      /table-rounded-corners/
    );
  });

  it('refuses auto-pagination', async () => {
    await expect(refuses({ autoPage: true })).rejects.toThrow(
      /table-auto-page/
    );
  });

  it('refuses a repeated header row', async () => {
    await expect(
      refuses({ autoPage: true, autoPageRepeatHeader: true })
    ).rejects.toThrow(/table-auto-page/);
  });

  it('refuses cell insets', async () => {
    await expect(refuses({ margin: 6 })).rejects.toThrow(/table-insets/);
  });

  it('refuses a cell-level inset too', async () => {
    await expect(
      refuses({ rows: [[{ text: 'Padded', margin: 6 }, 'Plain']] })
    ).rejects.toThrow(/table-insets/);
  });

  it('names the IR path in the refusal', async () => {
    await expect(refuses({ borderRadius: 0.2 })).rejects.toThrow(
      /slides\[0\]\.elements\[0\]\.borderRadius/
    );
  });

  it('names the repeated-header field in its refusal', async () => {
    await expect(refuses({ autoPageRepeatHeader: true })).rejects.toThrow(
      /slides\[0\]\.elements\[0\]\.autoPageRepeatHeader/
    );
  });

  it('names the exact padded cell in its refusal', async () => {
    await expect(
      refuses({ rows: [['Plain', { text: 'Padded', margin: 6 }]] })
    ).rejects.toThrow(/slides\[0\]\.elements\[0\]\.rows\[0\]\[1\]\.margin/);
  });
});

describe('office-open tables: semantic identity values', () => {
  it.each([
    ['zero corner radius', { borderRadius: 0 }],
    ['unit column span', { rows: [[{ text: 'One', colspan: 1 }]] }],
    ['unit row span', { rows: [[{ text: 'One', rowspan: 1 }]] }],
  ])('accepts %s', async (_name, props) => {
    const xml = await officeOpenSlide(props);
    expect(xml).toContain('<a:tbl>');
  });

  it.each([
    ['a real column span', { rows: [[{ text: 'Two', colspan: 2 }]] }],
    ['a real row span', { rows: [[{ text: 'Two', rowspan: 2 }], ['Next']] }],
  ])('still refuses %s', async (_name, props) => {
    await expect(refuses(props)).rejects.toThrow(/table-merged-cells/);
  });
});

describe('pptxgenjs still supports all of them', () => {
  it.each([
    ['rounded corners', { borderRadius: 0.2 }],
    ['auto-pagination', { autoPage: true, autoPageRepeatHeader: true }],
    ['cell insets', { margin: 6 }],
  ])('renders %s', async (_name, props) => {
    const { buffer } = await generateBufferViaIr(deck(props) as never, {
      renderer: 'pptxgenjs',
    });

    expect(buffer.length).toBeGreaterThan(0);
  });
});

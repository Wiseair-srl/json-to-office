/**
 * What a table looks like before anyone styles one.
 *
 * A PPTX table used to draw as bare text in columns: no rule between cells and
 * nothing marking the first row, so every deck restated the same properties to
 * get something presentable. The bundled themes now answer for that, and the
 * first row is a header unless the document says otherwise.
 *
 * The precedence is the part worth pinning: every piece of the header
 * treatment yields to something the author actually said.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';
import type { PptxIrTableElement } from '../types';

async function table(
  props: Record<string, unknown>,
  deckProps: Record<string, unknown> = {}
): Promise<PptxIrTableElement> {
  const { ir } = await compileDocumentToIr({
    name: 'pptx',
    props: { title: 'Tables', ...deckProps },
    children: [
      {
        name: 'slide',
        children: [
          {
            name: 'table',
            props: {
              x: 0.5,
              y: 0.5,
              w: 6,
              rows: [
                ['Metric', 'Value'],
                ['Revenue', '1.2M'],
              ],
              ...props,
            },
          },
        ],
      },
    ],
  } as unknown as PresentationComponentDefinition);
  return ir.slides[0].elements[0] as PptxIrTableElement;
}

describe('a table with nothing said about it', () => {
  it('draws a border', async () => {
    const element = await table({});

    // Without this a table is text in columns with no rule anywhere.
    expect(element.border).toBeDefined();
    expect(element.border?.type).toBe('solid');
  });

  it('sets the first row apart from the body', async () => {
    const element = await table({});

    const [header, body] = element.rows;
    expect(header.cells[0].formatting?.bold).toBe(true);
    expect(header.cells[0].fill).toBeDefined();
    expect(body.cells[0].formatting?.bold).toBeUndefined();
    expect(body.cells[0].fill).toBeUndefined();
  });

  it('asks for no capability a backend might refuse', async () => {
    // `margin` is deliberately not a theme default: cell insets are a
    // capability `office-open` does not have, and a default every table
    // inherits would make that backend refuse every table.
    const element = await table({});

    expect(element.defaults.insetPoints).toBeUndefined();
  });
});

describe('the header row yields to what the author said', () => {
  it('leaves the first row alone when headerRow is off', async () => {
    const element = await table({ headerRow: false });

    expect(element.rows[0].cells[0].formatting?.bold).toBeUndefined();
    expect(element.rows[0].cells[0].fill).toBeUndefined();
  });

  it('keeps a table-wide fill on the header too', async () => {
    const element = await table({ fill: '00FF00' });

    // "This table is green" is a statement about the header as much as the
    // body, so the automatic header band does not overrule it.
    expect(element.rows[0].cells[0].fill).toBeUndefined();
    expect(element.fill?.hex).toBe('00FF00');
  });

  it('keeps a cell that fills itself', async () => {
    const element = await table({
      rows: [
        [{ text: 'Own', fill: '0000FF' }, 'Plain'],
        ['Body', 'Body'],
      ],
    });

    expect(element.rows[0].cells[0].fill?.hex).toBe('0000FF');
    // Its neighbour, which said nothing, still takes the header band.
    expect(element.rows[0].cells[1].fill).toBeDefined();
  });

  it('keeps a cell that sets its own weight', async () => {
    const element = await table({
      rows: [
        [{ text: 'Light', bold: false }, 'Plain'],
        ['Body', 'Body'],
      ],
    });

    expect(element.rows[0].cells[0].formatting?.bold).toBe(false);
    expect(element.rows[0].cells[1].formatting?.bold).toBe(true);
  });

  it('lets a document turn the whole thing off through the theme', async () => {
    const element = await table(
      {},
      {
        componentDefaults: {
          table: { headerRow: false, border: { type: 'none' } },
        },
      }
    );

    expect(element.rows[0].cells[0].formatting?.bold).toBeUndefined();
    // A stated `none` is a border that draws nothing, not an absent one.
    expect(element.border?.type).toBe('none');
  });
});

/**
 * Table parity between the legacy pipeline and the IR pipeline.
 *
 * Tables are where the two pipelines were most at risk of diverging: PptxGenJS
 * cascades table-level formatting into cells, uses a different unit threshold
 * from the rest of its API, and has no rounded corners, so the pipeline drew
 * them with extra shapes. All three now live on the adapter side, and these
 * tests are what says so.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../../../core/generator';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

async function slideXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('ppt/slides/slide1.xml');
  if (!entry) throw new Error('ppt/slides/slide1.xml missing');
  return entry.async('string');
}

async function expectSameSlide(
  document: PresentationComponentDefinition
): Promise<void> {
  const legacy = (await generateBufferFromJson(
    structuredClone(document) as never
  )) as Buffer;
  const { buffer: ir } = await generateBufferViaIr(
    structuredClone(document) as never
  );
  expect(await slideXml(ir)).toBe(await slideXml(legacy));
}

const table = (props: Record<string, unknown>): unknown => ({
  name: 'table',
  props,
});

const deck = (children: unknown[]): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Tables' },
    children: [{ name: 'slide', props: {}, children }],
  }) as PresentationComponentDefinition;

describe('table parity', () => {
  it('matches for a plain string table', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['Name', 'Value'],
            ['Alpha', '1'],
            ['Beta', '2'],
          ],
          x: 0.5,
          y: 0.5,
          w: 6,
        }),
      ])
    );
  });

  it('matches for table-level formatting cascading into cells', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
          x: 1,
          y: 1,
          w: 5,
          fontSize: 14,
          fontFace: 'Georgia',
          color: 'primary',
          align: 'center',
          valign: 'top',
          margin: 6,
        }),
      ])
    );
  });

  it('matches for per-cell formatting overrides', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            [
              { text: 'Header', bold: true, fill: 'primary', color: 'FFFFFF' },
              { text: 'Right', align: 'right', valign: 'bottom' },
            ],
            [{ text: 'Body', fontSize: 10, italic: true }, { text: 'Plain' }],
          ],
          x: 1,
          y: 1,
          w: 6,
        }),
      ])
    );
  });

  it('matches for a cell overriding a table-level bold with false', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            [{ text: 'bold by default' }, { text: 'not bold', bold: false }],
          ],
          x: 1,
          y: 1,
          w: 5,
          fontWeight: 700,
        }),
      ])
    );
  });

  it('matches for a non-RIBBI table font weight', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [['light'], ['weight']],
          x: 1,
          y: 1,
          w: 4,
          fontFace: 'Inter',
          fontWeight: 300,
        }),
      ])
    );
  });

  it('matches for explicit column widths and row heights', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['a', 'b', 'c'],
            ['d', 'e', 'f'],
          ],
          x: 0.5,
          y: 0.5,
          colW: [1.5, 2, 2.5],
          rowH: [0.5, 0.4],
        }),
      ])
    );
  });

  it('matches for a single numeric column width', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['a', 'b'],
            ['c', 'd'],
          ],
          x: 0.5,
          y: 0.5,
          colW: 2,
        }),
      ])
    );
  });

  it('matches for merged cells', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            [{ text: 'spans two', colspan: 2 }],
            [{ text: 'tall', rowspan: 2 }, { text: 'x' }],
            [{ text: 'y' }],
          ],
          x: 1,
          y: 1,
          w: 6,
        }),
      ])
    );
  });

  it('matches for a table border and fill', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['a', 'b'],
            ['c', 'd'],
          ],
          x: 1,
          y: 1,
          w: 5,
          border: { type: 'solid', pt: 2, color: 'primary' },
          fill: 'F5F5F5',
        }),
      ])
    );
  });

  it('matches for emoji-prone characters forced to text presentation', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['✓ done', '✗ failed'],
            ['★ starred', 'plain'],
          ],
          x: 1,
          y: 1,
          w: 5,
        }),
      ])
    );
  });

  it('matches for auto-paging options', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['h1', 'h2'],
            ['a', 'b'],
            ['c', 'd'],
          ],
          x: 1,
          y: 1,
          w: 5,
          autoPage: true,
          autoPageRepeatHeader: true,
        }),
      ])
    );
  });

  it('matches for a rounded-corner table', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            [
              { text: 'Header', fill: 'primary' },
              { text: 'Two', fill: 'primary' },
            ],
            [
              { text: 'a', fill: 'FFFFFF' },
              { text: 'b', fill: 'FFFFFF' },
            ],
            [
              { text: 'c', fill: 'FFFFFF' },
              { text: 'd', fill: 'FFFFFF' },
            ],
          ],
          x: 1,
          y: 1,
          colW: [2, 3],
          rowH: [0.5, 0.4, 0.4],
          borderRadius: 0.15,
          border: { type: 'solid', pt: 1, color: 'DDDDDD' },
        }),
      ])
    );
  });

  it('matches for a rounded table with a table-level fill', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [[{ text: 'H', fill: 'secondary' }], [{ text: 'b' }]],
          x: 0.5,
          y: 0.5,
          colW: [4],
          rowH: 0.5,
          fill: 'FAFAFA',
          borderRadius: 0.2,
        }),
      ])
    );
  });

  it('matches for a table with no explicit width or height', async () => {
    await expectSameSlide(
      deck([
        table({
          rows: [
            ['a', 'b'],
            ['c', 'd'],
          ],
          x: 0.5,
          y: 0.5,
        }),
      ])
    );
  });
});

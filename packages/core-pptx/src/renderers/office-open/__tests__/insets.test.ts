/**
 * Which edge a four-value inset belongs to.
 *
 * The authoring schema states `[top, right, bottom, left]` — CSS's order — and
 * the IR carries the tuple through unchanged. The office-open adapter used to
 * read it as `[left, top, right, bottom]`, and PptxGenJS's *text* path reads
 * the same four numbers as `[left, right, bottom, top]`, so both rotated an
 * asymmetric text box by a side (#261). Symmetric values hide it, which is why
 * every fixture here is four distinct numbers.
 *
 * Table cells are a different story: PptxGenJS writes `a:tcPr/@marL` and reads
 * the tuple in the schema's order already, while office-open can only write a
 * cell's insets onto its `a:bodyPr`, where nothing reads them — so it refuses
 * instead.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

/** Points → EMU, the unit `a:bodyPr` and `a:tcPr` insets are written in. */
const emu = (points: number) => String(Math.round(points * 12700));

function deck(children: unknown[]): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'Insets' },
    children: [{ name: 'slide', props: {}, children }],
  } as unknown as PresentationComponentDefinition;
}

async function slideXml(
  document: PresentationComponentDefinition,
  renderer: 'pptxgenjs' | 'office-open'
): Promise<string> {
  const { buffer } = await generateBufferViaIr(document as never, { renderer });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

/**
 * The insets of the first text body, or of the first table cell.
 *
 * Two different elements carry them: `a:bodyPr` states a text body's as
 * `lIns`/`tIns`, `a:tcPr` states a cell's as `marL`/`marT`. Matching the
 * element by name matters — a paragraph's `marL` is an indent, not padding.
 */
function insets(xml: string, kind: 'body' | 'cell'): Record<string, string> {
  const pattern =
    kind === 'body'
      ? /<a:bodyPr[^>]*?[lrtb]Ins="[^"]*"[^>]*>/
      : /<a:tcPr[^>]*?mar[LRTB]="[^"]*"[^>]*>/;
  const element = pattern.exec(xml);
  if (!element) throw new Error(`no ${kind} insets in the slide`);
  return Object.fromEntries(
    [...element[0].matchAll(/([lrtb]Ins|mar[LRTB])="([^"]*)"/g)].map((m) => [
      m[1],
      m[2],
    ])
  );
}

const textBox = (margin: unknown) => ({
  name: 'text',
  props: { text: 'Inset', x: 1, y: 1, w: 4, h: 1, margin },
});

describe.each(['pptxgenjs', 'office-open'] as const)(
  '%s text body insets',
  (renderer) => {
    it('reads a four-value margin as top, right, bottom, left', async () => {
      const xml = await slideXml(deck([textBox([1, 2, 3, 4])]), renderer);

      expect(insets(xml, 'body')).toEqual({
        tIns: emu(1),
        rIns: emu(2),
        bIns: emu(3),
        lIns: emu(4),
      });
    });

    it('applies a scalar margin to every side', async () => {
      const xml = await slideXml(deck([textBox(5)]), renderer);

      expect(insets(xml, 'body')).toEqual({
        tIns: emu(5),
        rIns: emu(5),
        bIns: emu(5),
        lIns: emu(5),
      });
    });
  }
);

describe('table cell insets', () => {
  const table = deck([
    {
      name: 'table',
      props: { x: 1, y: 1, w: 6, rows: [['a', 'b']], margin: [1, 2, 3, 4] },
    },
  ]);

  it('reaches a PptxGenJS cell in the same order', async () => {
    const xml = await slideXml(table, 'pptxgenjs');

    expect(insets(xml, 'cell')).toEqual({
      marT: emu(1),
      marR: emu(2),
      marB: emu(3),
      marL: emu(4),
    });
  });

  it('is refused by office-open rather than written where nothing reads it', async () => {
    await expect(
      generateBufferViaIr(table as never, { renderer: 'office-open' })
    ).rejects.toThrow(/table-insets/);
  });
});

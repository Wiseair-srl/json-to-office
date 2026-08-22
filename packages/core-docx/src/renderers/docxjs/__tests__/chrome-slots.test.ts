/**
 * Header and footer slots the docx.js adapter has to see.
 *
 * `DocxIrHeaderFooterSet` has three slots — `default`, `first`, `even` — and
 * the adapter used to read only the first of them in two places: the walk that
 * collects image placements so SVGs can be rastered, and the section options
 * that turn a part into a `Header`. The first gap shipped an SVG's own bytes
 * labelled `image/png` as the raster fallback; the second dropped the part
 * outright (#256).
 *
 * The compiler emits only `default` today, so the IR here is a compiled
 * document with its chrome moved into the slot under test — real IR, in the
 * shape the adapter has to survive.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { compileDocumentToIr } from '../../../core/generateFromIr';
import { createDocxJsRenderer } from '../index';
import type { DocxIR, DocxIrHeaderFooter } from '../../../ir/types';
import type { ReportComponentDefinition } from '../../../types';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24">' +
  '<rect width="48" height="24" fill="#3366cc"/></svg>';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** A document whose only image lives in the section header. */
const document: ReportComponentDefinition = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'section',
      props: {
        header: [{ name: 'image', props: { svg: SVG, width: 1, height: 0.5 } }],
      },
      children: [{ name: 'paragraph', props: { text: 'Body' } }],
    },
  ],
} as unknown as ReportComponentDefinition;

/** Move a section's compiled chrome from `default` into another slot. */
function moveChrome(ir: DocxIR, slot: 'first' | 'even'): DocxIR {
  return {
    ...ir,
    sections: ir.sections.map((section) => {
      const part: DocxIrHeaderFooter | undefined = section.headers?.default;
      if (!part) return section;
      return { ...section, headers: { [slot]: part } };
    }),
  };
}

async function renderParts(ir: DocxIR): Promise<JSZip> {
  const renderer = createDocxJsRenderer();
  const bytes = await renderer.render(ir);
  return JSZip.loadAsync(Buffer.from(bytes));
}

describe.each(['default', 'first', 'even'] as const)(
  'an SVG in the %s header',
  (slot) => {
    it('ships a real raster fallback', async () => {
      const compiled = await compileDocumentToIr(document);
      const ir =
        slot === 'default' ? compiled.ir : moveChrome(compiled.ir, slot);

      const zip = await renderParts(ir);
      const media = Object.keys(zip.files).filter((name) =>
        name.startsWith('word/media/')
      );

      // Two parts: the vector and the raster Word before 2016 draws instead.
      const pngs = media.filter((name) => name.endsWith('.png'));
      expect(pngs.length).toBeGreaterThan(0);

      for (const name of pngs) {
        const bytes = await zip.file(name)!.async('nodebuffer');
        expect(bytes.subarray(0, 4)).toEqual(PNG_SIGNATURE);
      }
    });

    it('emits the part rather than dropping it', async () => {
      const compiled = await compileDocumentToIr(document);
      const ir =
        slot === 'default' ? compiled.ir : moveChrome(compiled.ir, slot);

      const zip = await renderParts(ir);
      const headers = Object.keys(zip.files).filter((name) =>
        /^word\/header\d+\.xml$/.test(name)
      );

      expect(headers.length).toBeGreaterThan(0);
    });
  }
);

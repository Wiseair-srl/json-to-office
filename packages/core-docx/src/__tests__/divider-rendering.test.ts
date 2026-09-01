/**
 * A `divider` through both backends.
 *
 * A divider is nothing but paragraph properties, so there is no text to
 * compare and the corpus's cross-backend shape check cannot see it at all: a
 * renderer that dropped `w:pBdr` would still produce the same words in the
 * same order. The border is therefore asserted directly, on both, from the
 * same document.
 *
 * `borders` is a declared capability now that `divider` requires it, and a
 * declared capability means "proven by a test" here — this is that proof.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../core/generateFromIr';
import { DOCX_RENDERER_IDS } from '@json-to-office/shared-docx';
import type { ReportComponentDefinition } from '../types';

const DOCUMENT = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'section',
      children: [
        { name: 'paragraph', props: { text: 'Above.' } },
        {
          name: 'divider',
          props: { thickness: 3, color: '#E6620C', width: '40%' },
        },
        { name: 'paragraph', props: { text: 'Below.' } },
      ],
    },
  ],
} as unknown as ReportComponentDefinition;

async function documentXml(renderer: string): Promise<string> {
  const { buffer } = await generateBufferViaIr(structuredClone(DOCUMENT), {
    renderer: renderer as never,
  });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

/** The divider's own `w:pPr` — the empty paragraph between the two texts. */
function dividerPropertiesOf(xml: string): string {
  const paragraphs = xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? [];
  const divider = paragraphs.find((p) => p.includes('<w:pBdr>'));
  expect(divider, 'no paragraph carries a border').toBeDefined();
  return divider!.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)![0];
}

describe('divider rendering', () => {
  it.each(DOCX_RENDERER_IDS)(
    '%s draws the divider as a paragraph border',
    async (renderer) => {
      const properties = dividerPropertiesOf(await documentXml(renderer));

      expect(properties).toMatch(/<w:bottom [^>]*w:val="single"/);
      expect(properties).toMatch(/<w:bottom [^>]*w:color="E6620C"/);
      // 3pt in eighths of a point.
      expect(properties).toMatch(/<w:bottom [^>]*w:sz="24"/);
      // A divider is one line, not a box.
      expect(properties).not.toContain('<w:top ');
      expect(properties).not.toContain('<w:left ');
    }
  );

  it.each(DOCX_RENDERER_IDS)(
    '%s collapses the divider line box',
    async (renderer) => {
      // The whole reason the component exists: without this the divider
      // costs a full line of invisible type, which is what sent the author of
      // #291 looking for the trick on a paragraph that had text in it.
      expect(dividerPropertiesOf(await documentXml(renderer))).toMatch(
        /<w:spacing [^>]*w:line="20"[^>]*w:lineRule="exact"|<w:spacing [^>]*w:lineRule="exact"[^>]*w:line="20"/
      );
    }
  );

  it.each(DOCX_RENDERER_IDS)(
    '%s indents a partial divider',
    async (renderer) => {
      // 40% of the minimal theme's 8506-twip measure leaves 5104 to indent away.
      expect(dividerPropertiesOf(await documentXml(renderer))).toMatch(
        /<w:ind [^>]*w:right="5104"/
      );
    }
  );

  it('renders byte-identical divider properties on both backends', async () => {
    // Not a general claim about the two backends — they disagree about plenty
    // — but this construction is small enough to agree exactly, and saying so
    // is what makes a later divergence visible.
    const [docxjs, officeOpen] = await Promise.all([
      documentXml('docxjs'),
      documentXml('office-open'),
    ]);

    expect(dividerPropertiesOf(docxjs)).toBe(dividerPropertiesOf(officeOpen));
  });
});

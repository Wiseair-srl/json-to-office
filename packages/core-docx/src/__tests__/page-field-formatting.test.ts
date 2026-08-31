/**
 * A page-number field carries its own run properties.
 *
 * docx.js packs `begin`, `instrText`, `separate` and `end` into a single
 * `w:r`. Word reads that; LibreOffice does not — it computes the number itself
 * and paints it with the document default, so an 8pt grey `Page {PAGE}` footer
 * rendered its numeral at 11pt black in every PDF the preview path produces.
 * The fix is one run per field character, each carrying the same `rPr` as the
 * text around it, which is also the shape Word itself writes.
 *
 * A cached result between `separate` and `end` is deliberately *not* written:
 * nothing in this pipeline paginates, so any value there would be a fabricated
 * one, wrong on every page but the first. It is not the fix either — the
 * single-run shape stays wrong in LibreOffice even with a cached result
 * present, which is why these tests pin the run split rather than the result.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

const FOOTER_FONT = {
  family: 'Calibri',
  size: 8,
  color: '#939598',
} as const;

async function footerXml(text: string): Promise<string> {
  const buffer = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        props: {
          footer: [{ name: 'paragraph', props: { text, font: FOOTER_FONT } }],
        },
        children: [{ name: 'paragraph', props: { text: 'Body.' } }],
      },
    ],
  } as never);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/footer1.xml')!.async('string');
}

/** Every `w:r` in document order, with its inner XML. */
function runs(xml: string): string[] {
  return xml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? [];
}

/** The `w:rPr` block of a run, or undefined when it carries none. */
function properties(run: string): string | undefined {
  return run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0];
}

describe('page-number field formatting', () => {
  it('splits the field across runs that each carry the run properties', async () => {
    const xml = await footerXml('Page {PAGE}');
    const all = runs(xml);

    const text = all.find((run) => run.includes('<w:t'));
    expect(text, 'no text run in the footer').toBeDefined();
    const expected = properties(text!);
    expect(expected, 'the text run carries no properties').toBeDefined();
    // The formatting actually asked for, so a theme change cannot quietly
    // satisfy this test with the document default.
    expect(expected).toContain('<w:sz w:val="16"/>');
    expect(expected).toContain('<w:color w:val="939598"/>');

    const field = all.filter(
      (run) => run.includes('<w:fldChar') || run.includes('<w:instrText')
    );
    // One run per field character: begin, instrText, separate, end. A single
    // run holding all four is the shape that loses its formatting.
    expect(field).toHaveLength(4);
    for (const run of field) {
      expect(properties(run)).toBe(expected);
    }

    expect(field[0]).toContain('<w:fldChar w:fldCharType="begin"/>');
    expect(field[1]).toContain('>PAGE</w:instrText>');
    expect(field[2]).toContain('<w:fldChar w:fldCharType="separate"/>');
    expect(field[3]).toContain('<w:fldChar w:fldCharType="end"/>');
  });

  it('writes no cached result, so no page number is fabricated', async () => {
    const xml = await footerXml('Page {PAGE}');
    const separate = xml.indexOf('<w:fldChar w:fldCharType="separate"/>');
    const end = xml.indexOf('<w:fldChar w:fldCharType="end"/>', separate);
    expect(separate).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(separate);
    // Between the two lies the field result. Nothing in this pipeline
    // paginates, so it stays empty and every reader computes the number.
    expect(xml.slice(separate, end)).not.toMatch(/<w:t[ >]/);
  });

  it('gives PAGE and TOTAL_PAGES in one paragraph a field each', async () => {
    const xml = await footerXml('Page {PAGE} of {TOTAL_PAGES}');
    const instructions = [...xml.matchAll(/<w:instrText[^>]*>([^<]*)</g)].map(
      (match) => match[1]
    );
    expect(instructions).toEqual(['PAGE', 'NUMPAGES']);
    expect(runs(xml).filter((run) => run.includes('<w:fldChar'))).toHaveLength(
      6
    );
  });
});

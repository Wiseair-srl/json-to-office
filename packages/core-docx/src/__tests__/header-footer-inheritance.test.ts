/**
 * Which sections inherit page chrome, and which break the link.
 *
 * Word inherits a section's header from the previous section whenever the
 * section carries no `w:headerReference` of its own, so breaking the link needs
 * an explicit reference to a part — an empty one will do. The authoring surface
 * spells inheritance `'linkToPrevious'`; everything else, including an omitted
 * header after a section that had one, is a statement about *this* section and
 * has to produce a part.
 *
 * Disabling every component in a header is such a statement, and it used to
 * compile to inheritance instead (#253).
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import type { ReportComponentDefinition } from '../types';

/** Each `w:sectPr`'s header/footer references, in section order. */
async function sectionReferences(
  buffer: Buffer,
  kind: 'header' | 'footer'
): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')!.async('string');
  const tag = `w:${kind}Reference`;

  return [...documentXml.matchAll(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g)].map(
    (match) =>
      [...match[0].matchAll(new RegExp(`<${tag}[^>]*>`, 'g'))].map((m) => m[0])
  );
}

const paragraph = (text: string) => ({ name: 'paragraph', props: { text } });

const disabled = (text: string) => ({
  name: 'paragraph',
  enabled: false,
  props: { text },
});

/**
 * Two sections: the first always carries visible chrome, the second is the
 * case under test.
 */
function twoSections(
  kind: 'header' | 'footer',
  second: unknown
): ReportComponentDefinition {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        props: { [kind]: [paragraph('First section chrome')] },
        children: [paragraph('Body one')],
      },
      {
        name: 'section',
        props: second === undefined ? {} : { [kind]: second },
        children: [paragraph('Body two')],
      },
    ],
  } as unknown as ReportComponentDefinition;
}

describe.each(['header', 'footer'] as const)('%s inheritance', (kind) => {
  it('breaks the link when every supplied component is disabled', async () => {
    const buffer = await generateBufferFromJson(
      twoSections(kind, [disabled('Draft watermark')]) as never
    );

    const references = await sectionReferences(buffer as Buffer, kind);
    expect(references).toHaveLength(2);
    // A reference of its own is the whole point: without one the section shows
    // the first section's chrome, which is what the author disabled.
    expect(references[1].length).toBeGreaterThan(0);
    expect(references[1]).not.toEqual(references[0]);
  });

  it('breaks the link on an explicit empty array', async () => {
    const buffer = await generateBufferFromJson(twoSections(kind, []) as never);

    const references = await sectionReferences(buffer as Buffer, kind);
    expect(references[1].length).toBeGreaterThan(0);
    expect(references[1]).not.toEqual(references[0]);
  });

  it('inherits only when the section asks to link to the previous', async () => {
    const buffer = await generateBufferFromJson(
      twoSections(kind, 'linkToPrevious') as never
    );

    const references = await sectionReferences(buffer as Buffer, kind);
    // Linking repeats the previous content, which the pipeline realises by
    // compiling the same components again — so the section does carry a
    // reference, and the part behind it is not empty.
    expect(references[1].length).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(buffer as Buffer);
    const parts = await Promise.all(
      zip
        .file(new RegExp(`word/${kind}\\d+\\.xml`))
        .map((file) => file.async('string'))
    );
    expect(
      parts.filter((xml) => xml.includes('First section chrome'))
    ).toHaveLength(2);
  });

  it('still emits the part for a section whose chrome is active', async () => {
    const buffer = await generateBufferFromJson(
      twoSections(kind, [paragraph('Second section chrome')]) as never
    );

    const references = await sectionReferences(buffer as Buffer, kind);
    expect(references[1].length).toBeGreaterThan(0);
    expect(references[1]).not.toEqual(references[0]);
  });

  it('leaves a disabled-only part empty rather than repeating the first', async () => {
    const buffer = await generateBufferFromJson(
      twoSections(kind, [disabled('Draft watermark')]) as never
    );

    const zip = await JSZip.loadAsync(buffer as Buffer);
    const parts = await Promise.all(
      zip
        .file(new RegExp(`word/${kind}\\d+\\.xml`))
        .map((file) => file.async('string'))
    );

    expect(parts.some((xml) => xml.includes('First section chrome'))).toBe(
      true
    );
    expect(parts.some((xml) => xml.includes('Draft watermark'))).toBe(false);
    // One part per section: the empty one exists, which is what carries the
    // break.
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });
});

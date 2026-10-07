/**
 * Page numbers in a table of contents, from `docx/layout` (docx 9.9.0).
 *
 * A document with a contents field is laid out at render time, and the page
 * each entry's heading is on is written into the entry's `PAGEREF`. Only such
 * a document loads `docx/layout`; a layout that throws leaves the field
 * without numbers and says so, rather than failing the document.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { GenerationWarning } from '@json-to-office/shared';
import { CORPUS } from '../../../__tests__/fixtures/corpus';

const CODE = 'W_DOCX_PAGE_NUMBERS_UNAVAILABLE';

function corpusDocument(name: string): Record<string, any> {
  const found = CORPUS.find((testCase) => testCase.name === name);
  if (!found) throw new Error(`no corpus case ${name}`);
  return structuredClone(found.document) as Record<string, any>;
}

/** A corpus document with a contents field and a heading in front. */
function withContents(name: string): Record<string, any> {
  const document = corpusDocument(name);
  document.children[0].children.unshift(
    { name: 'toc', props: { title: 'Contents' } },
    { name: 'heading', props: { text: 'A heading', level: 1 } }
  );
  return document;
}

/** Imported fresh per test: the `docx/layout` load is kept per process. */
async function generate(document: unknown): Promise<{
  documentXml: string;
  settingsXml: string;
  warnings: GenerationWarning[];
}> {
  const { generateBufferViaIr } = await import('../../../core/generateFromIr');
  const warnings: GenerationWarning[] = [];
  const { buffer } = await generateBufferViaIr(
    structuredClone(document) as never,
    { renderer: 'docxjs', warnings }
  );
  const zip = await JSZip.loadAsync(buffer);
  return {
    documentXml: await zip.file('word/document.xml')!.async('string'),
    settingsXml: await zip.file('word/settings.xml')!.async('string'),
    warnings,
  };
}

const unavailable = (warnings: GenerationWarning[]) =>
  warnings.filter((warning) => warning.context?.code === CODE);

/** The contents field of a document, entries only. */
function contents(xml: string): string {
  const start = xml.indexOf('<w:sdt>');
  return xml.slice(start, xml.indexOf('</w:sdt>', start));
}

describe('page numbers in a table of contents', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('docx/layout');
  });

  it('writes the page of each heading into its entry', async () => {
    const { documentXml, settingsXml, warnings } = await generate(
      corpusDocument('headings/toc-title-and-page-break')
    );
    const pages = [
      ...contents(documentXml).matchAll(
        /PAGEREF (_Toc\d+) \\h<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">(\d+)<\/w:t>/g
      ),
    ].map(([, bookmark, page]) => [bookmark, page]);
    // The cover is on page 1; the chapters start on page 2.
    expect(pages).toEqual([
      ['_Toc1', '1'],
      ['_Toc2', '2'],
      ['_Toc3', '2'],
      ['_Toc4', '2'],
      ['_Toc5', '2'],
    ]);
    expect(unavailable(warnings)).toEqual([]);
    // Laid out to the end without a guess: Word is not asked to update.
    expect(settingsXml).not.toContain('w:updateFields');
  });

  it('numbers the heading bookmarks per document, clear of jto ids', async () => {
    const document = corpusDocument('headings/toc-scope-sections');
    const first = (await generate(document)).documentXml;
    const second = (await generate(document)).documentXml;
    expect(second).toBe(first);

    const starts = [...first.matchAll(/<w:bookmarkStart ([^>]*)\/>/g)].map(
      ([, attributes]) => ({
        name: /w:name="([^"]*)"/.exec(attributes)![1],
        id: /w:id="(\d+)"/.exec(attributes)![1],
      })
    );
    const contentsBookmarks = starts.filter(({ name }) =>
      name.startsWith('_Toc')
    );
    expect(contentsBookmarks.map(({ name }) => name)).toEqual(
      contentsBookmarks.map((_, index) => `_Toc${index + 1}`)
    );
    expect(contentsBookmarks.map(({ id }) => Number(id))).toEqual(
      contentsBookmarks.map((_, index) => 3_000_001 + index)
    );
    // Every id pairs one start with one end.
    const ids = starts.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const ends = [...first.matchAll(/<w:bookmarkEnd w:id="(\d+)"\/>/g)].map(
      ([, id]) => id
    );
    expect([...ends].sort()).toEqual([...ids].sort());
  });

  it('keeps a numbered heading’s number in its entry', async () => {
    const { documentXml } = await generate(
      corpusDocument('headings/toc-cached-numbered-entries')
    );
    const field = contents(documentXml);
    expect(field).toContain('>1. Introduction<');
    expect(field).toContain('>2.1.1.1. Calibration<');
    expect(field).toContain('>Not Numbered<');
  });

  it('leaves entries their style’s tab stop and ends the field in the last', async () => {
    const { documentXml } = await generate(
      corpusDocument('headings/toc-default')
    );
    const field = contents(documentXml);
    expect(field).not.toContain('<w:tabs>');
    const paragraphs = field.match(/<w:p>[\s\S]*?<\/w:p>/g)!;
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[3]).toMatch(
      /<w:r><w:fldChar w:fldCharType="end"\/><\/w:r><\/w:p>$/
    );
  });

  it.each(['structure/section-empty', 'structure/header-footer-empty'])(
    'renders %s without numbers, and says so, when the layout throws',
    async (name) => {
      // docx 9.9.0's layout throws on an empty header or footer
      // ("elements.filter is not a function").
      const { documentXml, settingsXml, warnings } = await generate(
        withContents(name)
      );
      expect(unavailable(warnings)).toHaveLength(1);
      expect(unavailable(warnings)[0].message).toMatch(
        /elements\.filter is not a function/
      );
      expect(contents(documentXml)).toContain('>A heading<');
      expect(settingsXml).toContain('<w:updateFields/>');
    }
  );

  it('loads docx/layout only for a document with a contents field', async () => {
    let loads = 0;
    vi.doMock('docx/layout', async (importOriginal) => {
      loads++;
      return importOriginal();
    });
    const plain = await generate(
      corpusDocument('structure/header-footer-empty')
    );
    expect(loads).toBe(0);
    expect(plain.settingsXml).toContain('<w:updateFields/>');

    await generate(corpusDocument('headings/toc-default'));
    expect(loads).toBe(1);
  });

  it('renders a contents field without numbers when docx/layout is missing', async () => {
    vi.doMock('docx/layout', () => {
      throw new Error('Package subpath ./layout is not defined by "exports"');
    });
    const { documentXml, settingsXml, warnings } = await generate(
      corpusDocument('headings/toc-default')
    );
    expect(unavailable(warnings)).toHaveLength(1);
    expect(unavailable(warnings)[0].message).toMatch(/docx 9\.9\.0/);
    expect(contents(documentXml)).toContain('>Chapter One<');
    expect(settingsXml).toContain('<w:updateFields/>');
  });
});

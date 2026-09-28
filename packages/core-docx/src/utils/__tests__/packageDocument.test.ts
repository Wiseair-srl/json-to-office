/**
 * Generic DOCX package finalization, on hand-built packages.
 *
 * `canonicalizeDocxBuffer` renames volatile relationship ids and pins every
 * timestamp. These cases build the package by hand so each one isolates a
 * single shape of XML the renderers can emit — the end-to-end behaviour is
 * covered by `__tests__/relationship-ids.test.ts` and the corpus goldens.
 */

import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import {
  canonicalizeDocxBuffer,
  DEFAULT_GENERATION_DATE,
  toDosTime,
} from '../packageDocument';

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

function pack(parts: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, xml] of Object.entries(parts)) {
    zip.addFile(name, Buffer.from(xml, 'utf8'));
  }
  return zip.toBuffer();
}

describe('relationship id canonicalization', () => {
  it('keeps a reference in step with its relationship past an empty attribute', () => {
    // An odd number of empty values ahead of the reference is the case that
    // used to desynchronise a rewrite that paired quotes rather than
    // attributes: the relationship became rId2, the reference stayed put.
    const out = new AdmZip(
      canonicalizeDocxBuffer(
        pack({
          'word/document.xml':
            '<w:document><wp:docPr id="1" name="" descr=""/><wp:cNvPr title=""/>' +
            '<w:hyperlink r:id="rIdabc-xyz"><w:r><w:t>a</w:t></w:r></w:hyperlink></w:document>',
          'word/_rels/document.xml.rels':
            `<Relationships xmlns="${RELS_NS}">` +
            `<Relationship Id="rId1" Type="${HYPERLINK}" Target="https://example.com/x" TargetMode="External"/>` +
            `<Relationship Id="rIdabc-xyz" Type="${HYPERLINK}" Target="https://example.com/a" TargetMode="External"/>` +
            '</Relationships>',
        })
      )
    );

    expect(out.readAsText('word/document.xml')).toContain(
      '<w:hyperlink r:id="rId2">'
    );
    expect(out.readAsText('word/_rels/document.xml.rels')).toContain(
      'Id="rId2" Type'
    );
    expect(out.readAsText('word/_rels/document.xml.rels')).not.toContain(
      'rIdabc-xyz'
    );
  });
});

describe('embedded Office packages', () => {
  // docx.js writes a chart's workbook with the wall clock in every ZIP header,
  // so the same chart rendered a second later used to differ in
  // `word/embeddings/*.xlsx` alone.
  const WALL_CLOCK = toDosTime(new Date('2026-09-28T10:11:12Z'));
  const GENERATED_AT = new Date('2024-01-01T00:00:00Z');
  const CORE =
    '<cp:coreProperties>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-28T10:11:12Z</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-28T10:11:12Z</dcterms:modified>' +
    '</cp:coreProperties>';

  /** A package whose every entry carries the given DOS timestamp. */
  function stamped(
    parts: Record<string, string | Buffer>,
    timeval: number
  ): Buffer {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(parts)) {
      zip.addFile(
        name,
        typeof content === 'string' ? Buffer.from(content, 'utf8') : content
      );
    }
    for (const entry of zip.getEntries()) {
      (entry.header as unknown as { timeval: number }).timeval = timeval;
    }
    return zip.toBuffer();
  }

  const workbook = (timeval: number): Buffer =>
    stamped(
      {
        '[Content_Types].xml': '<Types/>',
        'xl/workbook.xml': '<workbook/>',
        'xl/worksheets/sheet1.xml': `<worksheet>${'<row/>'.repeat(40)}</worksheet>`,
      },
      timeval
    );

  /** A document package carrying the given embedded parts. */
  const outer = (embedded: Record<string, Buffer>): Buffer =>
    stamped({ 'word/document.xml': '<w:document/>', ...embedded }, WALL_CLOCK);

  const embedded = (buffer: Buffer, name: string): AdmZip =>
    new AdmZip(new AdmZip(buffer).getEntry(name)!.getData());

  it('pins the ZIP timestamps inside an embedded workbook', () => {
    const inner = workbook(WALL_CLOCK);
    const out = canonicalizeDocxBuffer(
      outer({ 'word/embeddings/Microsoft_Excel_Worksheet1.xlsx': inner }),
      GENERATED_AT
    );

    const pinned = embedded(
      out,
      'word/embeddings/Microsoft_Excel_Worksheet1.xlsx'
    );
    const before = new Map(
      new AdmZip(inner)
        .getEntries()
        .map((entry) => [entry.entryName, entry.getCompressedData()])
    );
    expect(pinned.getEntries()).toHaveLength(before.size);
    for (const entry of pinned.getEntries()) {
      expect(
        (entry.header as unknown as { timeval: number }).timeval,
        entry.entryName
      ).toBe(toDosTime(GENERATED_AT));
      // Only the headers are rewritten: every compressed stream is the one
      // the writer produced. Compared by name, since the rewrite may reorder
      // the entries.
      expect(
        entry.getCompressedData().equals(before.get(entry.entryName)!),
        entry.entryName
      ).toBe(true);
    }
  });

  it('leaves an embedded package that is already pinned byte for byte', () => {
    // office-open's workbooks are built pinned to the default date, so at
    // that date they must come out exactly as they went in.
    const inner = workbook(toDosTime(DEFAULT_GENERATION_DATE));
    const out = canonicalizeDocxBuffer(
      outer({ 'word/embeddings/chart1.xlsx': inner })
    );

    expect(
      new AdmZip(out).getEntry('word/embeddings/chart1.xlsx')!.getData()
    ).toEqual(inner);
  });

  it('leaves a part that is named like a package but is not one alone', () => {
    const opaque = Buffer.from('not a zip at all', 'utf8');
    const out = canonicalizeDocxBuffer(
      outer({ 'word/embeddings/opaque.xlsx': opaque }),
      GENERATED_AT
    );

    expect(
      new AdmZip(out).getEntry('word/embeddings/opaque.xlsx')!.getData()
    ).toEqual(opaque);
  });

  it('normalizes core properties and packages nested inside a package', () => {
    const deck = stamped(
      {
        'docProps/core.xml': CORE,
        'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx': workbook(WALL_CLOCK),
      },
      WALL_CLOCK
    );
    const out = canonicalizeDocxBuffer(
      outer({
        'word/embeddings/Microsoft_PowerPoint_Presentation1.pptx': deck,
      }),
      GENERATED_AT
    );

    const pptx = embedded(
      out,
      'word/embeddings/Microsoft_PowerPoint_Presentation1.pptx'
    );
    const core = pptx.readAsText('docProps/core.xml');
    expect(core).not.toContain('2026-09-28');
    expect(core.match(/2024-01-01T00:00:00\.000Z/g)).toHaveLength(2);

    const xlsx = new AdmZip(
      pptx.getEntry('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx')!.getData()
    );
    for (const entry of [...pptx.getEntries(), ...xlsx.getEntries()]) {
      expect(
        (entry.header as unknown as { timeval: number }).timeval,
        entry.entryName
      ).toBe(toDosTime(GENERATED_AT));
    }
  });

  it('gives the same bytes on every run', () => {
    const input = outer({
      'word/embeddings/Microsoft_Excel_Worksheet1.xlsx': workbook(WALL_CLOCK),
    });

    expect(
      canonicalizeDocxBuffer(input, GENERATED_AT).equals(
        canonicalizeDocxBuffer(input, GENERATED_AT)
      )
    ).toBe(true);
  });
});

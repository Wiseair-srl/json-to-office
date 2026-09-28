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
import { canonicalizeDocxBuffer } from '../packageDocument';

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

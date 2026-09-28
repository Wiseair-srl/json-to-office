/**
 * The post-pack drawing-group repair, on hand-built packages: which ids it
 * renumbers and in what order, the rotations it rounds, the markers it
 * removes, and the parts it leaves exactly alone.
 */

import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { repairDrawingGroupsInBuffer } from '../drawingGroupRepair';
import { DEFAULT_MARKERS, type DrawingGroupMarkers } from '../drawingGroup';

function pack(parts: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, xml] of Object.entries(parts)) {
    zip.addFile(name, Buffer.from(xml, 'utf8'));
  }
  return zip.toBuffer();
}

function unpack(buffer: Buffer): Record<string, string> {
  const zip = new AdmZip(buffer);
  return Object.fromEntries(
    zip
      .getEntries()
      .map((entry) => [entry.entryName, entry.getData().toString('utf8')])
  );
}

/** A group as docx/shapes writes it, with the child ids it happened to draw. */
const groupXml = (docPrId: number, childIds: number[], extra = ''): string =>
  `<w:drawing><wp:inline><wp:docPr id="${docPrId}" name=""/><a:graphic><a:graphicData><wpg:wgp><wpg:cNvGrpSpPr/>` +
  childIds
    .map(
      (id) =>
        `<wps:wsp><wps:cNvPr id="${id}" name="Shape ${id}"/><wps:cNvSpPr/></wps:wsp>`
    )
    .join('') +
  extra +
  `</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>`;

const imageXml = (docPrId: number): string =>
  `<w:drawing><wp:inline><wp:docPr id="${docPrId}" name=""/><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name=""/></pic:nvPicPr></pic:pic></wp:inline></w:drawing>`;

const idsOf = (xml: string): string[] =>
  [
    ...xml.matchAll(/<(?:wp:docPr|wps:cNvPr|pic:cNvPr|wpg:cNvPr) id="(\d+)"/g),
  ].map((match) => match[1]);

describe('repairDrawingGroupsInBuffer', () => {
  it('numbers group children after every other drawing id, in part order', () => {
    const repaired = unpack(
      repairDrawingGroupsInBuffer(
        pack({
          'word/footer1.xml': groupXml(5, [700]),
          'word/header10.xml': groupXml(4, [600, 601]),
          'word/document.xml': groupXml(1, [900, 901]) + imageXml(2),
          'word/header2.xml': imageXml(3) + groupXml(6, [500]),
          'word/styles.xml': '<w:styles/>',
        }),
        DEFAULT_MARKERS
      )
    );
    // The highest drawing id outside a group is wp:docPr 6, so children
    // start at 7: document, then header2 before header10, then footer1.
    expect(idsOf(repaired['word/document.xml'])).toEqual([
      '1',
      '7',
      '8',
      '2',
      '0',
    ]);
    expect(idsOf(repaired['word/header2.xml'])).toEqual(['3', '0', '6', '9']);
    expect(idsOf(repaired['word/header10.xml'])).toEqual(['4', '10', '11']);
    expect(idsOf(repaired['word/footer1.xml'])).toEqual(['5', '12']);
  });

  it('starts after a cNvPr outside any group when that is the highest id', () => {
    const repaired = unpack(
      repairDrawingGroupsInBuffer(
        pack({
          'word/document.xml':
            groupXml(1, [3]) +
            '<wps:wsp><wps:cNvPr id="40" name=""/></wps:wsp>',
        }),
        DEFAULT_MARKERS
      )
    );
    expect(idsOf(repaired['word/document.xml'])).toEqual(['1', '41', '40']);
  });

  it('rounds rotations to whole units without wrapping them', () => {
    const xml = repairDrawingGroupsInBuffer(
      pack({
        'word/document.xml': groupXml(
          1,
          [2],
          '<wps:wsp><wps:spPr><a:xfrm flipH="true" rot="427407.36"/></wps:spPr></wps:wsp>' +
            '<wps:wsp><wps:spPr><a:xfrm rot="-1800000"/></wps:spPr></wps:wsp>' +
            '<wps:wsp><wps:spPr><a:xfrm rot="-0.3"/></wps:spPr></wps:wsp>'
        ),
      }),
      DEFAULT_MARKERS
    );
    const rotations = [
      ...unpack(xml)['word/document.xml'].matchAll(/rot="([^"]*)"/g),
    ].map((match) => match[1]);
    expect(rotations).toEqual(['427407', '-1800000', '0']);
  });

  it('removes the no-alt marker and keeps real alt text', () => {
    const xml = unpack(
      repairDrawingGroupsInBuffer(
        pack({
          'word/document.xml':
            groupXml(1, [3]).replace(
              '<wp:docPr id="1" name=""/>',
              `<wp:docPr id="1" name="" descr="${DEFAULT_MARKERS.noAltText}"/>`
            ) +
            groupXml(2, [4]).replace(
              '<wp:docPr id="2" name=""/>',
              '<wp:docPr id="2" name="" descr="A labelled diagram"/>'
            ),
        }),
        DEFAULT_MARKERS
      )
    )['word/document.xml'];
    expect(xml).toContain('<wp:docPr id="1" name=""/>');
    expect(xml).toContain(
      '<wp:docPr id="2" name="" descr="A labelled diagram"/>'
    );
  });

  it('turns the text-box marker into txBox="1"', () => {
    const xml = unpack(
      repairDrawingGroupsInBuffer(
        pack({
          'word/document.xml': groupXml(
            1,
            [],
            `<wps:wsp><wps:cNvPr id="9" name="Text elements[1]" title="${DEFAULT_MARKERS.textBox}"/><wps:cNvSpPr/></wps:wsp>`
          ),
        }),
        DEFAULT_MARKERS
      )
    )['word/document.xml'];
    expect(xml).toContain(
      '<wps:cNvPr id="2" name="Text elements[1]"/><wps:cNvSpPr txBox="1"/>'
    );
    expect(xml).not.toContain('title=');
  });

  it('leaves authored text that spells a default marker alone', () => {
    const markers: DrawingGroupMarkers = {
      noAltText: 'jto:no-alt-text-1',
      textBox: 'jto:text-box-1',
    };
    const body = '<w:t>jto:no-alt-text and jto:text-box</w:t>';
    const xml = unpack(
      repairDrawingGroupsInBuffer(
        pack({
          'word/document.xml':
            body +
            groupXml(1, [3]).replace(
              '<wp:docPr id="1" name=""/>',
              `<wp:docPr id="1" name="" descr="${markers.noAltText}"/>`
            ),
        }),
        markers
      )
    )['word/document.xml'];
    expect(xml).toContain(body);
    expect(xml).toContain('<wp:docPr id="1" name=""/>');
  });

  it('throws, naming the part, when a marker survives', () => {
    // A title the repair does not recognise: not directly before a bare
    // `wps:cNvSpPr`, which is how a docx serialisation change would show.
    const malformed = groupXml(
      1,
      [],
      `<wps:wsp><wps:cNvPr id="9" name="x" title="${DEFAULT_MARKERS.textBox}"/><wps:cNvSpPr foo="1"/></wps:wsp>`
    );
    expect(() =>
      repairDrawingGroupsInBuffer(
        pack({
          'word/document.xml': '<w:body/>',
          'word/header1.xml': malformed,
        }),
        DEFAULT_MARKERS
      )
    ).toThrow('the drawing-group repair left a marker in word/header1.xml');
  });

  it('leaves a part without a group alone and rewrites one with a group', () => {
    // Both parts stored uncompressed: adm-zip deflates any entry it rewrites,
    // so the compression method says which parts the repair touched.
    const source = new AdmZip();
    source.addFile('word/document.xml', Buffer.from(groupXml(1, [3]), 'utf8'));
    source.addFile('word/header1.xml', Buffer.from(imageXml(2), 'utf8'));
    for (const entry of source.getEntries()) entry.header.method = 0;
    const before = new AdmZip(source.toBuffer());
    const after = new AdmZip(
      repairDrawingGroupsInBuffer(source.toBuffer(), DEFAULT_MARKERS)
    );

    const header = (zip: AdmZip) => zip.getEntry('word/header1.xml')!;
    expect(header(after).header.method).toBe(0);
    expect(
      header(after)
        .getCompressedData()
        .equals(header(before).getCompressedData())
    ).toBe(true);

    // The group's ids were already in sequence, so no text moved; the part
    // is rewritten all the same.
    const document = (zip: AdmZip) => zip.getEntry('word/document.xml')!;
    expect(after.readAsText('word/document.xml')).toBe(
      before.readAsText('word/document.xml')
    );
    expect(document(before).header.method).toBe(0);
    expect(document(after).header.method).toBe(8);
  });
});

/**
 * Options `@office-open/pptx` takes by one name and skips by any other.
 *
 * The backend reads its options as data, so a key or value it does not know
 * writes nothing and raises nothing: before the adapter was typed against
 * 0.14's options, an outline's colour went in as `fill`, which the outline
 * never read, and strike as `single`, no `ST_TextStrikeType` value, which
 * PowerPoint hung on. Each is pinned here in the XML it has to become.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

async function slideXml(children: unknown[]): Promise<string> {
  const document = {
    name: 'pptx',
    props: { title: 'Options', author: 'JTO' },
    children: [{ name: 'slide', props: {}, children }],
  } as PresentationComponentDefinition;
  const { buffer } = await generateBufferViaIr(document as never, {
    renderer: 'office-open',
  });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

const ARIAL =
  '<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/>';

describe('office-open text and line options', () => {
  it('writes a shape outline in its authored colour', async () => {
    const xml = await slideXml([
      {
        name: 'shape',
        props: {
          type: 'rect',
          x: 1,
          y: 1,
          w: 2,
          h: 1,
          line: { color: '333333', width: 2, dashType: 'dash' },
        },
      },
    ]);
    expect(xml).toContain(
      '<a:ln w="25400"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:prstDash val="dash"/></a:ln>'
    );
  });

  it('strikes text through as sngStrike', async () => {
    const xml = await slideXml([
      {
        name: 'text',
        props: {
          x: 1,
          y: 1,
          w: 5,
          h: 1,
          strike: true,
          runs: [{ text: 'one ' }, { text: 'two' }],
        },
      },
    ]);
    expect(xml.match(/strike="[^"]*"/g)).toEqual([
      'strike="sngStrike"',
      'strike="sngStrike"',
    ]);
  });

  it('sets a bullet or number marker in Arial', async () => {
    const xml = await slideXml([
      {
        name: 'text',
        props: { text: 'bulleted', x: 1, y: 1, w: 3, h: 1, bullet: true },
      },
      {
        name: 'text',
        props: {
          text: 'numbered',
          x: 1,
          y: 2,
          w: 3,
          h: 1,
          bullet: { type: 'number', startAt: 3 },
        },
      },
      {
        name: 'text',
        props: { text: 'plain', x: 1, y: 3, w: 3, h: 1, bullet: false },
      },
    ]);
    expect(xml).toContain(`${ARIAL}<a:buChar char="•"/>`);
    expect(xml).toContain(
      `${ARIAL}<a:buAutoNum type="arabicPeriod" startAt="3"/>`
    );
    expect(xml.match(/<a:buFont\b/g)).toHaveLength(2);
  });
});

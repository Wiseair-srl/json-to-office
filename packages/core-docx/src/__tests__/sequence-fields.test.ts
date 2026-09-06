/**
 * `{SEQ:name}`: a Word sequence field with the count the compiler reached.
 *
 * Both renderers write the instruction, so Word numbers the figures itself,
 * and both write the counted result, so a reader that never updates fields —
 * headless LibreOffice, the preview PDF — shows the same number.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

const paragraph = (text: string) => ({ name: 'paragraph', props: { text } });

async function documentXml(renderer?: string): Promise<string> {
  const buffer = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    ...(renderer ? { renderer } : {}),
    children: [
      {
        name: 'section',
        children: [
          paragraph('**Figure {SEQ:figure}.** Revenue by quarter'),
          paragraph('Table {SEQ:table}. Segments'),
          paragraph('Figure {SEQ:figure}. Retention, and {SEQ:figure} again'),
        ],
      },
    ],
  } as never);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

describe.each([undefined, 'office-open'])('{SEQ:name} on %s', (renderer) => {
  it('counts each sequence in document order and writes the result', async () => {
    const xml = await documentXml(renderer);
    const instructions = xml.match(/SEQ [a-z]+ \\\* ARABIC/g);
    expect(instructions).toEqual([
      'SEQ figure \\* ARABIC',
      'SEQ table \\* ARABIC',
      'SEQ figure \\* ARABIC',
      'SEQ figure \\* ARABIC',
    ]);
    // The cached results, in the order the fields appear.
    const text = xml.replace(/<[^>]+>/g, '|');
    expect(text.indexOf('|1|')).toBeGreaterThan(-1);
    const numbers = [...text.matchAll(/\|(\d)\|/g)].map((m) => m[1]);
    expect(numbers).toEqual(['1', '1', '2', '3']);
    expect(xml).toContain('Revenue by quarter');
  });
});

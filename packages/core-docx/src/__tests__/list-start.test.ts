/**
 * `props.start` used to be read only on the simplified path, so supplying an
 * explicit `props.levels` array discarded it without warning.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function numberingXml(list: unknown): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [list],
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/numbering.xml')!.async('string');
}

/**
 * The authored list's own `w:abstractNum`. docx emits its default bullet
 * definition first, so the registered list is the last block.
 */
function listAbstractNum(xml: string): string {
  const blocks = xml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g);
  if (!blocks?.length) throw new Error('no w:abstractNum in numbering.xml');
  return blocks[blocks.length - 1];
}

function level(xml: string, ilvl: number): string {
  const match = listAbstractNum(xml).match(
    new RegExp(`<w:lvl w:ilvl="${ilvl}"[^>]*>[\\s\\S]*?</w:lvl>`)
  );
  if (!match) throw new Error(`level ${ilvl} not found`);
  return match[0];
}

describe('list props.start', () => {
  it('applies to level 0 when explicit levels are given', async () => {
    const xml = await numberingXml({
      name: 'list',
      props: {
        items: ['One', 'Two'],
        start: 3,
        levels: [{ level: 0, format: 'decimal', text: '%1.' }],
      },
    });

    expect(level(xml, 0)).toContain('<w:start w:val="3"/>');
    expect(xml).toContain('<w:startOverride w:val="3"/>');
  });

  it('still applies on the simplified path', async () => {
    const xml = await numberingXml({
      name: 'list',
      props: { items: ['One', 'Two'], format: 'numbered', start: 5 },
    });

    expect(level(xml, 0)).toContain('<w:start w:val="5"/>');
  });

  it('lets an explicit level start win over props.start', async () => {
    const xml = await numberingXml({
      name: 'list',
      props: {
        items: ['One'],
        start: 3,
        levels: [{ level: 0, format: 'decimal', text: '%1.', start: 7 }],
      },
    });

    expect(level(xml, 0)).toContain('<w:start w:val="7"/>');
    expect(level(xml, 0)).not.toContain('<w:start w:val="3"/>');
  });

  it('does not leak props.start onto nested levels', async () => {
    const xml = await numberingXml({
      name: 'list',
      props: {
        items: ['One', { text: 'Nested', level: 1 }],
        start: 3,
        levels: [
          { level: 0, format: 'decimal', text: '%1.' },
          { level: 1, format: 'lowerLetter', text: '%2.' },
        ],
      },
    });

    expect(level(xml, 0)).toContain('<w:start w:val="3"/>');
    expect(level(xml, 1)).not.toContain('<w:start w:val="3"/>');
  });
});

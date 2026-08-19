/**
 * A list level's `font` styles the marker glyph itself (`w:lvl/w:rPr`),
 * independently of the list text. Nothing else in the schema could reach it.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function generate(list: unknown): Promise<JSZip> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [list],
  } as never);
  return JSZip.loadAsync(buf);
}

/** The authored list's `w:abstractNum` — docx emits its own default first. */
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

describe('list marker style', () => {
  it('emits w:rPr on the level for family, size, colour and weight', async () => {
    const zip = await generate({
      name: 'list',
      props: {
        items: ['One', 'Two'],
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            font: {
              family: 'Georgia',
              size: 14,
              color: '#E6620C',
              bold: true,
              italic: true,
              underline: true,
            },
          },
        ],
      },
    });
    const lvl = level(await zip.file('word/numbering.xml')!.async('string'), 0);

    expect(lvl).toContain('<w:rPr>');
    expect(lvl).toMatch(/<w:rFonts [^>]*w:ascii="Georgia"/);
    expect(lvl).toContain('<w:sz w:val="28"/>');
    expect(lvl).toContain('<w:color w:val="E6620C"/>');
    expect(lvl).toContain('<w:b/>');
    expect(lvl).toContain('<w:i/>');
    expect(lvl).toContain('<w:u w:val="single"/>');
  });

  it('resolves a theme colour token', async () => {
    const zip = await generate({
      name: 'list',
      props: {
        items: ['One'],
        levels: [
          {
            level: 0,
            format: 'bullet',
            text: '•',
            font: { color: 'primary' },
          },
        ],
      },
    });
    const lvl = level(await zip.file('word/numbering.xml')!.async('string'), 0);

    expect(lvl).toMatch(/<w:color w:val="[0-9A-F]{6}"\/>/);
    expect(lvl).not.toContain('primary');
  });

  it('styles only the marker, not the list text', async () => {
    const zip = await generate({
      name: 'list',
      props: {
        items: ['One'],
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            font: { color: '#E6620C' },
          },
        ],
      },
    });

    const document = await zip.file('word/document.xml')!.async('string');
    expect(document).not.toContain('E6620C');
  });

  it('leaves the level unchanged when no marker font is given', async () => {
    const zip = await generate({
      name: 'list',
      props: {
        items: ['One'],
        levels: [{ level: 0, format: 'decimal', text: '%1.' }],
      },
    });
    const lvl = level(await zip.file('word/numbering.xml')!.async('string'), 0);

    expect(lvl).not.toContain('<w:rPr>');
  });

  it('styles each level independently', async () => {
    const zip = await generate({
      name: 'list',
      props: {
        items: ['One', { text: 'Nested', level: 1 }],
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            font: { color: '#E6620C' },
          },
          { level: 1, format: 'lowerLetter', text: '%2.' },
        ],
      },
    });
    const xml = await zip.file('word/numbering.xml')!.async('string');

    expect(level(xml, 0)).toContain('<w:color w:val="E6620C"/>');
    expect(level(xml, 1)).not.toContain('<w:rPr>');
  });
});

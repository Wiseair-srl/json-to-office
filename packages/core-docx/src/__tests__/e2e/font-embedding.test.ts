import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../../core/generator';

// Minimal TTF with just the SFNT magic — enough for docx to accept and embed.
// Word will likely refuse to render it, but this test verifies our pipeline
// correctly wires FontOptions through to the .docx package.
const MINIMAL_TTF_B64 = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(256),
]).toString('base64');

describe('E2E: Font embedding (DOCX)', () => {
  it('does not embed any fonts when only SAFE_FONTS are referenced', async () => {
    const json = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: { level: 1, text: 'Hello', font: { family: 'Arial' } },
        },
      ],
    };
    const buffer = await generateBufferFromJson(
      json as unknown as Parameters<typeof generateBufferFromJson>[0]
    );
    const zip = await JSZip.loadAsync(buffer);
    // No font parts under word/ when nothing embeddable
    const fontParts = Object.keys(zip.files).filter((p) =>
      /^word\/fonts\//.test(p)
    );
    expect(fontParts).toEqual([]);
  });

  it('embeds a font registered via fonts.extraEntries into the .docx zip', async () => {
    const json = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: { level: 1, text: 'Custom', font: { family: 'TestFont' } },
        },
      ],
    };
    const buffer = await generateBufferFromJson(
      json as unknown as Parameters<typeof generateBufferFromJson>[0],
      {
        fonts: {
          extraEntries: [
            {
              id: 'TestFont',
              family: 'TestFont',
              sources: [{ kind: 'data', data: MINIMAL_TTF_B64 }],
            },
          ],
        },
      }
    );
    const zip = await JSZip.loadAsync(buffer);

    // Font binary part exists
    const fontParts = Object.keys(zip.files).filter((p) =>
      /^word\/fonts\//.test(p)
    );
    expect(fontParts.length).toBeGreaterThan(0);

    // Font is declared in fontTable.xml
    const fontTable = await zip.files['word/fontTable.xml']?.async('string');
    expect(fontTable).toBeDefined();
    expect(fontTable).toContain('TestFont');
  });

  it('throws in strict mode when a font is neither safe nor registered', async () => {
    const json = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: { level: 1, text: 'x', font: { family: 'Nonexistent Font' } },
        },
      ],
    };
    await expect(
      generateBufferFromJson(
        json as unknown as Parameters<typeof generateBufferFromJson>[0],
        { fonts: { strict: true } }
      )
    ).rejects.toThrow(/Unresolved font references/);
  });
});

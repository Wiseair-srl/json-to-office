import { describe, it, expect } from 'vitest';
import { toEmbeddedFontFaces } from '../embed-faces';
import type { ResolvedFont, ResolvedFontSource } from '../types';
import type { GenerationWarning } from '../../types/warnings';

/**
 * The smallest sfnt `readFontFsType` reads: a table directory with one OS/2
 * table, cut off right after `fsType`. A distinct `tag` byte keeps every
 * face's buffer distinguishable, so a test can tell which one filled a slot.
 */
function sfnt(tag: number, fsType = 0): Buffer {
  const os2 = Buffer.alloc(10);
  os2.writeUInt16BE(4, 0);
  os2.writeUInt16BE(tag, 2);
  os2.writeUInt16BE(400, 4);
  os2.writeUInt16BE(fsType, 8);
  const buf = Buffer.alloc(12 + 16 + os2.length);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(1, 4);
  buf.write('OS/2', 12, 'ascii');
  buf.writeUInt32BE(28, 12 + 8);
  buf.writeUInt32BE(os2.length, 12 + 12);
  os2.copy(buf, 28);
  return buf;
}

function source(
  weight: number,
  italic = false,
  options: { fsType?: number; format?: ResolvedFontSource['format'] } = {}
): ResolvedFontSource {
  return {
    data: sfnt(weight + (italic ? 1 : 0), options.fsType),
    weight,
    italic,
    format: options.format ?? 'ttf',
  };
}

const family = (name: string, sources: ResolvedFontSource[]): ResolvedFont => ({
  family: name,
  sources,
  warnings: [],
});

const codes = (warnings: GenerationWarning[]) =>
  warnings.map((w) => w.context?.code);

describe('toEmbeddedFontFaces', () => {
  it('fills the four slots from 400/700 upright and italic', () => {
    const sources = [
      source(400),
      source(700),
      source(400, true),
      source(700, true),
    ];
    const warnings: GenerationWarning[] = [];
    const { faces, report } = toEmbeddedFontFaces(
      [family('Life Sans', sources)],
      warnings
    );

    expect(faces).toEqual([
      {
        family: 'Life Sans',
        regular: sources[0].data,
        bold: sources[1].data,
        italic: sources[2].data,
        boldItalic: sources[3].data,
      },
    ]);
    expect(report).toEqual([
      {
        family: 'Life Sans',
        slots: ['regular', 'bold', 'italic', 'boldItalic'],
        nearest: [],
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('takes the nearest weight on each side when 400 or 700 is missing', () => {
    const medium = source(500);
    const semiBold = source(600);
    const warnings: GenerationWarning[] = [];
    const { faces, report } = toEmbeddedFontFaces(
      [family('Life Sans', [semiBold, medium])],
      warnings
    );

    expect(faces).toEqual([
      { family: 'Life Sans', regular: medium.data, bold: semiBold.data },
    ]);
    expect(report[0].nearest).toEqual([
      { slot: 'regular', weight: 500 },
      { slot: 'bold', weight: 600 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('drops a weight Word has no slot for, and one whose slot is taken', () => {
    const warnings: GenerationWarning[] = [];
    const { faces } = toEmbeddedFontFaces(
      [family('Inter', [source(400), source(300), source(500)])],
      warnings
    );

    expect(Object.keys(faces[0])).toEqual(['family', 'regular']);
    expect(codes(warnings)).toEqual([
      'FONT_EMBED_WEIGHT_DROPPED',
      'FONT_EMBED_WEIGHT_DROPPED',
    ]);
    const [light, medium] = warnings;
    expect(light).toMatchObject({
      component: 'fontRegistry',
      severity: 'warning',
    });
    expect(light.message).toContain('"Inter" weight 300');
    expect(light.message).toContain('fills none of them');
    // The run at that weight still names the synthesised sub-family.
    expect(light.message).toContain('"Inter Light"');
    expect(medium.message).toContain(
      'regular slot is already filled by weight 400'
    );
    expect(medium.message).toContain('"Inter Medium"');
  });

  it('skips a format OOXML cannot carry before it can take a slot', () => {
    const woff = source(400, false, { format: 'woff' });
    const medium = source(500);
    const warnings: GenerationWarning[] = [];
    const { faces } = toEmbeddedFontFaces(
      [family('Brand', [woff, medium])],
      warnings
    );

    expect(faces).toEqual([{ family: 'Brand', regular: medium.data }]);
    expect(codes(warnings)).toEqual(['FONT_EMBED_SKIPPED_FORMAT']);
    expect(warnings[0].message).toContain('"Brand" weight 400 is woff');
  });

  it('reads the licence bits: restricted skips, preview & print warns, editable embeds', () => {
    const restricted = source(400, false, { fsType: 0x0002 });
    const preview = source(500, false, { fsType: 0x0004 });
    const editable = source(700, false, { fsType: 0x0008 });
    // Several bits: the least restrictive applies.
    const combined = source(400, true, { fsType: 0x0002 | 0x0008 });
    const warnings: GenerationWarning[] = [];
    const { faces } = toEmbeddedFontFaces(
      [family('Brand', [restricted, preview, editable, combined])],
      warnings
    );

    expect(faces).toEqual([
      {
        family: 'Brand',
        regular: preview.data,
        bold: editable.data,
        italic: combined.data,
      },
    ]);
    expect(codes(warnings)).toEqual([
      'FONT_EMBED_SKIPPED_LICENSE',
      'FONT_EMBED_READ_ONLY',
    ]);
    expect(warnings[0].message).toContain('0x0002');
    expect(warnings[1].message).toContain('read-only');
  });

  it('embeds nothing of a family without a regular face', () => {
    const warnings: GenerationWarning[] = [];
    const { faces, report } = toEmbeddedFontFaces(
      [
        family('Heavy', [source(700), source(700, true)]),
        family('Webby', [source(400, false, { format: 'woff2' })]),
      ],
      warnings
    );

    expect(faces).toEqual([]);
    expect(report).toEqual([
      { family: 'Heavy', slots: [], nearest: [], reason: 'no-regular-face' },
      {
        family: 'Webby',
        slots: [],
        nearest: [],
        reason: 'no-embeddable-face',
      },
    ]);
    expect(codes(warnings)).toEqual([
      'FONT_EMBED_WEIGHT_DROPPED',
      'FONT_EMBED_WEIGHT_DROPPED',
      'FONT_EMBED_SKIPPED_FORMAT',
    ]);
    expect(warnings[0].message).toContain('beside its regular one');
  });

  it('skips safe families, families with no sources and repeats silently', () => {
    const warnings: GenerationWarning[] = [];
    const inter = family('Inter', [source(400)]);
    const { faces, report } = toEmbeddedFontFaces(
      [
        family('Arial', [source(400)]),
        family('Unregistered', []),
        inter,
        // The same entry reached through its id resolves a second time.
        { ...inter, family: 'inter' },
      ],
      warnings
    );

    expect(faces.map((f) => f.family)).toEqual(['Inter']);
    expect(report.map((r) => r.family)).toEqual(['Inter']);
    expect(warnings).toEqual([]);
  });
});

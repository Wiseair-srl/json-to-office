import { describe, it, expect } from 'vitest';
import type { ResolvedFont } from '../types';
import type { GenerationWarning } from '../../types/warnings';
import {
  toChartFontFaces,
  toRasterizeFontFaces,
  fromRasterizeFontFaces,
} from '../rasterize-faces';

const bytes = (fill: number, len = 64): Buffer => Buffer.alloc(len, fill);

describe('toRasterizeFontFaces', () => {
  it('drops entries with no sources (safe-only fonts carry no bytes)', () => {
    const fonts: ResolvedFont[] = [
      { family: 'Arial', sources: [], warnings: [] },
      {
        family: 'Inter',
        sources: [
          { data: bytes(1), weight: 400, italic: false, format: 'ttf' },
        ],
        warnings: [],
      },
    ];
    const faces = toRasterizeFontFaces(fonts);
    expect(faces).toHaveLength(1);
    expect(faces[0].family).toBe('Inter');
  });

  it('emits one face per source, preserving weight and italic', () => {
    const fonts: ResolvedFont[] = [
      {
        family: 'Inter',
        sources: [
          { data: bytes(1), weight: 300, italic: false, format: 'ttf' },
          { data: bytes(2), weight: 700, italic: true, format: 'otf' },
        ],
        warnings: [],
      },
    ];
    const faces = toRasterizeFontFaces(fonts);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => [f.weight, f.italic, f.format])).toEqual([
      [300, false, 'ttf'],
      [700, true, 'otf'],
    ]);
  });

  it('base64-encodes the exact source bytes', () => {
    const data = Buffer.from([0x00, 0x01, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const faces = toRasterizeFontFaces([
      {
        family: 'Inter',
        sources: [{ data, weight: 400, italic: false, format: 'ttf' }],
        warnings: [],
      },
    ]);
    expect(Buffer.from(faces[0].data, 'base64').equals(data)).toBe(true);
  });

  // The rasterizer's native stagers write every staged source as a `.ttf`,
  // register it as a raw sfnt, and rename it through `rewriteFontFamilyName`,
  // which returns non-sfnt buffers UNCHANGED. So anything but TTF/OTF is
  // staged as bytes nothing can parse, under the wrong family name, and
  // renders as silent fallback text. Better to not ship it at all.
  it.each(['woff', 'woff2', 'eot', 'pfb', 'unknown'] as const)(
    'drops a %s source the stagers cannot register',
    (format) => {
      const faces = toRasterizeFontFaces([
        {
          family: 'Mystery',
          sources: [{ data: bytes(3), weight: 400, italic: false, format }],
          warnings: [],
        },
      ]);
      expect(faces).toEqual([]);
    }
  );

  it('keeps the TTF/OTF siblings of a dropped source', () => {
    const faces = toRasterizeFontFaces([
      {
        family: 'Inter',
        sources: [
          { data: bytes(1), weight: 400, italic: false, format: 'ttf' },
          { data: bytes(2), weight: 500, italic: false, format: 'woff2' },
          { data: bytes(3), weight: 700, italic: false, format: 'otf' },
        ],
        warnings: [],
      },
    ]);
    expect(faces.map((f) => [f.weight, f.format])).toEqual([
      [400, 'ttf'],
      [700, 'otf'],
    ]);
  });

  it('reports each dropped source into the optional warnings sink', () => {
    const warnings: GenerationWarning[] = [];
    toRasterizeFontFaces(
      [
        {
          family: 'Inter',
          sources: [
            { data: bytes(1), weight: 400, italic: false, format: 'ttf' },
            { data: bytes(2), weight: 300, italic: true, format: 'woff2' },
          ],
          warnings: [],
        },
      ],
      warnings
    );
    expect(warnings).toHaveLength(1);
    // Shaped like every other generation warning, so a caller can hand in the
    // array it already collects and the code survives to the client.
    expect(warnings[0].context?.code).toBe('FONT_FORMAT_NOT_RASTERIZABLE');
    expect(warnings[0].component).toBe('fontRegistry');
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('Inter');
    expect(warnings[0].message).toContain('woff2');
  });

  it('stays silent when nothing is dropped', () => {
    const warnings: GenerationWarning[] = [];
    toRasterizeFontFaces(
      [
        {
          family: 'Inter',
          sources: [
            { data: bytes(1), weight: 400, italic: false, format: 'ttf' },
          ],
          warnings: [],
        },
      ],
      warnings
    );
    expect(warnings).toEqual([]);
  });

  it('ships the CATALOG family, not a synthesized sub-family', () => {
    // The stager applies synthesizeFamilyName itself; pre-synthesizing here
    // would produce "Inter Light Light" downstream.
    const faces = toRasterizeFontFaces([
      {
        family: 'Inter',
        sources: [
          { data: bytes(1), weight: 300, italic: false, format: 'ttf' },
        ],
        warnings: [],
      },
    ]);
    expect(faces[0].family).toBe('Inter');
  });
});

describe('fromRasterizeFontFaces', () => {
  it('regroups multiple faces of one family into a single ResolvedFont', () => {
    const fonts = fromRasterizeFontFaces([
      {
        family: 'Inter',
        weight: 400,
        italic: false,
        data: bytes(1).toString('base64'),
      },
      {
        family: 'Inter',
        weight: 700,
        italic: false,
        data: bytes(2).toString('base64'),
      },
      {
        family: 'Geist',
        weight: 400,
        italic: false,
        data: bytes(3).toString('base64'),
      },
    ]);
    expect(fonts).toHaveLength(2);
    expect(fonts[0].family).toBe('Inter');
    expect(fonts[0].sources).toHaveLength(2);
    expect(fonts[1].family).toBe('Geist');
    expect(fonts[1].sources).toHaveLength(1);
  });

  it("defaults an absent format to 'ttf' and seeds empty warnings", () => {
    const [font] = fromRasterizeFontFaces([
      {
        family: 'Inter',
        weight: 400,
        italic: false,
        data: bytes(1).toString('base64'),
      },
    ]);
    expect(font.sources[0].format).toBe('ttf');
    expect(font.warnings).toEqual([]);
  });

  it('round-trips bytes byte-for-byte', () => {
    const a = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x11, 0x22]);
    const b = Buffer.from([0x4f, 0x54, 0x54, 0x4f, 0x99]);
    const original: ResolvedFont[] = [
      {
        family: 'Inter',
        sources: [
          { data: a, weight: 400, italic: false, format: 'ttf' },
          { data: b, weight: 400, italic: true, format: 'otf' },
        ],
        warnings: [],
      },
    ];
    const back = fromRasterizeFontFaces(toRasterizeFontFaces(original));
    expect(back).toHaveLength(1);
    expect(back[0].family).toBe('Inter');
    expect(back[0].sources[0].data.equals(a)).toBe(true);
    expect(back[0].sources[1].data.equals(b)).toBe(true);
    expect(back[0].sources.map((s) => [s.weight, s.italic])).toEqual([
      [400, false],
      [400, true],
    ]);
  });

  it('treats family names as case-sensitive when grouping', () => {
    const fonts = fromRasterizeFontFaces([
      { family: 'Inter', weight: 400, italic: false, data: 'AA==' },
      { family: 'inter', weight: 400, italic: false, data: 'AA==' },
    ]);
    expect(fonts).toHaveLength(2);
  });
});

describe('toChartFontFaces', () => {
  it('keeps every browser-renderable format and skips the rest', () => {
    const faces = toChartFontFaces([
      { family: 'Arial', sources: [], warnings: [] },
      {
        family: 'Inter',
        sources: [
          { data: bytes(1), weight: 400, italic: false, format: 'ttf' },
          { data: bytes(2), weight: 700, italic: false, format: 'woff2' },
          { data: bytes(3), weight: 300, italic: true, format: 'woff' },
          { data: bytes(4), weight: 900, italic: false, format: 'otf' },
          { data: bytes(5), weight: 500, italic: false, format: 'eot' },
          { data: bytes(6), weight: 500, italic: false, format: 'unknown' },
        ],
        warnings: [],
      },
    ]);
    expect(faces.map((f) => [f.family, f.weight, f.italic, f.format])).toEqual([
      ['Inter', 400, false, 'ttf'],
      ['Inter', 700, false, 'woff2'],
      ['Inter', 300, true, 'woff'],
      ['Inter', 900, false, 'otf'],
    ]);
    expect(Buffer.from(faces[1].data, 'base64').equals(bytes(2))).toBe(true);
  });
});

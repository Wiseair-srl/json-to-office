import { describe, it, expect } from 'vitest';
import {
  sniffFontFormat,
  toBase64,
  validateFontUpload,
  guessFontIdentity,
  upsertFontRegistryEntry,
  mergeDataSources,
  materializeResponseToEntry,
  checkDocumentSize,
  MAX_UPLOAD_FONT_BYTES,
  MAX_DOCUMENT_JSON_BYTES,
} from '../font-upload';
import type { FontRegistryEntry } from '@json-to-office/shared';

const withMagic = (magic: number[], length = 64): Uint8Array => {
  const bytes = new Uint8Array(length);
  bytes.set(magic, 0);
  return bytes;
};

const TTF = withMagic([0x00, 0x01, 0x00, 0x00]);
const OTF = withMagic([0x4f, 0x54, 0x54, 0x4f]);
const WOFF = withMagic([0x77, 0x4f, 0x46, 0x46]);
const WOFF2 = withMagic([0x77, 0x4f, 0x46, 0x32]);

describe('sniffFontFormat', () => {
  it('recognises TrueType, OpenType, WOFF and WOFF2', () => {
    expect(sniffFontFormat(TTF)).toBe('ttf');
    expect(sniffFontFormat(OTF)).toBe('otf');
    expect(sniffFontFormat(WOFF)).toBe('woff');
    expect(sniffFontFormat(WOFF2)).toBe('woff2');
  });

  it('recognises the legacy "true" and "ttcf" tags', () => {
    expect(sniffFontFormat(withMagic([0x74, 0x72, 0x75, 0x65]))).toBe('ttf');
    expect(sniffFontFormat(withMagic([0x74, 0x74, 0x63, 0x66]))).toBe('ttf');
  });

  it('returns unknown for junk and for too-short input', () => {
    expect(sniffFontFormat(withMagic([0x89, 0x50, 0x4e, 0x47]))).toBe(
      'unknown'
    );
    expect(sniffFontFormat(new Uint8Array([0x00, 0x01]))).toBe('unknown');
  });
});

describe('toBase64', () => {
  it('round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const decoded = atob(toBase64(bytes));
    expect([...decoded].map((c) => c.charCodeAt(0))).toEqual([...bytes]);
  });

  it('handles payloads past the spread-argument stack limit', () => {
    // btoa(String.fromCharCode(...bytes)) throws RangeError around 100 KB.
    const big = new Uint8Array(300_000).fill(0x41);
    expect(() => toBase64(big)).not.toThrow();
    expect(atob(toBase64(big)).length).toBe(300_000);
  });
});

describe('validateFontUpload', () => {
  it('accepts a TTF and returns its base64', () => {
    const result = validateFontUpload('Geist.ttf', TTF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('ttf');
      expect(result.base64.length).toBeGreaterThan(0);
    }
  });

  it('accepts an OTF', () => {
    expect(validateFontUpload('Geist.otf', OTF).ok).toBe(true);
  });

  it('rejects WOFF2 with an actionable message', () => {
    const result = validateFontUpload('Geist.woff2', WOFF2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The staging path writes every face as .ttf, so a woff2 would be
      // staged under a name fontconfig cannot parse.
      expect(result.message).toContain('WOFF2');
      expect(result.message).toContain('TTF');
    }
  });

  it('rejects a file that is not a font at all', () => {
    const result = validateFontUpload('logo.png', withMagic([0x89, 0x50]));
    expect(result.ok).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(validateFontUpload('empty.ttf', new Uint8Array(0)).ok).toBe(false);
  });

  it('rejects a file over the per-font cap', () => {
    const huge = new Uint8Array(MAX_UPLOAD_FONT_BYTES + 1);
    huge.set([0x00, 0x01, 0x00, 0x00], 0);
    const result = validateFontUpload('huge.ttf', huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('limit');
  });
});

describe('guessFontIdentity', () => {
  it('splits a trailing weight label off the family', () => {
    expect(guessFontIdentity('Geist-SemiBold.ttf')).toEqual({
      family: 'Geist',
      weight: 600,
      italic: false,
    });
  });

  it('handles weight and italic together', () => {
    expect(guessFontIdentity('Inter_Light_Italic.otf')).toEqual({
      family: 'Inter',
      weight: 300,
      italic: true,
    });
  });

  it('defaults to 400 regular when there is no style token', () => {
    expect(guessFontIdentity('BrandSans.ttf')).toEqual({
      family: 'BrandSans',
      weight: 400,
      italic: false,
    });
  });

  it('keeps multi-word family names', () => {
    expect(guessFontIdentity('Space Grotesk Medium.ttf')).toEqual({
      family: 'Space Grotesk',
      weight: 500,
      italic: false,
    });
  });

  it('does not eat a leading style word that is the whole name', () => {
    // "Bold.ttf" is a degenerate name; the family must not become empty.
    expect(guessFontIdentity('Bold.ttf').family).toBe('Bold');
  });
});

describe('upsertFontRegistryEntry', () => {
  const a: FontRegistryEntry = {
    id: 'a',
    family: 'Alpha',
    sources: [{ kind: 'data', data: 'A' }],
  };
  const b: FontRegistryEntry = {
    id: 'b',
    family: 'Beta',
    sources: [{ kind: 'data', data: 'B' }],
  };

  it('appends a new family', () => {
    expect(upsertFontRegistryEntry([a], b)).toEqual([a, b]);
  });

  it('replaces in place, preserving order', () => {
    const updated = { ...a, sources: [{ kind: 'data' as const, data: 'A2' }] };
    expect(upsertFontRegistryEntry([a, b], updated)).toEqual([updated, b]);
  });

  it('matches family case-insensitively', () => {
    const updated = { ...a, family: 'ALPHA' };
    expect(upsertFontRegistryEntry([a, b], updated)).toHaveLength(2);
  });

  it('tolerates a missing registry', () => {
    expect(upsertFontRegistryEntry(undefined, a)).toEqual([a]);
  });
});

describe('mergeDataSources', () => {
  const existing: FontRegistryEntry = {
    id: 'geist',
    family: 'Geist',
    category: 'sans',
    sources: [
      { kind: 'data', data: 'REGULAR', weight: 400, italic: false },
      { kind: 'data', data: 'BOLD', weight: 700, italic: false },
    ],
  };

  it('adds a new weight alongside existing ones', () => {
    const out = mergeDataSources(existing, 'Geist', [
      { data: 'LIGHT', weight: 300, italic: false },
    ]);
    expect(out.sources).toHaveLength(3);
  });

  it('replaces a source with the same weight and style', () => {
    const out = mergeDataSources(existing, 'Geist', [
      { data: 'REGULAR2', weight: 400, italic: false },
    ]);
    expect(out.sources).toHaveLength(2);
    expect(out.sources.map((s) => (s as { data: string }).data)).toEqual([
      'BOLD',
      'REGULAR2',
    ]);
  });

  it('treats italic as a distinct slot from roman at the same weight', () => {
    const out = mergeDataSources(existing, 'Geist', [
      { data: 'ITALIC', weight: 400, italic: true },
    ]);
    expect(out.sources).toHaveLength(3);
  });

  it('preserves the existing id and category', () => {
    const out = mergeDataSources(existing, 'Geist', [
      { data: 'X', weight: 500, italic: false },
    ]);
    expect(out.id).toBe('geist');
    expect(out.category).toBe('sans');
  });

  it('omits category entirely when there is none', () => {
    const out = mergeDataSources(undefined, 'New', [
      { data: 'X', weight: 400, italic: false },
    ]);
    // additionalProperties:false means an explicit undefined would serialize
    // as a key and fail validation.
    expect('category' in out).toBe(false);
  });
});

describe('materializeResponseToEntry', () => {
  it('converts ttf/otf sources into data entries', () => {
    const entry = materializeResponseToEntry(
      {
        family: 'Geist',
        sources: [
          { weight: 400, italic: false, format: 'ttf', data: 'AAA' },
          { weight: 700, italic: false, format: 'otf', data: 'BBB' },
        ],
        warnings: [],
      },
      'sans'
    );
    expect(entry?.sources).toHaveLength(2);
    expect(entry?.category).toBe('sans');
    expect(entry?.sources[0]).toMatchObject({ kind: 'data', weight: 400 });
  });

  it('drops non-embeddable formats', () => {
    const entry = materializeResponseToEntry({
      family: 'Geist',
      sources: [
        { weight: 400, italic: false, format: 'woff2', data: 'AAA' },
        { weight: 700, italic: false, format: 'ttf', data: 'BBB' },
      ],
      warnings: [],
    });
    expect(entry?.sources).toHaveLength(1);
  });

  it('returns null when nothing embeddable came back', () => {
    // sources has minItems:1 in the schema, so an empty entry is invalid and
    // the caller must surface warnings instead of writing it.
    expect(
      materializeResponseToEntry({
        family: 'Nonexistent',
        sources: [],
        warnings: ['no such family'],
      })
    ).toBeNull();
  });

  it('omits category when the family is not in the catalog', () => {
    const entry = materializeResponseToEntry({
      family: 'Obscure',
      sources: [{ weight: 400, italic: false, format: 'ttf', data: 'A' }],
      warnings: [],
    });
    expect(entry && 'category' in entry).toBe(false);
  });
});

describe('checkDocumentSize', () => {
  it('passes a normal document', () => {
    expect(checkDocumentSize(JSON.stringify({ name: 'docx' }))).toBeNull();
  });

  it('rejects a document past the request-body budget', () => {
    const big = 'x'.repeat(MAX_DOCUMENT_JSON_BYTES + 10);
    const msg = checkDocumentSize(big);
    expect(msg).toContain('limit');
  });
});

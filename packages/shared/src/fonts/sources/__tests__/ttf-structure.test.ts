import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateFontStructure } from '../ttf-structure';

const FIXTURE = path.resolve(
  __dirname,
  '../../../../../core-docx/src/styles/fonts/life-sans/LifeSans-Medium.ttf'
);

/** Byte range of a table's directory entry in an sfnt. */
function directoryEntry(buf: Buffer, tag: string): number {
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const eo = 12 + i * 16;
    if (buf.toString('ascii', eo, eo + 4) === tag) return eo;
  }
  throw new Error(`no ${tag} table`);
}

/** A `name` table with one readable record, so the readability probe passes. */
function nameTable(value: string): Buffer {
  const encoded = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    encoded.writeUInt16BE(value.charCodeAt(i), i * 2);
  }
  const header = Buffer.alloc(18);
  header.writeUInt16BE(0, 0); // format 0
  header.writeUInt16BE(1, 2); // one record
  header.writeUInt16BE(18, 4); // storage starts after the record
  header.writeUInt16BE(3, 6); // platform 3
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(1033, 10);
  header.writeUInt16BE(1, 12); // nameID 1
  header.writeUInt16BE(encoded.length, 14);
  header.writeUInt16BE(0, 16);
  return Buffer.concat([header, encoded]);
}

/**
 * Assemble an sfnt from table stubs. The checker reads the envelope, never a
 * table's contents, so stub bytes are enough — and building the file here
 * keeps the CFF case self-contained rather than reaching for a shipped
 * template asset that template work is free to move.
 */
function buildFontWith(
  version: number,
  tables: Array<{ tag: string; data?: Buffer }>
): Buffer {
  const directorySize = 12 + tables.length * 16;
  const bodies = tables.map((t) => t.data ?? Buffer.alloc(16));
  const total = directorySize + bodies.reduce((sum, b) => sum + b.length, 0);
  const buf = Buffer.alloc(total);
  buf.writeUInt32BE(version, 0);
  buf.writeUInt16BE(tables.length, 4);
  let cursor = directorySize;
  tables.forEach((t, i) => {
    const eo = 12 + i * 16;
    buf.write(t.tag, eo, 4, 'ascii');
    buf.writeUInt32BE(cursor, eo + 8);
    buf.writeUInt32BE(bodies[i].length, eo + 12);
    bodies[i].copy(buf, cursor);
    cursor += bodies[i].length;
  });
  return buf;
}

describe('validateFontStructure', () => {
  const real = readFileSync(FIXTURE);

  describe('loadable fonts', () => {
    it('passes a real TrueType font', () => {
      expect(validateFontStructure(real, 500, false, 'Life Sans')).toBeNull();
    });

    it('passes a CFF-flavoured OpenType font', () => {
      // 'OTTO' + CFF outlines instead of glyf/loca — the other half of what
      // the pipeline resolves.
      const otf = buildFontWith(0x4f54544f, [
        { tag: 'CFF ' },
        { tag: 'head' },
        { tag: 'name', data: nameTable('Clash Display') },
      ]);
      expect(
        validateFontStructure(otf, 400, false, 'Clash Display')
      ).toBeNull();
    });

    it('passes the legacy "true" sfnt version', () => {
      const font = buildFontWith(0x74727565, [
        { tag: 'glyf' },
        { tag: 'loca' },
        { tag: 'head' },
        { tag: 'name', data: nameTable('Legacy') },
      ]);
      expect(validateFontStructure(font, 400, false, 'Legacy')).toBeNull();
    });
  });

  describe('truncation — the case detectFontFormat cannot see', () => {
    it('flags a font truncated mid-directory', () => {
      // Still starts with the sfnt magic, so `detectFontFormat` calls it a
      // TTF and every downstream check stays silent.
      const truncated = real.subarray(0, 40);
      const diag = validateFontStructure(truncated, 500, false, 'Life Sans');
      expect(diag?.code).toBe('FONT_UNREADABLE');
      expect(diag?.message).toContain('truncated');
    });

    it('flags a font whose directory survives but whose tables do not', () => {
      const truncated = real.subarray(0, 12 + 16 * real.readUInt16BE(4) + 64);
      const diag = validateFontStructure(truncated, 500, false, 'Life Sans');
      expect(diag?.code).toBe('FONT_UNREADABLE');
      expect(diag?.message).toContain('truncated');
    });

    it('flags bytes shorter than an sfnt header', () => {
      const diag = validateFontStructure(
        Buffer.from([0x00, 0x01, 0x00, 0x00]),
        400,
        false,
        'Stub'
      );
      expect(diag?.code).toBe('FONT_UNREADABLE');
      expect(diag?.message).toContain('shorter than an sfnt header');
    });

    it('flags an empty table directory', () => {
      // The shape of the registry suite's minimal buffer: magic plus zeros.
      const buf = Buffer.concat([
        Buffer.from([0x00, 0x01, 0x00, 0x00]),
        Buffer.alloc(64),
      ]);
      const diag = validateFontStructure(buf, 400, false, 'Minimal');
      expect(diag?.code).toBe('FONT_UNREADABLE');
      expect(diag?.message).toContain('directory is empty');
    });
  });

  describe('missing or unreadable tables', () => {
    it('flags a font with no name table', () => {
      const buf = Buffer.from(real);
      buf.write('xxxx', directoryEntry(buf, 'name'), 4, 'ascii');
      const diag = validateFontStructure(buf, 500, false, 'Life Sans');
      expect(diag?.code).toBe('FONT_UNREADABLE');
      expect(diag?.message).toContain('no "name" table');
    });

    it('flags a font with no head table', () => {
      const buf = Buffer.from(real);
      buf.write('xxxx', directoryEntry(buf, 'head'), 4, 'ascii');
      expect(
        validateFontStructure(buf, 500, false, 'Life Sans')?.message
      ).toContain('no "head" table');
    });

    it('flags a font carrying no glyph outlines', () => {
      const buf = Buffer.from(real);
      buf.write('xxxx', directoryEntry(buf, 'glyf'), 4, 'ascii');
      expect(
        validateFontStructure(buf, 500, false, 'Life Sans')?.message
      ).toContain('no glyph outlines');
    });

    it('flags a name table present but unreadable', () => {
      // Present in the directory, but its string storage points outside the
      // table — every record is skipped, so nothing can index the face.
      const buf = Buffer.from(real);
      const eo = directoryEntry(buf, 'name');
      buf.writeUInt16BE(0xfff0, buf.readUInt32BE(eo + 8) + 4);
      expect(
        validateFontStructure(buf, 500, false, 'Life Sans')?.message
      ).toContain('no readable records');
    });

    it('flags a table whose directory entry points past the end', () => {
      const buf = Buffer.from(real);
      buf.writeUInt32BE(buf.length + 1024, directoryEntry(buf, 'name') + 8);
      const diag = validateFontStructure(buf, 500, false, 'Life Sans');
      expect(diag?.code).toBe('FONT_UNREADABLE');
      expect(diag?.message).toContain('"name" table runs to byte');
    });
  });

  it('rejects bytes that are not sfnt at all', () => {
    const diag = validateFontStructure(
      Buffer.alloc(64, 0x41),
      400,
      false,
      'NotAFont'
    );
    expect(diag?.code).toBe('FONT_UNREADABLE');
    expect(diag?.message).toContain('neither TrueType nor OpenType');
  });

  it('names the face and says what goes wrong for a reader', () => {
    const diag = validateFontStructure(
      real.subarray(0, 40),
      700,
      true,
      'Life Sans'
    );
    expect(diag?.message).toContain('Font "Life Sans" weight 700 italic');
    expect(diag?.message).toContain('renders in a fallback');
  });

  it('does not flag a stub directory that satisfies every requirement', () => {
    // Guards against over-strictness: the check reads the envelope, never a
    // table's contents, so a font with unusual table lengths still passes.
    const font = buildFontWith(0x00010000, [
      { tag: 'glyf', data: Buffer.alloc(3) },
      { tag: 'loca', data: Buffer.alloc(1) },
      { tag: 'head', data: Buffer.alloc(54) },
      { tag: 'name', data: nameTable('Odd') },
      { tag: 'DSIG', data: Buffer.alloc(0) },
    ]);
    expect(validateFontStructure(font, 400, false, 'Odd')).toBeNull();
  });
});

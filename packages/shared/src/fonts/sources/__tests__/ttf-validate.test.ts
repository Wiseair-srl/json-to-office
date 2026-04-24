import { describe, it, expect } from 'vitest';
import { validateFontMetadata } from '../ttf-validate';

/** Build a TTF with both OS/2 and name tables — enough for validator probes. */
function makeFont(opts: {
  usWeightClass: number;
  name17?: string;
  name2?: string;
  /** OS/2.fsType at offset +8 (default 0 = installable/no restriction). */
  fsType?: number;
}): Buffer {
  const encode16 = (s: string): Buffer => {
    const b = Buffer.alloc(s.length * 2);
    for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2);
    return b;
  };

  const records: Array<{ nameID: number; bytes: Buffer }> = [];
  if (opts.name17 !== undefined)
    records.push({ nameID: 17, bytes: encode16(opts.name17) });
  if (opts.name2 !== undefined)
    records.push({ nameID: 2, bytes: encode16(opts.name2) });

  const storageOffset = 6 + records.length * 12;
  const nameHeader = Buffer.alloc(storageOffset);
  nameHeader.writeUInt16BE(0, 0);
  nameHeader.writeUInt16BE(records.length, 2);
  nameHeader.writeUInt16BE(storageOffset, 4);
  let running = 0;
  const chunks: Buffer[] = [];
  for (let i = 0; i < records.length; i++) {
    const off = 6 + i * 12;
    nameHeader.writeUInt16BE(3, off); // platform Windows
    nameHeader.writeUInt16BE(1, off + 2);
    nameHeader.writeUInt16BE(1033, off + 4);
    nameHeader.writeUInt16BE(records[i].nameID, off + 6);
    nameHeader.writeUInt16BE(records[i].bytes.length, off + 8);
    nameHeader.writeUInt16BE(running, off + 10);
    chunks.push(records[i].bytes);
    running += records[i].bytes.length;
  }
  const nameTable = Buffer.concat([nameHeader, ...chunks]);

  // 10 bytes = through fsType at offset +8 (uint16).
  const os2Table = Buffer.alloc(10);
  os2Table.writeUInt16BE(4, 0); // version
  os2Table.writeInt16BE(500, 2); // xAvgCharWidth
  os2Table.writeUInt16BE(opts.usWeightClass, 4);
  os2Table.writeUInt16BE(0, 6); // usWidthClass
  os2Table.writeUInt16BE(opts.fsType ?? 0, 8);

  const numTables = 2;
  const dirOffset = 12;
  const nameTableOffset = dirOffset + numTables * 16;
  const os2TableOffset = nameTableOffset + nameTable.length;
  const total = os2TableOffset + os2Table.length;
  const buf = Buffer.alloc(total);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numTables, 4);
  // Directory entries must be sorted by tag: OS/2 then name
  buf.write('OS/2', dirOffset, 'ascii');
  buf.writeUInt32BE(0, dirOffset + 4);
  buf.writeUInt32BE(os2TableOffset, dirOffset + 8);
  buf.writeUInt32BE(os2Table.length, dirOffset + 12);
  buf.write('name', dirOffset + 16, 'ascii');
  buf.writeUInt32BE(0, dirOffset + 16 + 4);
  buf.writeUInt32BE(nameTableOffset, dirOffset + 16 + 8);
  buf.writeUInt32BE(nameTable.length, dirOffset + 16 + 12);
  nameTable.copy(buf, nameTableOffset);
  os2Table.copy(buf, os2TableOffset);
  return buf;
}

describe('validateFontMetadata', () => {
  it('returns empty for a correctly-tagged font', () => {
    const font = makeFont({
      usWeightClass: 300,
      name17: 'Light',
      name2: 'Regular',
    });
    expect(validateFontMetadata(font, 300, false, 'Test')).toEqual([]);
  });

  it('flags wrong usWeightClass (Chivo/Mada pattern)', () => {
    const font = makeFont({
      usWeightClass: 400,
      name17: 'Light',
      name2: 'Regular',
    });
    const diags = validateFontMetadata(font, 300, false, 'Chivo');
    expect(diags.some((d) => d.code === 'WEIGHT_CLASS_MISMATCH')).toBe(true);
  });

  it('flags duplicate usWeightClass collapse (Exo/Inter pattern)', () => {
    const font = makeFont({
      usWeightClass: 250,
      name17: 'ExtraLight',
      name2: 'Regular',
    });
    const diags = validateFontMetadata(font, 200, false, 'Exo');
    // 250 ≠ 200 → WEIGHT_CLASS_MISMATCH (same symptom, different root cause).
    expect(diags.some((d) => d.code === 'WEIGHT_CLASS_MISMATCH')).toBe(true);
  });

  it('flags non-unique subfamily (Manrope/Recursive pattern)', () => {
    const font = makeFont({
      usWeightClass: 300,
      name17: 'Regular',
      name2: 'Regular',
    });
    const diags = validateFontMetadata(font, 300, false, 'Manrope');
    expect(diags.some((d) => d.code === 'SUBFAMILY_MISMATCH')).toBe(true);
  });

  it('flags wrong legacy nameID 2 for bold', () => {
    const font = makeFont({
      usWeightClass: 700,
      name17: 'Bold',
      name2: 'Regular',
    });
    const diags = validateFontMetadata(font, 700, false, 'Test');
    expect(diags.some((d) => d.code === 'LEGACY_SUBFAMILY_MISMATCH')).toBe(
      true
    );
  });

  it('ignores fsType embedding-permission bits (we never embed bytes)', () => {
    // Previously emitted FSTYPE_RESTRICTED/PREVIEW_PRINT/EDITABLE. Removed
    // because substitute mode rewrites the tree and custom mode ships
    // references as-is; neither path embeds font bytes in the Office output.
    for (const fsType of [0x0002, 0x0004, 0x0008, 0x0002 | 0x0004 | 0x0008]) {
      const font = makeFont({
        usWeightClass: 400,
        name17: 'Regular',
        name2: 'Regular',
        fsType,
      });
      const diags = validateFontMetadata(font, 400, false, 'Any');
      expect(diags.every((d) => !/^FSTYPE_/.test(d.code))).toBe(true);
    }
  });

  it('returns empty when the name table is truncated past the claimed count', () => {
    // Construct a font whose name-table header claims 100 records but the
    // actual buffer only has room for a handful. Without the per-iteration
    // length guard, the loop would read garbage from out-of-bounds offsets
    // and either throw or emit spurious diagnostics.
    const truncatedNameHeader = Buffer.alloc(6);
    truncatedNameHeader.writeUInt16BE(0, 0);
    truncatedNameHeader.writeUInt16BE(100, 2); // lie: 100 records
    truncatedNameHeader.writeUInt16BE(6, 4);

    const os2Table = Buffer.alloc(10);
    os2Table.writeUInt16BE(4, 0);
    os2Table.writeInt16BE(500, 2);
    os2Table.writeUInt16BE(400, 4);

    const numTables = 2;
    const dirOffset = 12;
    const nameTableOffset = dirOffset + numTables * 16;
    const os2TableOffset = nameTableOffset + truncatedNameHeader.length;
    const total = os2TableOffset + os2Table.length;
    const buf = Buffer.alloc(total);
    buf.writeUInt32BE(0x00010000, 0);
    buf.writeUInt16BE(numTables, 4);
    buf.write('OS/2', dirOffset, 'ascii');
    buf.writeUInt32BE(os2TableOffset, dirOffset + 8);
    buf.writeUInt32BE(os2Table.length, dirOffset + 12);
    buf.write('name', dirOffset + 16, 'ascii');
    buf.writeUInt32BE(nameTableOffset, dirOffset + 16 + 8);
    buf.writeUInt32BE(truncatedNameHeader.length, dirOffset + 16 + 12);
    truncatedNameHeader.copy(buf, nameTableOffset);
    os2Table.copy(buf, os2TableOffset);

    // Validator should not throw; it may emit a non-FSTYPE diagnostic, but
    // nothing weight-related since usWeight matches and name probes return [].
    expect(() =>
      validateFontMetadata(buf, 400, false, 'Truncated')
    ).not.toThrow();
    const diags = validateFontMetadata(buf, 400, false, 'Truncated');
    expect(diags).toEqual([]);
  });

  it('skips non-standard weights gracefully', () => {
    const font = makeFont({
      usWeightClass: 350,
      name17: 'whatever',
      name2: 'Regular',
    });
    const diags = validateFontMetadata(font, 350, false, 'Test');
    // usWeightClass matches requested → no weight mismatch. No subfamily
    // expectation for non-standard weights.
    expect(diags).toEqual([]);
  });
});

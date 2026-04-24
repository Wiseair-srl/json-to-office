import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { rewriteFontFamilyName } from '../ttf-name';
import { validateFontMetadata } from '../ttf-validate';

const FIXTURE = path.resolve(
  __dirname,
  '../../../../../core-docx/src/styles/fonts/life-sans/LifeSans-Medium.ttf'
);

/** Parse a TTF's name table and pull every record's string. */
function readNameStrings(buf: Buffer): Map<number, string[]> {
  const numTables = buf.readUInt16BE(4);
  let nameOff = -1;
  let nameLen = -1;
  for (let i = 0; i < numTables; i += 1) {
    const eo = 12 + i * 16;
    const tag = buf.toString('ascii', eo, eo + 4);
    if (tag === 'name') {
      nameOff = buf.readUInt32BE(eo + 8);
      nameLen = buf.readUInt32BE(eo + 12);
    }
  }
  if (nameOff === -1) throw new Error('no name table');
  const nb = buf.slice(nameOff, nameOff + nameLen);
  const count = nb.readUInt16BE(2);
  const stringOffset = nb.readUInt16BE(4);
  const out = new Map<number, string[]>();
  for (let i = 0; i < count; i += 1) {
    const ro = 6 + i * 12;
    const platformID = nb.readUInt16BE(ro);
    const nameID = nb.readUInt16BE(ro + 6);
    const length = nb.readUInt16BE(ro + 8);
    const off = nb.readUInt16BE(ro + 10);
    const bytes = nb.slice(stringOffset + off, stringOffset + off + length);
    const str =
      platformID === 1
        ? bytes.toString('ascii')
        : bytes.toString('utf16le').replace(/./g, (c) => {
            // UTF-16BE → manually swap for toString('utf16le')
            return c;
          });
    // Proper UTF-16BE decode
    let decoded = '';
    if (platformID === 1) {
      decoded = bytes.toString('ascii');
    } else {
      for (let j = 0; j < bytes.length; j += 2) {
        decoded += String.fromCharCode(bytes.readUInt16BE(j));
      }
    }
    const list = out.get(nameID) ?? [];
    list.push(decoded);
    out.set(nameID, list);
    void str;
  }
  return out;
}

describe('rewriteFontFamilyName', () => {
  const original = readFileSync(FIXTURE);

  it('is a no-op for non-sfnt input', () => {
    const junk = Buffer.from('not a font');
    expect(rewriteFontFamilyName(junk, 'Whatever')).toBe(junk);
  });

  it('rewrites nameID 1/4/6/16 to the new family name', () => {
    const out = rewriteFontFamilyName(original, 'Synth Light');
    const names = readNameStrings(out);
    for (const id of [1, 4, 16]) {
      const entries = names.get(id) ?? [];
      expect(entries.length).toBeGreaterThan(0);
      for (const s of entries) {
        expect(s).toBe('Synth Light');
      }
    }
    // PostScript name should have spaces stripped.
    const psNames = names.get(6) ?? [];
    for (const s of psNames) expect(s).toBe('SynthLight');
  });

  it('leaves other name records untouched', () => {
    const out = rewriteFontFamilyName(original, 'Whatever');
    const before = readNameStrings(original);
    const after = readNameStrings(out);
    // nameID=2 (subfamily) should be preserved identical.
    expect(after.get(2)).toEqual(before.get(2));
  });

  it('strips OpenType-forbidden chars from PostScript name (ID 6)', () => {
    const out = rewriteFontFamilyName(original, 'Weird(Name)<test>');
    const names = readNameStrings(out);
    const psNames = names.get(6) ?? [];
    expect(psNames.length).toBeGreaterThan(0);
    for (const s of psNames) {
      expect(s).toBe('WeirdNametest');
    }
    // Family (nameID 1) is not subject to the same restriction.
    for (const s of names.get(1) ?? []) {
      expect(s).toBe('Weird(Name)<test>');
    }
  });

  it('produces bytes that validateFontMetadata can still parse', () => {
    // Original fixture passes validation for weight 500 (Medium, non-italic).
    // Rewriting the family name must not perturb OS/2 or name records other
    // than the targeted family IDs, so diagnostics should be identical.
    const before = validateFontMetadata(original, 500, false, 'LifeSans');
    const out = rewriteFontFamilyName(original, 'Synth Medium');
    const after = validateFontMetadata(out, 500, false, 'SynthMedium');
    // Same set of diagnostic codes — name rewrite is orthogonal to OS/2
    // and subfamily (nameID 2/17) checks.
    expect(after.map((d) => d.code).sort()).toEqual(
      before.map((d) => d.code).sort()
    );
  });

  it('produces a valid sfnt (recognisable header, parseable name table)', () => {
    const out = rewriteFontFamilyName(original, 'Probe');
    // sfnt magic preserved
    expect(out.readUInt32BE(0)).toBe(original.readUInt32BE(0));
    // numTables preserved
    expect(out.readUInt16BE(4)).toBe(original.readUInt16BE(4));
    // Readable name table
    const names = readNameStrings(out);
    expect(names.get(1)?.[0]).toBe('Probe');
  });
});

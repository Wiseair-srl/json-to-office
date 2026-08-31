import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  legacySubfamilyName,
  readFontFamilyNames,
  rewriteFontFamilyName,
  rewriteFontSubfamilyNames,
  standardSubfamilyNames,
} from '../ttf-name';
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

  it('keeps full + PostScript names distinct across a family when given a subfamily', () => {
    // The four RIBBI faces share one family name and are told apart by the
    // style bits, so nameID 4/6 have to carry the style or roman and italic
    // become indistinguishable — Core Text may then refuse to register the
    // second of the pair at all.
    const roman = readNameStrings(rewriteFontFamilyName(original, 'Inter'));
    const italic = readNameStrings(
      rewriteFontFamilyName(original, 'Inter', 'Italic')
    );
    const boldItalic = readNameStrings(
      rewriteFontFamilyName(original, 'Inter', 'Bold Italic')
    );

    // Family IDs are the family alone, in every face.
    for (const names of [roman, italic, boldItalic]) {
      for (const id of [1, 16]) {
        for (const s of names.get(id) ?? []) expect(s).toBe('Inter');
      }
    }
    for (const s of roman.get(4) ?? []) expect(s).toBe('Inter');
    for (const s of italic.get(4) ?? []) expect(s).toBe('Inter Italic');
    for (const s of boldItalic.get(4) ?? [])
      expect(s).toBe('Inter Bold Italic');
    for (const s of roman.get(6) ?? []) expect(s).toBe('Inter');
    for (const s of italic.get(6) ?? []) expect(s).toBe('Inter-Italic');
    for (const s of boldItalic.get(6) ?? []) {
      expect(s).toBe('Inter-BoldItalic');
    }
  });

  it('treats an explicit "Regular" subfamily as no suffix at all', () => {
    // A family's default face is named after the family, not "X Regular" —
    // and this is the path every weight-synthesized alias takes ("Inter
    // Medium" is the Regular member of its own family), so it must stay
    // byte-identical to the no-subfamily call.
    const bare = rewriteFontFamilyName(original, 'Inter Medium');
    const regular = rewriteFontFamilyName(original, 'Inter Medium', 'Regular');
    expect(regular.equals(bare)).toBe(true);
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
    // than the targeted family IDs, so diagnostics should be identical. Each
    // side is validated under the family its bytes actually declare, so the
    // comparison isn't smuggling a FAMILY_MISMATCH through both.
    const before = validateFontMetadata(original, 500, false, 'Life Sans');
    const out = rewriteFontFamilyName(original, 'Synth Medium');
    const after = validateFontMetadata(out, 500, false, 'Synth Medium');
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

describe('standardSubfamilyNames', () => {
  it('maps standard weights to typographic + RIBBI legacy forms', () => {
    expect(standardSubfamilyNames(400, false)).toEqual({
      typographic: 'Regular',
      legacy: 'Regular',
    });
    expect(standardSubfamilyNames(700, false)).toEqual({
      typographic: 'Bold',
      legacy: 'Bold',
    });
    expect(standardSubfamilyNames(700, true)).toEqual({
      typographic: 'Bold Italic',
      legacy: 'Bold Italic',
    });
    // Legacy collapses to RIBBI: SemiBold+ maps to Bold, lighter to Regular.
    expect(standardSubfamilyNames(600, true)).toEqual({
      typographic: 'SemiBold Italic',
      legacy: 'Bold Italic',
    });
    expect(standardSubfamilyNames(300, true)).toEqual({
      typographic: 'Light Italic',
      legacy: 'Italic',
    });
  });

  it('returns null for non-standard weights', () => {
    expect(standardSubfamilyNames(450, false)).toBeNull();
    expect(standardSubfamilyNames(0, false)).toBeNull();
  });
});

describe('rewriteFontSubfamilyNames', () => {
  const original = readFileSync(FIXTURE);

  it('is a no-op for non-sfnt input', () => {
    const junk = Buffer.from('not a font');
    expect(rewriteFontSubfamilyNames(junk, 700, false)).toBe(junk);
  });

  it('is a no-op for non-standard weights', () => {
    expect(rewriteFontSubfamilyNames(original, 450, false)).toBe(original);
  });

  it('stamps nameID 2/17 with the standard subfamily for the pair', () => {
    const out = rewriteFontSubfamilyNames(original, 700, false);
    const names = readNameStrings(out);
    const legacy = names.get(2) ?? [];
    expect(legacy.length).toBeGreaterThan(0);
    for (const s of legacy) expect(s).toBe('Bold');
    // Typographic subfamily only rewritten where the font carries one.
    for (const s of names.get(17) ?? []) expect(s).toBe('Bold');
  });

  it('leaves family records untouched', () => {
    const out = rewriteFontSubfamilyNames(original, 700, false);
    const before = readNameStrings(original);
    const after = readNameStrings(out);
    for (const id of [1, 4, 6, 16]) {
      expect(after.get(id)).toEqual(before.get(id));
    }
  });

  it('clears subfamily diagnostics without blunting the validator', () => {
    // The fixture is a Medium (500); asked to represent 700 it mismatches
    // on both subfamily names and OS/2.usWeightClass.
    const beforeCodes = validateFontMetadata(original, 700, false, 'X').map(
      (d) => d.code
    );
    expect(beforeCodes).toContain('LEGACY_SUBFAMILY_MISMATCH');

    const out = rewriteFontSubfamilyNames(original, 700, false);
    const afterCodes = validateFontMetadata(out, 700, false, 'X').map(
      (d) => d.code
    );
    expect(afterCodes).not.toContain('LEGACY_SUBFAMILY_MISMATCH');
    expect(afterCodes).not.toContain('SUBFAMILY_MISMATCH');
    // usWeightClass still reports the mismatch — names were fixed, not
    // the validator's other checks.
    expect(afterCodes).toContain('WEIGHT_CLASS_MISMATCH');
  });
});

/** Offset and length of the `name` table in an sfnt buffer. */
function nameTableSpan(buf: Buffer): { offset: number; length: number } {
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const eo = 12 + i * 16;
    if (buf.toString('ascii', eo, eo + 4) === 'name') {
      return {
        offset: buf.readUInt32BE(eo + 8),
        length: buf.readUInt32BE(eo + 12),
      };
    }
  }
  throw new Error('no name table');
}

describe('format-1 name tables', () => {
  // `buildNameTable` only emits format 0, which has no language-tag section.
  // Rewriting a format-1 table through it would drop the tags while keeping
  // languageIDs >= 0x8000 that index into them, leaving records pointing at
  // nothing. Refusing the rewrite keeps the font intact.
  const formatOne = (): Buffer => {
    const buf = Buffer.from(readFileSync(FIXTURE));
    const { offset } = nameTableSpan(buf);
    buf.writeUInt16BE(1, offset);
    return buf;
  };

  it('leaves the font untouched rather than stripping language tags', () => {
    const input = formatOne();
    expect(rewriteFontFamilyName(input, 'Renamed')).toEqual(input);
    expect(
      rewriteFontSubfamilyNames(input, standardSubfamilyNames('Bold'))
    ).toEqual(input);
  });

  it('still rewrites an ordinary format-0 table', () => {
    const input = Buffer.from(readFileSync(FIXTURE));
    expect(rewriteFontFamilyName(input, 'Renamed')).not.toEqual(input);
  });
});

describe('readFontFamilyNames', () => {
  const original = readFileSync(FIXTURE);

  it('reports every distinct family name the font declares', () => {
    // The fixture is a Medium shipped as its own family: nameID 1 says
    // "Life Sans Medium" while nameID 16 still says "Life Sans". Both are
    // legitimate ways to reach it, so both have to come back.
    const declared = readFontFamilyNames(original);
    expect(declared).toContain('Life Sans Medium');
    expect(declared).toContain('Life Sans');
    // Deduped across the platform records that repeat each string.
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('reads back whatever rewriteFontFamilyName just stamped', () => {
    const out = rewriteFontFamilyName(original, 'Inter', 'Italic');
    expect(readFontFamilyNames(out)).toEqual(['Inter']);
  });

  it('returns nothing for bytes with no readable name table', () => {
    expect(readFontFamilyNames(Buffer.from('not a font'))).toEqual([]);
  });
});

describe('legacySubfamilyName', () => {
  it('maps the bold/italic pair onto the four-style vocabulary', () => {
    expect(legacySubfamilyName(false, false)).toBe('Regular');
    expect(legacySubfamilyName(false, true)).toBe('Italic');
    expect(legacySubfamilyName(true, false)).toBe('Bold');
    expect(legacySubfamilyName(true, true)).toBe('Bold Italic');
  });
});

/**
 * Post-fetch metadata validation for TTF/OTF bytes. Catches the three known
 * classes of defects that surface in Google Fonts' redistribution pipeline:
 *
 * 1. Wrong `OS/2.usWeightClass`          (Chivo Light, Mada Regular, Petrona)
 * 2. Duplicate usWeightClass across weights  (Exo Thin/ExtraLight)
 * 3. Non-unique `name` subfamily records     (Inter, Manrope, Recursive)
 *
 * We don't throw on mismatch — both our patch helpers (`patchUsWeightClass`,
 * `normalizeNameTable`) have already tried to fix the bytes. The validator
 * returns human-readable diagnostics so the caller can emit warnings tagged
 * `FONT_METADATA_DEFECT`, pointing users at the upstream override escape
 * hatch before they ship a broken document.
 */

const HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

interface NameProbe {
  platformID: number;
  nameID: number;
  value: string;
}

function readTable(
  ttf: Buffer,
  tag: string
): { off: number; len: number } | null {
  if (ttf.length < HEADER_SIZE) return null;
  const version = ttf.readUInt32BE(0);
  if (version !== 0x00010000 && version !== 0x4f54544f) return null;
  const numTables = ttf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const r = HEADER_SIZE + i * TABLE_RECORD_SIZE;
    if (r + TABLE_RECORD_SIZE > ttf.length) return null;
    if (ttf.toString('ascii', r, r + 4) === tag) {
      return { off: ttf.readUInt32BE(r + 8), len: ttf.readUInt32BE(r + 12) };
    }
  }
  return null;
}

function readUsWeightClass(ttf: Buffer): number | null {
  const os2 = readTable(ttf, 'OS/2');
  if (!os2) return null;
  if (os2.off + 6 > ttf.length) return null;
  return ttf.readUInt16BE(os2.off + 4);
}

function readNames(ttf: Buffer, wanted: Set<number>): NameProbe[] {
  const nt = readTable(ttf, 'name');
  if (!nt) return [];
  const tableOff = nt.off;
  // Name-table header is 6 bytes (format, count, stringOffset) before the
  // first name record. Reject obviously-truncated tables up front so we
  // don't read count/storageRel past the buffer's end on malformed fonts.
  if (tableOff + 6 > ttf.length) return [];
  const count = ttf.readUInt16BE(tableOff + 2);
  const storageRel = ttf.readUInt16BE(tableOff + 4);
  const storage = tableOff + storageRel;
  const out: NameProbe[] = [];
  for (let j = 0; j < count; j++) {
    const r = tableOff + 6 + j * 12;
    // Each name record is 12 bytes. Stop as soon as the claimed count
    // would walk past the buffer — a malformed font claiming count=999999
    // would otherwise read garbage on each iteration.
    if (r + 12 > ttf.length) break;
    const platformID = ttf.readUInt16BE(r);
    const nameID = ttf.readUInt16BE(r + 6);
    if (!wanted.has(nameID)) continue;
    const length = ttf.readUInt16BE(r + 8);
    const offset = ttf.readUInt16BE(r + 10);
    const raw = ttf.slice(storage + offset, storage + offset + length);
    let value: string;
    if (platformID === 1) {
      value = raw.toString('ascii');
    } else {
      // Decode UTF-16BE. Buffer has no direct utf16be support; swap bytes.
      const swapped = Buffer.from(raw);
      if (swapped.length % 2 === 0) swapped.swap16();
      value = swapped.toString('utf16le');
    }
    out.push({ platformID, nameID, value });
  }
  return out;
}

export interface FontMetadataDiagnostic {
  code:
    | 'WEIGHT_CLASS_MISMATCH'
    | 'SUBFAMILY_MISMATCH'
    | 'LEGACY_SUBFAMILY_MISMATCH';
  message: string;
}

const STANDARD_SUBFAMILY: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

/**
 * Inspect a font's metadata against the weight + italic we asked it to
 * represent. Returns one diagnostic per detected defect.
 */
export function validateFontMetadata(
  ttf: Buffer,
  weight: number,
  italic: boolean,
  familyLabel: string
): FontMetadataDiagnostic[] {
  const diags: FontMetadataDiagnostic[] = [];
  const usWeight = readUsWeightClass(ttf);
  if (usWeight != null && usWeight !== weight) {
    diags.push({
      code: 'WEIGHT_CLASS_MISMATCH',
      message: `Font "${familyLabel}" weight ${weight}: OS/2.usWeightClass reports ${usWeight}. Likely a defective redistribution — consider adding an upstream override.`,
    });
  }

  // OS/2.fsType (embedding-permission bits) deliberately NOT checked. Office
  // output never embeds font bytes anymore — substitute mode rewrites to
  // SAFE_FONTS, custom mode ships references as-is, and the LibreOffice
  // preview stager only registers bytes transiently with the converter's
  // child process. Permission warnings would be pure noise for every
  // Google Fonts resolution.

  const subfamily = STANDARD_SUBFAMILY[weight];
  if (!subfamily) return diags;
  const expected17 = italic ? `${subfamily} Italic` : subfamily;
  const expected2 =
    weight >= 600
      ? italic
        ? 'Bold Italic'
        : 'Bold'
      : italic
        ? 'Italic'
        : 'Regular';

  const names = readNames(ttf, new Set([2, 17]));
  for (const n of names) {
    if (n.nameID === 17 && n.value !== expected17) {
      diags.push({
        code: 'SUBFAMILY_MISMATCH',
        message: `Font "${familyLabel}" weight ${weight}${italic ? ' italic' : ''}: name record (platform ${n.platformID}) nameID 17 = "${n.value}", expected "${expected17}".`,
      });
    }
    if (n.nameID === 2 && n.value !== expected2) {
      diags.push({
        code: 'LEGACY_SUBFAMILY_MISMATCH',
        message: `Font "${familyLabel}" weight ${weight}${italic ? ' italic' : ''}: name record (platform ${n.platformID}) nameID 2 = "${n.value}", expected "${expected2}".`,
      });
    }
  }
  return diags;
}

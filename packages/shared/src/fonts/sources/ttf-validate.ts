/**
 * Post-fetch metadata validation for TTF/OTF bytes. Catches the three known
 * classes of defects that surface in Google Fonts' redistribution pipeline:
 *
 * 1. Wrong `OS/2.usWeightClass`          (Chivo Light, Mada Regular, Petrona)
 * 2. Duplicate usWeightClass across weights  (Exo Thin/ExtraLight)
 * 3. Non-unique `name` subfamily records     (Inter, Manrope, Recursive)
 * 4. A family name that isn't the one we resolved the bytes as — an
 *    instanced `InterVariable.ttf` still calls itself "Inter Variable", a
 *    vendor CDN static may call itself anything at all
 *
 * We don't throw on mismatch — the pipeline has already tried to fix the
 * bytes where it can (`rewriteFontSubfamilyNames` after variable-font
 * instancing; `rewriteFontFamilyName` at preview staging). The validator
 * returns human-readable diagnostics so the caller can emit warnings tagged
 * `FONT_METADATA_DEFECT`, pointing users at the upstream override escape
 * hatch before they ship a broken document.
 */

import {
  readFontFamilyNames,
  readNameRecords,
  standardSubfamilyNames,
} from './ttf-name';

const HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

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

export interface FontMetadataDiagnostic {
  code:
    | 'WEIGHT_CLASS_MISMATCH'
    | 'SUBFAMILY_MISMATCH'
    | 'LEGACY_SUBFAMILY_MISMATCH'
    | 'FAMILY_MISMATCH';
  message: string;
}

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

  // The bytes must answer to the family they were resolved as, or nothing
  // downstream can find them: a run says `rFonts w:ascii="Inter"` and the
  // host matches that against the font's own name table, never against the
  // registry entry or the filename. `FontRegistry` repairs this before
  // validating, so reaching here means the repair could not run (no name
  // table, a format-1 one, non-sfnt bytes) — i.e. the face really will be
  // unreachable under `familyLabel`.
  const declaredFamilies = readFontFamilyNames(ttf);
  if (
    declaredFamilies.length > 0 &&
    !declaredFamilies.includes(familyLabel.trim())
  ) {
    diags.push({
      code: 'FAMILY_MISMATCH',
      message: `Font "${familyLabel}" weight ${weight}${italic ? ' italic' : ''}: name table declares ${declaredFamilies
        .map((f) => `"${f}"`)
        .join(
          ' / '
        )}, not "${familyLabel}". Referencing runs will not resolve this face.`,
    });
  }

  const std = standardSubfamilyNames(weight, italic);
  if (!std) return diags;
  const expected17 = std.typographic;
  const expected2 = std.legacy;

  const names = readNameRecords(ttf, new Set([2, 17]));
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

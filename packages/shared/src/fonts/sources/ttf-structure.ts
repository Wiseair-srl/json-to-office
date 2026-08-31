/**
 * Structural sanity check for TTF/OTF bytes — can a font system load this at
 * all? Answered before `validateFontMetadata`, which asks the narrower
 * question of whether a loadable font's metadata says the right things.
 *
 * The gap this closes: `detectFontFormat` classifies by the four magic bytes
 * alone, so a download truncated anywhere after byte four is still 'ttf' and
 * flows on as if it were a font. Nothing downstream notices. The metadata
 * validator has no name records to check and usually no readable OS/2
 * either, so it stays silent by design; `FontRegistry`'s family stamp finds
 * no declared family to contradict and no-ops; and the bytes stage as a
 * `.ttf` that fontconfig and Core Text refuse, so the document renders in a
 * fallback face with nothing anywhere saying why.
 *
 * Deliberately NOT a full sfnt parser. It answers "will this load", not "is
 * this well-formed" — checksums, table-specific contents and glyph data are
 * out of scope. Every check here is one a font system performs before it can
 * index a face at all, which is what makes a failure worth a warning rather
 * than a matter of taste.
 */

import { readNameRecords } from './ttf-name';

export interface FontStructureDiagnostic {
  code: 'FONT_UNREADABLE';
  message: string;
}

/** sfnt versions a font system will attempt to load. */
const SFNT_VERSIONS = new Set<number>([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO' — CFF outlines
  0x74727565, // 'true'
  0x74797031, // 'typ1'
]);

const HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

/**
 * Inspect the sfnt envelope of a font we are about to hand to a font system.
 * Returns the first thing that makes it unloadable, or null.
 *
 * One diagnostic, not a list: past the first structural failure every later
 * check is reading rubble, and a caller can only act on the file as a whole
 * anyway.
 */
export function validateFontStructure(
  ttf: Buffer,
  weight: number,
  italic: boolean,
  familyLabel: string
): FontStructureDiagnostic | null {
  const face = `Font "${familyLabel}" weight ${weight}${italic ? ' italic' : ''}`;
  const unreadable = (reason: string): FontStructureDiagnostic => ({
    code: 'FONT_UNREADABLE',
    message: `${face}: ${reason} The face will not resolve; text referencing it renders in a fallback.`,
  });

  if (ttf.length < HEADER_SIZE) {
    return unreadable(
      `${ttf.length} bytes is shorter than an sfnt header — the download is truncated or empty.`
    );
  }
  const version = ttf.readUInt32BE(0);
  if (!SFNT_VERSIONS.has(version)) {
    return unreadable(
      `sfnt version 0x${version.toString(16).padStart(8, '0')} is neither TrueType nor OpenType.`
    );
  }

  const numTables = ttf.readUInt16BE(4);
  if (numTables === 0) return unreadable('its table directory is empty.');
  const directoryEnd = HEADER_SIZE + numTables * TABLE_RECORD_SIZE;
  if (directoryEnd > ttf.length) {
    return unreadable(
      `its directory claims ${numTables} tables (${directoryEnd} bytes) but the file is ${ttf.length} bytes — truncated.`
    );
  }

  // Directory offsets in range. A table pointing past the end is the shape a
  // truncated download takes once it keeps enough bytes for the directory.
  const tags = new Set<string>();
  for (let i = 0; i < numTables; i += 1) {
    const ro = HEADER_SIZE + i * TABLE_RECORD_SIZE;
    const tag = ttf.toString('ascii', ro, ro + 4);
    const offset = ttf.readUInt32BE(ro + 8);
    const length = ttf.readUInt32BE(ro + 12);
    if (offset + length > ttf.length) {
      return unreadable(
        `its "${tag}" table runs to byte ${offset + length} but the file is ${ttf.length} bytes — truncated.`
      );
    }
    tags.add(tag);
  }

  // `name` carries the family every consumer looks a face up by, and `head`
  // the units-per-em every consumer scales it with. Neither is optional.
  for (const required of ['name', 'head']) {
    if (!tags.has(required)) {
      return unreadable(`it has no "${required}" table.`);
    }
  }

  // Outlines: glyf + loca (TrueType) or a CFF table (OpenType). Without them
  // there is nothing to draw, whatever else the file carries.
  const hasTrueTypeOutlines = tags.has('glyf') && tags.has('loca');
  const hasCffOutlines = tags.has('CFF ') || tags.has('CFF2');
  if (!hasTrueTypeOutlines && !hasCffOutlines) {
    return unreadable(
      'it carries no glyph outlines (neither "glyf" + "loca" nor "CFF ").'
    );
  }

  // Present is not the same as readable: the reader bounds every record by
  // the table's own extent, so a `name` table with a corrupt header or
  // out-of-range string offsets yields nothing and the face is unindexable.
  if (readNameRecords(ttf).length === 0) {
    return unreadable('its "name" table carries no readable records.');
  }

  return null;
}

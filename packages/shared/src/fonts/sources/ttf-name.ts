/**
 * Name-table reading and rewriting for TTF/OTF sfnt fonts. Two public
 * transforms share the rebuild machinery, plus one reader:
 *
 * - `rewriteFontFamilyName` — rewrite `nameID` 1 / 4 / 6 / 16 to a
 *   synthetic family name. Used by `FontRegistry` (so resolved bytes
 *   declare the family they were resolved as) and by the preview-side
 *   font stagers (so running-text references like `"Inter Light"` resolve
 *   to the correct face). Core Text / fontconfig / GDI all index by the
 *   font's internal `name` table rather than the filename.
 *
 * - `rewriteFontSubfamilyNames` — rewrite `nameID` 2 / 17 to the standard
 *   subfamily strings for a (weight, italic) pair. Used by the variable-
 *   font instancer: harfbuzz preserves the source font's name records
 *   verbatim, so an instanced Bold would otherwise keep the variable
 *   font's default-instance "Regular" subfamily and trip
 *   `validateFontMetadata`.
 *
 * - `readNameRecords` / `readFontFamilyNames` — the reading half, shared
 *   with `validateFontMetadata` so the checker and the writer cannot
 *   drift on how a name record is located or decoded.
 *
 * Each transform rebuilds the whole font: new `name` table bytes, new
 * table directory with shifted offsets, recomputed per-table checksums,
 * and the magic `head.checkSumAdjustment` recomputed against the whole
 * output buffer. Nothing else is touched.
 *
 * OTF (CFF-flavoured) and TTF (glyf-flavoured) share the sfnt outer
 * structure, so the same code handles both.
 */

const FAMILY_NAME_IDS = new Set<number>([
  1, // Font Family
  4, // Full Font Name
  6, // PostScript Name
  16, // Typographic/Preferred Family
]);

const MAGIC_HEAD_CHECKSUM = 0xb1b0afba;

interface NameRecord {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  bytes: Buffer;
}

interface TableEntry {
  tag: string;
  checksum: number;
  /** Assigned when rebuilding. */
  offset: number;
  data: Buffer;
  originalOffset: number;
}

/**
 * Compute the 32-bit big-endian uint sum of `buf`, treating it as a
 * stream of uint32s zero-padded to a 4-byte boundary. Used for per-table
 * checksums and the whole-font `head.checkSumAdjustment`.
 */
function sfntChecksum(buf: Buffer): number {
  let sum = 0;
  const end = buf.length;
  const aligned = end - (end % 4);
  for (let i = 0; i < aligned; i += 4) {
    sum = (sum + buf.readUInt32BE(i)) >>> 0;
  }
  if (aligned < end) {
    let chunk = 0;
    const remaining = end - aligned;
    if (remaining >= 1) chunk |= buf[aligned] << 24;
    if (remaining >= 2) chunk |= buf[aligned + 1] << 16;
    if (remaining >= 3) chunk |= buf[aligned + 2] << 8;
    sum = (sum + chunk) >>> 0;
  }
  return sum >>> 0;
}

function encodeString(record: NameRecord, value: string): Buffer {
  // Platform 3 (Microsoft) and 0 (Unicode) use UTF-16 BE. Platform 1
  // (Macintosh) uses a legacy Roman encoding we approximate with ASCII —
  // non-ASCII family names are rare in this code path.
  if (record.platformID === 1) {
    return Buffer.from(value, 'ascii');
  }
  const out = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    out.writeUInt16BE(value.charCodeAt(i), i * 2);
  }
  return out;
}

function buildNameTable(records: NameRecord[]): Buffer {
  const count = records.length;
  const headerSize = 6 + count * 12;
  let heapSize = 0;
  for (const r of records) heapSize += r.bytes.length;
  const raw = Buffer.alloc(headerSize + heapSize);
  raw.writeUInt16BE(0, 0); // format 0
  raw.writeUInt16BE(count, 2);
  raw.writeUInt16BE(headerSize, 4); // stringOffset
  let heapCursor = 0;
  for (let i = 0; i < count; i += 1) {
    const r = records[i];
    const ro = 6 + i * 12;
    raw.writeUInt16BE(r.platformID, ro);
    raw.writeUInt16BE(r.encodingID, ro + 2);
    raw.writeUInt16BE(r.languageID, ro + 4);
    raw.writeUInt16BE(r.nameID, ro + 6);
    raw.writeUInt16BE(r.bytes.length, ro + 8);
    raw.writeUInt16BE(heapCursor, ro + 10);
    r.bytes.copy(raw, headerSize + heapCursor);
    heapCursor += r.bytes.length;
  }
  return raw;
}

/** Per-record decision for `rewriteNameTable`. */
type NameRewrite =
  | { action: 'keep' }
  | { action: 'drop' }
  | { action: 'set'; value: string };

/**
 * Return a copy of `input` whose name records have been mapped through
 * `decide`. Returns the original buffer unchanged if the font has no
 * `name` table or the sfnt header is invalid.
 */
function rewriteNameTable(
  input: Buffer,
  decide: (record: NameRecord) => NameRewrite
): Buffer {
  if (input.length < 12) return input;
  const version = input.readUInt32BE(0);
  // Accept sfnt (0x00010000), OTTO (OpenType CFF), true, typ1.
  const isSfnt =
    version === 0x00010000 ||
    version === 0x4f54544f /* OTTO */ ||
    version === 0x74727565 /* true */ ||
    version === 0x74797031; /* typ1 */
  if (!isSfnt) return input;

  const numTables = input.readUInt16BE(4);
  if (numTables === 0 || input.length < 12 + numTables * 16) return input;

  // Read every table's directory entry, slurp its data.
  const tables: TableEntry[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const eo = 12 + i * 16;
    const tag = input.toString('ascii', eo, eo + 4);
    const checksum = input.readUInt32BE(eo + 4);
    const offset = input.readUInt32BE(eo + 8);
    const length = input.readUInt32BE(eo + 12);
    if (offset + length > input.length) return input;
    tables.push({
      tag,
      checksum,
      offset: 0,
      originalOffset: offset,
      data: input.slice(offset, offset + length),
    });
  }

  const nameIdx = tables.findIndex((t) => t.tag === 'name');
  if (nameIdx === -1) return input;

  // Parse existing name records so we preserve all non-family entries.
  const nameBuf = tables[nameIdx].data;
  if (nameBuf.length < 6) return input;
  // `buildNameTable` emits format 0, which has no language-tag section. A
  // format-1 table keeps its tags after the name records, and any record with
  // languageID >= 0x8000 is an index into them — rewriting it as format 0
  // would strip the tags and leave those records pointing at nothing. Leaving
  // the font unstamped is the lesser loss, so hand it back untouched.
  // Preserving the tag section (and re-homing its string offsets) is the
  // follow-up if a real font ever needs the rewrite.
  if (nameBuf.readUInt16BE(0) !== 0) return input;
  const recordCount = nameBuf.readUInt16BE(2);
  const stringOffset = nameBuf.readUInt16BE(4);
  if (nameBuf.length < 6 + recordCount * 12) return input;

  const records: NameRecord[] = [];
  for (let i = 0; i < recordCount; i += 1) {
    const ro = 6 + i * 12;
    const platformID = nameBuf.readUInt16BE(ro);
    const encodingID = nameBuf.readUInt16BE(ro + 2);
    const languageID = nameBuf.readUInt16BE(ro + 4);
    const nameID = nameBuf.readUInt16BE(ro + 6);
    const length = nameBuf.readUInt16BE(ro + 8);
    const offset = nameBuf.readUInt16BE(ro + 10);
    const bytes = nameBuf.slice(
      stringOffset + offset,
      stringOffset + offset + length
    );
    records.push({ platformID, encodingID, languageID, nameID, bytes });
  }

  const survivors: NameRecord[] = [];
  for (const r of records) {
    const verdict = decide(r);
    if (verdict.action === 'drop') continue;
    if (verdict.action === 'set') {
      r.bytes = encodeString(r, verdict.value);
    }
    survivors.push(r);
  }
  records.length = 0;
  records.push(...survivors);

  const rebuiltName = buildNameTable(records);
  tables[nameIdx] = {
    ...tables[nameIdx],
    data: rebuiltName,
    checksum: sfntChecksum(rebuiltName),
  };

  // Preserve original physical order so tables whose offsets follow each
  // other stay contiguous (some consumers skim by offset rather than
  // directory). Offsets get reassigned either way — this is purely
  // aesthetic. Sort is stable.
  tables.sort((a, b) => a.originalOffset - b.originalOffset);

  // Assign new offsets, 4-byte aligned.
  let cursor = 12 + tables.length * 16;
  for (const t of tables) {
    cursor = (cursor + 3) & ~3;
    t.offset = cursor;
    cursor += t.data.length;
  }
  const totalSize = (cursor + 3) & ~3;

  const out = Buffer.alloc(totalSize);
  // Header — copy sfnt version, entrySelector, etc. verbatim; we preserve
  // numTables since we're not adding/removing entries.
  input.copy(out, 0, 0, 12);
  out.writeUInt16BE(tables.length, 4);

  // Directory entries go in alphabetical tag order per the sfnt spec.
  const dirTables = [...tables].sort((a, b) =>
    a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0
  );
  for (let i = 0; i < dirTables.length; i += 1) {
    const t = dirTables[i];
    const eo = 12 + i * 16;
    out.write(t.tag, eo, 4, 'ascii');
    out.writeUInt32BE(t.checksum, eo + 4);
    out.writeUInt32BE(t.offset, eo + 8);
    out.writeUInt32BE(t.data.length, eo + 12);
  }

  // Write each table's bytes at its new offset. `out` is zero-filled, so
  // the 0–3 byte alignment padding after each table is already correct.
  for (const t of tables) {
    t.data.copy(out, t.offset);
  }

  // Recompute head.checkSumAdjustment. The algorithm: zero the field,
  // sum the whole font, then set the field to MAGIC - sum.
  const headTable = tables.find((t) => t.tag === 'head');
  if (headTable && headTable.data.length >= 12) {
    out.writeUInt32BE(0, headTable.offset + 8);
    const fontSum = sfntChecksum(out);
    const adjustment = (MAGIC_HEAD_CHECKSUM - fontSum) >>> 0;
    out.writeUInt32BE(adjustment, headTable.offset + 8);
  }

  return out;
}

/** One decoded `name` record: where it came from and what it says. */
export interface DecodedNameRecord {
  platformID: number;
  nameID: number;
  value: string;
}

/** Byte range of `tag`'s table within `input`, or null. */
function findTable(
  input: Buffer,
  tag: string
): { offset: number; length: number } | null {
  if (input.length < 12) return null;
  const numTables = input.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const eo = 12 + i * 16;
    if (eo + 16 > input.length) return null;
    if (input.toString('ascii', eo, eo + 4) === tag) {
      return {
        offset: input.readUInt32BE(eo + 8),
        length: input.readUInt32BE(eo + 12),
      };
    }
  }
  return null;
}

/**
 * Read the `name` records a font carries, optionally narrowed to `wanted`
 * nameIDs. Tolerant of malformed tables — a record that would read past the
 * buffer ends the scan rather than throwing, because these bytes come off
 * the network.
 *
 * Shared with `validateFontMetadata` so the checker and the rewriters above
 * cannot disagree about what a font declares.
 */
export function readNameRecords(
  input: Buffer,
  wanted?: Set<number>
): DecodedNameRecord[] {
  const nt = findTable(input, 'name');
  if (!nt) return [];
  const tableOff = nt.offset;
  if (tableOff + 6 > input.length) return [];
  const count = input.readUInt16BE(tableOff + 2);
  const storage = tableOff + input.readUInt16BE(tableOff + 4);
  const out: DecodedNameRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const ro = tableOff + 6 + i * 12;
    if (ro + 12 > input.length) break;
    const platformID = input.readUInt16BE(ro);
    const nameID = input.readUInt16BE(ro + 6);
    if (wanted && !wanted.has(nameID)) continue;
    const length = input.readUInt16BE(ro + 8);
    const offset = input.readUInt16BE(ro + 10);
    const raw = input.slice(storage + offset, storage + offset + length);
    let value: string;
    if (platformID === 1) {
      value = raw.toString('ascii');
    } else {
      // UTF-16BE. Buffer has no utf16be decoder — swap to LE and decode.
      const swapped = Buffer.from(raw);
      if (swapped.length % 2 === 0) swapped.swap16();
      value = swapped.toString('utf16le');
    }
    out.push({ platformID, nameID, value });
  }
  return out;
}

/**
 * Every distinct family name a font declares — `nameID` 1 (family) and 16
 * (typographic/preferred family), deduped, in record order.
 *
 * Both count: a weight shipped as its own family names itself "Life Sans
 * Medium" in nameID 1 while nameID 16 still says "Life Sans", and either
 * is a legitimate way for a consumer to find it. Callers asking "do these
 * bytes answer to family X?" must therefore accept a match on either.
 */
export function readFontFamilyNames(input: Buffer): string[] {
  const out: string[] = [];
  for (const r of readNameRecords(input, FAMILY_LOOKUP_IDS)) {
    const value = r.value.trim();
    if (value.length > 0 && !out.includes(value)) out.push(value);
  }
  return out;
}

const FAMILY_LOOKUP_IDS = new Set<number>([1, 16]);

/**
 * The RIBBI style label a face carries alongside its family name — the
 * four-style vocabulary `nameID` 2 is restricted to. Used to build the
 * full (`nameID` 4) and PostScript (`nameID` 6) names, which must stay
 * distinct across the faces of one family.
 */
export function legacySubfamilyName(
  bold: boolean,
  italic: boolean
): 'Regular' | 'Italic' | 'Bold' | 'Bold Italic' {
  if (bold) return italic ? 'Bold Italic' : 'Bold';
  return italic ? 'Italic' : 'Regular';
}

/**
 * Return a copy of `input` whose name table has `nameID` 1/4/6/16 rewritten
 * to `newFamily`. Returns the original buffer unchanged if the font has no
 * `name` table or the sfnt header is invalid.
 *
 * `subfamily` is the RIBBI style this face occupies *within* `newFamily`.
 * The family IDs (1/16) always become `newFamily` alone, but the full name
 * (4) and PostScript name (6) take the style as a suffix, so the four faces
 * of one family stay individually addressable — "Inter" / "Inter Italic" /
 * "Inter Bold" / "Inter Bold Italic", PostScript "Inter" / "Inter-Italic" /
 * … Two faces sharing a PostScript name is malformed, and Core Text may
 * refuse the second registration outright.
 *
 * Omitted (or "Regular") reproduces the historical behaviour — every
 * targeted ID becomes `newFamily` — which is correct for a face staged
 * under a weight-synthesized family of its own ("Inter Medium"), where the
 * face IS that family's Regular member.
 */
export function rewriteFontFamilyName(
  input: Buffer,
  newFamily: string,
  subfamily?: string
): Buffer {
  // "Regular" is the absence of a style suffix, not a suffix reading
  // "Regular" — a family's default face is named after the family alone.
  const style = subfamily && subfamily !== 'Regular' ? subfamily : '';
  const fullName = style ? `${newFamily} ${style}` : newFamily;
  // PostScript names (nameID 6) are restricted to printable ASCII 33-126
  // minus `[](){}<>/%` per the OpenType spec — fold spaces out and strip
  // any forbidden chars so Word doesn't silently reject the font. The
  // style rides as a hyphenated suffix, the convention every shipped
  // family uses ("Inter-BoldItalic").
  const psForbidden = /[[\](){}<>/%]/g;
  // eslint-disable-next-line no-control-regex
  const isAscii = /^[\x00-\x7f]*$/.test(fullName);
  const psSafe = (s: string): string =>
    s
      .replace(/\s+/g, '')
      .replace(psForbidden, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x21-\x7e]/g, '');
  const psName = style
    ? `${psSafe(newFamily)}-${psSafe(style)}`
    : psSafe(newFamily);
  return rewriteNameTable(input, (r) => {
    if (!FAMILY_NAME_IDS.has(r.nameID)) return { action: 'keep' };
    // Platform 1 (Macintosh Roman) only round-trips ASCII. For non-ASCII
    // family names (e.g. CJK), `Buffer.from(value, 'ascii')` silently
    // drops the high bytes and produces garbled Roman-encoded strings
    // that Core Text may still index. Drop those records instead —
    // platforms 0 (Unicode) and 3 (Microsoft) carry the UTF-16 form and
    // are what modern consumers prefer anyway.
    if (r.platformID === 1 && !isAscii) return { action: 'drop' };
    if (r.nameID === 6) return { action: 'set', value: psName };
    if (r.nameID === 4) return { action: 'set', value: fullName };
    return { action: 'set', value: newFamily };
  });
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
 * Standard OpenType subfamily strings for a (weight, italic) pair, or null
 * for a non-standard weight. `typographic` is the nameID 17 form (full
 * weight vocabulary); `legacy` is the nameID 2 form, restricted to the
 * four-style RIBBI model (Regular/Italic/Bold/Bold Italic) that GDI-era
 * consumers expect. Single source of truth shared with
 * `validateFontMetadata` so writer and checker cannot diverge.
 */
export function standardSubfamilyNames(
  weight: number,
  italic: boolean
): { typographic: string; legacy: string } | null {
  const base = STANDARD_SUBFAMILY[weight];
  if (!base) return null;
  return {
    typographic: italic ? `${base} Italic` : base,
    legacy: legacySubfamilyName(weight >= 600, italic),
  };
}

/**
 * Return a copy of `input` whose existing `nameID` 2/17 records carry the
 * standard subfamily strings for (weight, italic). Missing records are not
 * added. Returns the original buffer unchanged for non-standard weights,
 * or if the font has no `name` table or the sfnt header is invalid.
 */
export function rewriteFontSubfamilyNames(
  input: Buffer,
  weight: number,
  italic: boolean
): Buffer {
  const std = standardSubfamilyNames(weight, italic);
  if (!std) return input;
  return rewriteNameTable(input, (r) => {
    if (r.nameID === 2) return { action: 'set', value: std.legacy };
    if (r.nameID === 17) return { action: 'set', value: std.typographic };
    return { action: 'keep' };
  });
}

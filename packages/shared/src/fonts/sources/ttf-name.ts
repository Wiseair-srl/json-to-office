/**
 * Rewrite a TTF/OTF's `name` table so `nameID` 1 / 4 / 6 / 16 carry the
 * supplied synthetic family name. Used by the preview-side font stagers
 * so that running-text references like `"Inter Light"` resolve to the
 * correct face when the stager registers it with Core Text / fontconfig
 * / GDI (all of which index by the font's internal `name` table rather
 * than the filename).
 *
 * The transform rebuilds the whole font: new `name` table bytes, new
 * table directory with shifted offsets, recomputed per-table checksums,
 * and the magic `head.checkSumAdjustment` recomputed against the whole
 * output buffer. Nothing else is touched.
 *
 * OTF (CFF-flavoured) and TTF (glyf-flavoured) share the sfnt outer
 * structure, so the same code handles both.
 */

const TARGET_NAME_IDS = new Set<number>([
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

/**
 * Return a copy of `input` whose name table has `nameID` 1/4/6/16 rewritten
 * to `newFamily`. Returns the original buffer unchanged if the font has no
 * `name` table or the sfnt header is invalid.
 */
export function rewriteFontFamilyName(
  input: Buffer,
  newFamily: string
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

  // Rewrite target records. PostScript names (nameID 6) are restricted to
  // printable ASCII 33-126 minus `[](){}<>/%` per the OpenType spec — fold
  // spaces out and strip any forbidden chars so Word doesn't silently
  // reject the font.
  const psForbidden = /[[\](){}<>/%]/g;
  // eslint-disable-next-line no-control-regex
  const isAscii = /^[\x00-\x7f]*$/.test(newFamily);
  const survivors: NameRecord[] = [];
  for (const r of records) {
    if (!TARGET_NAME_IDS.has(r.nameID)) {
      survivors.push(r);
      continue;
    }
    // Platform 1 (Macintosh Roman) only round-trips ASCII. For non-ASCII
    // family names (e.g. CJK), `Buffer.from(value, 'ascii')` silently
    // drops the high bytes and produces garbled Roman-encoded strings
    // that Core Text may still index. Drop those records instead —
    // platforms 0 (Unicode) and 3 (Microsoft) carry the UTF-16 form and
    // are what modern consumers prefer anyway.
    if (r.platformID === 1 && !isAscii) {
      continue;
    }
    const value =
      r.nameID === 6
        ? newFamily
            .replace(/\s+/g, '')
            .replace(psForbidden, '')
            // eslint-disable-next-line no-control-regex
            .replace(/[^\x21-\x7e]/g, '')
        : newFamily;
    r.bytes = encodeString(r, value);
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

/**
 * Node-only image integrity checks.
 *
 * Imports `node:zlib`, so must NOT be pulled into browser bundles. Keep this
 * subpath separate from the main package index.
 *
 * Why a check at all: sizing an image reads only its header, so a PNG whose
 * chunks are damaged or whose pixel data is cut short sized fine, embedded
 * fine, and opened in Word or PowerPoint as "The picture can't be displayed"
 * (LibreOffice draws nothing and says nothing). The pipelines call this where
 * they first hold an image's bytes, so the defect is reported against the
 * image's source instead of shipping.
 *
 * Only what a decoder would reject is checked, and only cheaply: every PNG
 * chunk's CRC plus an inflate of its pixel data, and a JPEG's start and end
 * markers. A format this does not recognise passes; that is some other
 * reader's business.
 */

import { inflateSync } from 'node:zlib';
import { assetUnreadableError } from '../rendering/capabilities';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as PNG chunks use it. */
export function pngCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Samples per pixel by PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7 passes: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Bytes of filtered scanlines the IHDR promises. */
function expectedRawLength(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlaced: boolean
): number {
  const lines = (w: number, h: number) =>
    w > 0 && h > 0 ? h * (1 + Math.ceil((w * bitsPerPixel) / 8)) : 0;
  if (!interlaced) return lines(width, height);
  let total = 0;
  for (const [xs, ys, dx, dy] of ADAM7) {
    total += lines(Math.ceil((width - xs) / dx), Math.ceil((height - ys) / dy));
  }
  return total;
}

function pngDefect(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  let offset = 8;
  let expected: number | undefined;
  const idat: Uint8Array[] = [];
  let first = true;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      return `PNG is truncated: a chunk header at byte ${offset} is cut short`;
    }
    const length = view.getUint32(offset);
    const name = type(offset + 4);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      return `PNG is truncated: the ${name} chunk runs past the end of the file`;
    }
    const stored = view.getUint32(offset + 8 + length);
    if (pngCrc32(bytes.subarray(offset + 4, offset + 8 + length)) !== stored) {
      return `PNG ${name} chunk fails its CRC check`;
    }
    if (first) {
      if (name !== 'IHDR' || length !== 13) {
        return 'PNG does not start with an IHDR chunk';
      }
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      const bitDepth = bytes[offset + 16];
      const channels = CHANNELS[bytes[offset + 17]];
      if (width === 0 || height === 0 || channels === undefined) {
        return 'PNG IHDR describes no image';
      }
      expected = expectedRawLength(
        width,
        height,
        bitDepth * channels,
        bytes[offset + 20] === 1
      );
      first = false;
    }
    if (name === 'IDAT')
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset = end;
    if (name === 'IEND') break;
    if (offset >= bytes.length) return 'PNG is truncated: it has no IEND chunk';
  }
  if (first) return 'PNG has no chunks';
  if (idat.length === 0) return 'PNG has no image data (IDAT)';

  try {
    // Capped well above what the header promises, so a crafted stream cannot
    // inflate without bound; a decoder ignores a modest surplus. A stream
    // that ends early but cleanly is not judged: decoders draw what is there.
    inflateSync(Buffer.concat(idat), {
      maxOutputLength: Math.max((expected ?? 0) * 2, (expected ?? 0) + 65536),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `PNG image data does not decompress (${reason})`;
  }
  return undefined;
}

function jpegDefect(bytes: Uint8Array): string | undefined {
  // Trailing bytes after EOI are common and harmless, so look for the marker
  // near the end rather than insisting it is the last two bytes.
  for (let i = bytes.length - 2; i >= 2; i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return undefined;
  }
  return 'JPEG is truncated: it has no end-of-image marker';
}

/**
 * Why these bytes would not decode, or `undefined` when they would (or are not
 * a PNG or JPEG, which this does not judge).
 */
export function imageIntegrityDefect(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    return pngDefect(bytes);
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return jpegDefect(bytes);
  }
  return undefined;
}

/**
 * Throw `ASSET_UNREADABLE` naming `source` when the bytes would not decode.
 *
 * `source` is what the document named — a path, a URL, a data URI — so the
 * error points at the image to repair.
 */
export function assertImageDecodes(bytes: Uint8Array, source: string): void {
  const defect = imageIntegrityDefect(bytes);
  if (defect) throw assetUnreadableError(source, new Error(defect));
}

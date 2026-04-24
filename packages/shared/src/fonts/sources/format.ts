/**
 * Font format detection from magic bytes.
 * Source: OpenType spec + WOFF1/WOFF2 W3C specs.
 */

import type { ResolvedFontSource } from '../types';

export function detectFontFormat(buf: Buffer): ResolvedFontSource['format'] {
  if (buf.length < 4) return 'unknown';

  const b0 = buf[0],
    b1 = buf[1],
    b2 = buf[2],
    b3 = buf[3];

  // TTF: 0x00010000 (SFNT) or 'true' (0x74727565) or 'typ1' (0x74797031)
  if (
    (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
    (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) ||
    (b0 === 0x74 && b1 === 0x79 && b2 === 0x70 && b3 === 0x31)
  ) {
    return 'ttf';
  }
  // OTF: 'OTTO'
  if (b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f) return 'otf';
  // WOFF: 'wOFF'
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && b3 === 0x46) return 'woff';
  // WOFF2: 'wOF2'
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && b3 === 0x32) return 'woff2';
  // EOT: version bytes at offset 8-11 — rougher signature
  if (buf.length >= 36 && buf[34] === 0x4c && buf[35] === 0x50) return 'eot';
  // PostScript Type 1 (.pfb) — binary container marker byte 0x80 followed by
  // segment type 0x01 (ASCII). Also match the text-form ASCII header
  // "%!PS-AdobeFont". Note: .pfm (metric files) have no reliable magic and
  // stay in 'unknown' — same treatment (rejection at the loader).
  if (b0 === 0x80 && b1 === 0x01) return 'pfb';
  if (
    buf.length >= 14 &&
    buf.slice(0, 14).toString('ascii') === '%!PS-AdobeFont'
  ) {
    return 'pfb';
  }

  return 'unknown';
}

/**
 * Formats we detect but cannot legally embed in an OOXML document:
 * WOFF/WOFF2 are web-only containers; PostScript (.pfb) is explicitly
 * disallowed by Microsoft's embedding guidance.
 */
export const UNEMBEDDABLE_FORMATS = new Set<ResolvedFontSource['format']>([
  'woff',
  'woff2',
  'pfb',
]);

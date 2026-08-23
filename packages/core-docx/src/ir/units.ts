/**
 * Unit and identity helpers for DocxIR construction.
 *
 * The DOCX authoring surface mixes units — points for spacing, twips for
 * indents, pixels for image sizes, inches for a visual canvas — and the IR
 * mixes none: every value is converted here, once, into the unit its property
 * name states.
 */

import { createHash } from 'node:crypto';
import {
  EMU_PER_INCH,
  EMU_PER_TWIP,
  TWIPS_PER_INCH,
  TWIPS_PER_POINT,
} from './types';

/** Points → twips. Spacing, padding and row heights are authored in points. */
export function pointsToTwips(points: number): number {
  return Math.round(points * TWIPS_PER_POINT);
}

/** Points → half-points, the OOXML unit for a font size. */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

/** Points → eighths of a point, the OOXML unit for a border width. */
export function pointsToEighthPoints(points: number): number {
  return Math.round(points * 8);
}

/** Inches → twips. */
export function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

/**
 * Inches → EMU, directly.
 *
 * Not `twipsToEmu(inchesToTwips(x))`: that rounds twice, and a drawing canvas
 * authored in inches deserves the exact figure — 914400 is a whole number of
 * EMU per inch, so nothing is lost going straight there.
 */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

/** EMU → inches, the inverse of {@link inchesToEmu}. */
export function emuToInches(emu: number): number {
  return emu / EMU_PER_INCH;
}

/** Points → EMU, the OOXML unit for a drawing outline width. */
export function pointsToEmu(points: number): number {
  return Math.round((points * EMU_PER_INCH) / 72);
}

/** Twips → EMU. */
export function twipsToEmu(twips: number): number {
  return Math.round(twips * EMU_PER_TWIP);
}

/** Pixels at 96 DPI → EMU, which is how image extents are expressed. */
export function pixelsToEmu(pixels: number): number {
  return Math.round(pixels * 9525);
}

/** EMU → pixels at 96 DPI, the inverse of {@link pixelsToEmu}. */
export function emuToPixels(emu: number): number {
  return emu / 9525;
}

/** Pixels at 96 DPI → twips. */
export function pixelsToTwips(pixels: number): number {
  return Math.round(pixels * 15);
}

/** Twips → pixels at 96 DPI. */
export function twipsToPixels(twips: number): number {
  return (twips / TWIPS_PER_INCH) * 96;
}

/**
 * Resolve a length that may be a percentage of a containing box.
 *
 * `"50%"` resolves against `containerTwips`; a number is already twips.
 * Anything unparseable resolves to 0 rather than throwing, matching what the
 * pre-IR pipeline did.
 */
export function resolveLengthTwips(
  value: number | string,
  containerTwips: number
): number {
  if (typeof value === 'number') return Math.round(value);
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed);
    return Number.isNaN(percent)
      ? 0
      : Math.round((percent / 100) * containerTwips);
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed);
}

/**
 * Build an IR colour from an already-resolved hex string.
 *
 * Theme tokens are resolved upstream; this only strips the `#` prefix, so an
 * unresolved token cannot reach the IR by accident. Case is left alone — OOXML
 * reads hex case-insensitively, so normalising it would rewrite the bytes of
 * every document that stated a colour in lower case and change nothing else.
 */
export function irColor(hex: string): { hex: string } {
  return { hex: hex.startsWith('#') ? hex.slice(1) : hex };
}

/** Lowercase hex SHA-256, the identity used for resources. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Deterministic block id from its position in the document tree.
 *
 * Ids are derived, never allocated from a shared counter, so two concurrent
 * generations of the same document produce the same ids.
 */
export function blockId(
  sectionIndex: number,
  indexPath: readonly number[]
): string {
  return `s${sectionIndex}.${indexPath.map((i) => `b${i}`).join('.')}`;
}

/** Deterministic id for a block inside a header or footer part. */
export function headerFooterBlockId(
  partId: string,
  indexPath: readonly number[]
): string {
  return `${partId}.${indexPath.map((i) => `b${i}`).join('.')}`;
}

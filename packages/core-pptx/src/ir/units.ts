/**
 * Unit and identity helpers for PptxIR construction.
 *
 * Authoring expresses geometry in inches (or percent strings); the IR expresses
 * it in EMU. The conversion is a single rounding step, done here so every
 * compile site agrees on it — and so the PptxGenJS adapter can invert it
 * exactly by dividing, since PptxGenJS applies the same `Math.round(in * EMU)`
 * on the way in.
 */

import { createHash } from 'node:crypto';
import { EMU_PER_INCH, EMU_PER_POINT } from './types';
import type { PptxIrColor } from './types';

/** Inches → EMU. */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

/** EMU → inches. Lossless against `inchesToEmu` for realistic magnitudes. */
export function emuToInches(emu: number): number {
  return emu / EMU_PER_INCH;
}

/** Points → EMU. */
export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

/** Slide size in EMU, the frame percentages resolve against. */
export interface SlideExtentEmu {
  widthEmu: number;
  heightEmu: number;
}

/**
 * Resolve an authored dimension to EMU.
 *
 * This reproduces the authoring contract the pipeline has always had, quirks
 * included, because the numbers it produces are the numbers that end up in the
 * package:
 *
 * - a number below 100 is inches
 * - a number of 100 or more is already EMU (nobody authors a 100-inch slide,
 *   and callers do pass EMU through)
 * - a percent string resolves against the slide extent *in EMU*, so the single
 *   rounding step happens at the end
 * - a bare numeric string is treated as a number
 * - anything else is 0 rather than an error
 *
 * The rules are stated here once so no compile site has to re-derive them.
 */
export function resolveDimensionEmu(
  value: number | string,
  axis: 'X' | 'Y',
  extent: SlideExtentEmu
): number {
  let size: number | string = value;
  if (
    typeof size === 'string' &&
    size.trim() !== '' &&
    !Number.isNaN(Number(size))
  ) {
    size = Number(size);
  }
  if (typeof size === 'number') {
    return size < 100 ? Math.round(EMU_PER_INCH * size) : size;
  }
  if (size.includes('%')) {
    const pct = Number.parseFloat(size);
    if (Number.isNaN(pct)) return 0;
    const axisEmu = axis === 'Y' ? extent.heightEmu : extent.widthEmu;
    return Math.round((pct / 100) * axisEmu);
  }
  return 0;
}

/**
 * Width used when an element does not state one.
 *
 * 75% of the slide width — the width the pipeline has always produced for an
 * element with no `w`. Materialising it here is what lets the IR promise an
 * explicit transform without changing any output.
 */
export function defaultWidthEmu(extent: SlideExtentEmu): number {
  return Math.round(0.75 * extent.widthEmu);
}

/** Resolve an authored dimension to inches (for intermediate layout maths). */
export function resolveDimensionInches(
  value: number | string,
  axis: 'X' | 'Y',
  extent: SlideExtentEmu
): number {
  return emuToInches(resolveDimensionEmu(value, axis, extent));
}

/**
 * Build an IR colour from an already-resolved bare hex string.
 *
 * `resolveColor` (utils/color.ts) is what turns theme tokens into hex; this
 * only normalises casing and attaches transparency, so an unresolved token can
 * never reach the IR by accident.
 */
export function irColor(bareHex: string, transparency?: number): PptxIrColor {
  const hex = bareHex.startsWith('#') ? bareHex.slice(1) : bareHex;
  return transparency === undefined
    ? { hex: hex.toUpperCase() }
    : { hex: hex.toUpperCase(), transparency };
}

/** Normalise degrees into [0, 360). */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Lowercase hex SHA-256, the identity used for inline resources. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Deterministic element id from its position in the tree.
 *
 * Ids are derived, never allocated from a counter, so two concurrent
 * generations of the same document produce the same ids and a single
 * generation's ids do not depend on evaluation order.
 */
export function elementId(
  slideIndex: number,
  indexPath: readonly number[]
): string {
  return `s${slideIndex + 1}.${indexPath.map((i) => `e${i}`).join('.')}`;
}

/** Deterministic id for an element belonging to a master rather than a slide. */
export function masterElementId(
  masterName: string,
  indexPath: readonly number[]
): string {
  return `m:${masterName}.${indexPath.map((i) => `e${i}`).join('.')}`;
}

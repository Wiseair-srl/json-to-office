import pako from 'pako';
import { describe, expect, it } from 'vitest';
import type { PptxIrRadialGradient } from '../../../ir/types';
import {
  encodePng,
  paintRadialGradient,
  radialRasterSize,
  rasterizeRadialGradient,
} from '../radialRaster';

const EMU_PER_INCH = 914400;
const SLIDE_W = 10 * EMU_PER_INCH;
const SLIDE_H = 5.625 * EMU_PER_INCH;

const gradient = (
  focus: PptxIrRadialGradient['focus'],
  last: { hex: string; transparency?: number } = { hex: '0000FF' }
): PptxIrRadialGradient => ({
  type: 'radial',
  focus,
  stops: [
    { position: 0, color: { hex: 'FF0000' } },
    { position: 100, color: last },
  ],
});

function pixel(
  painted: { pixels: Uint8Array; channels: number },
  width: number,
  x: number,
  y: number
): number[] {
  const at = (y * width + x) * painted.channels;
  return [...painted.pixels.subarray(at, at + painted.channels)];
}

/** Pixel centres sit half a pixel off the focus, so allow a few levels. */
function expectNear(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(3);
  });
}

describe('radial gradient raster', () => {
  it('sizes a 16:9 slide to a 1600px long edge and a small shape smaller', () => {
    expect(radialRasterSize(SLIDE_W, SLIDE_H)).toEqual({
      width: 1600,
      height: 900,
    });
    expect(radialRasterSize(2 * EMU_PER_INCH, EMU_PER_INCH)).toEqual({
      width: 320,
      height: 160,
    });
  });

  it('draws a circle about the focus reaching the last stop at half the diagonal', () => {
    // 160 x 90: half the diagonal is ~91.8px.
    const topLeft = paintRadialGradient(gradient('topLeft'), 160, 90);
    expect(topLeft.channels).toBe(3);
    expectNear(pixel(topLeft, 160, 0, 0), [255, 0, 0]);
    // The centre is exactly half the diagonal away: the last stop.
    expectNear(pixel(topLeft, 160, 80, 45), [0, 0, 255]);
    // A circle, not an ellipse: the top-edge midpoint (80px out) is further
    // along than the left-edge midpoint (45px out), unlike a shape-relative
    // path where both sit halfway.
    const top = pixel(topLeft, 160, 80, 0)[2];
    const left = pixel(topLeft, 160, 0, 45)[2];
    expect(top).toBeGreaterThan(200);
    expect(left).toBeLessThan(140);

    const center = paintRadialGradient(gradient('center'), 160, 90);
    expectNear(pixel(center, 160, 80, 45), [255, 0, 0]);
    expectNear(pixel(center, 160, 0, 0), [0, 0, 255]);
    expectNear(pixel(center, 160, 159, 89), [0, 0, 255]);
  });

  it('keeps alpha only when a stop is transparent', () => {
    const painted = paintRadialGradient(
      gradient('bottomRight', { hex: '0000FF', transparency: 50 }),
      160,
      90
    );
    expect(painted.channels).toBe(4);
    expectNear(pixel(painted, 160, 159, 89), [255, 0, 0, 255]);
    expectNear(pixel(painted, 160, 0, 0), [0, 0, 255, 128]);
  });

  it('encodes a decodable PNG with identical bytes on every call', () => {
    const png = rasterizeRadialGradient(gradient('topRight'), SLIDE_W, SLIDE_H);
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(1600);
    expect(view.getUint32(20)).toBe(900);
    expect(png[25]).toBe(2); // colour type RGB

    const idatLength = view.getUint32(33);
    const raw = pako.inflate(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe(900 * (1600 * 3 + 1));

    // A fresh object with the same content hits the cache: same array.
    expect(
      rasterizeRadialGradient(gradient('topRight'), SLIDE_W, SLIDE_H)
    ).toBe(png);
    // And painting and encoding afresh gives the same bytes.
    const painted = paintRadialGradient(gradient('topRight'), 1600, 900);
    const fresh = encodePng(painted.pixels, 1600, 900, painted.channels);
    expect(fresh).not.toBe(png);
    expect(Buffer.from(fresh).equals(Buffer.from(png))).toBe(true);
  });
});

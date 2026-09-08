import { describe, expect, it } from 'vitest';
import { inkedRows, pageInkFromPgm, parsePgm } from './pdf-page-ink';

/** A P5 image `width` wide whose rows are painted per `rows` (0 = white, other = that gray). */
function pgm(width: number, rows: number[]): Buffer {
  const header = Buffer.from(`P5\n${width} ${rows.length}\n255\n`, 'latin1');
  const pixels = Buffer.alloc(width * rows.length, 255);
  rows.forEach((value, row) => {
    if (value > 0) pixels[row * width + Math.floor(width / 2)] = value;
  });
  return Buffer.concat([header, pixels]);
}

describe('parsePgm', () => {
  it('reads the header and points at the pixels', () => {
    const image = parsePgm(pgm(4, [0, 30, 0]));
    expect(image).toMatchObject({ width: 4, height: 3, maxValue: 255 });
    expect(image.pixels.length).toBe(12);
    expect(image.pixels[4 + 2]).toBe(30);
  });

  it('accepts a comment line and refuses anything that is not P5', () => {
    const commented = Buffer.concat([
      Buffer.from('P5\n# made by a test\n2 1\n255\n', 'latin1'),
      Buffer.from([0, 255]),
    ]);
    expect(parsePgm(commented).width).toBe(2);
    expect(() => parsePgm(Buffer.from('P6\n2 1\n255\n\0\0\0\0\0\0'))).toThrow(
      /P5/
    );
  });

  it('refuses a truncated image rather than reading past its end', () => {
    expect(() => parsePgm(Buffer.from('P5\n4 4\n255\n\0\0', 'latin1'))).toThrow(
      /shorter/
    );
  });
});

describe('inkedRows', () => {
  it('lists rows with a pixel at or below the threshold, in order', () => {
    // 210 is anti-aliasing haze, 200 is the threshold itself, 30 is ink.
    const image = parsePgm(pgm(6, [0, 210, 200, 0, 30, 0]));
    expect(inkedRows(image)).toEqual([2, 4]);
    expect(inkedRows(image, 100)).toEqual([4]);
  });

  it('packages the profile with the row count the page was sampled into', () => {
    expect(pageInkFromPgm(pgm(3, [0, 0, 10, 10]))).toEqual({
      rows: 4,
      inked: [2, 3],
    });
  });
});

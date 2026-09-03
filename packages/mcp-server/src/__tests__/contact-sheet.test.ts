/**
 * The contact-sheet composer, over PNGs it produced itself.
 *
 * Round-tripping through `encodePng` is the point rather than a shortcut: the
 * encoder writes Paeth-filtered rows and the decoder has to undo them, so a
 * decode of an encode exercises both halves against real filtered data. The
 * one thing it cannot prove is that pdftoppm's output decodes, which the
 * preview render tests cover with real pages.
 */

import { describe, expect, it } from 'vitest';
import {
  ContactSheetError,
  buildContactSheet,
  decodePng,
  downscale,
  encodePng,
  numberWidth,
} from '../preview/contact-sheet.js';

function solid(
  width: number,
  height: number,
  rgb: [number, number, number]
): Buffer {
  const data = Buffer.alloc(width * height * 3);
  for (let index = 0; index < data.length; index += 3) {
    data[index] = rgb[0];
    data[index + 1] = rgb[1];
    data[index + 2] = rgb[2];
  }
  return encodePng({ width, height, data });
}

/** A page-shaped image with a distinctive block, so a blit can be located. */
function page(width: number, height: number, mark: number): Buffer {
  const data = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < Math.floor(height / 2); y += 1) {
    for (let x = 0; x < Math.floor(width / 2); x += 1) {
      const index = (y * width + x) * 3;
      data[index] = mark;
      data[index + 1] = mark;
      data[index + 2] = mark;
    }
  }
  return encodePng({ width, height, data });
}

function pixel(
  image: { width: number; data: Buffer },
  x: number,
  y: number
): [number, number, number] {
  const index = (y * image.width + x) * 3;
  return [image.data[index], image.data[index + 1], image.data[index + 2]];
}

describe('png round trip', () => {
  it('decodes what it encoded, pixel for pixel', () => {
    const source = page(37, 23, 40);
    const decoded = decodePng(source);
    expect(decoded.width).toBe(37);
    expect(decoded.height).toBe(23);
    expect(pixel(decoded, 0, 0)).toEqual([40, 40, 40]);
    expect(pixel(decoded, 36, 22)).toEqual([255, 255, 255]);
  });

  it('refuses a PNG it cannot read, by name', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(
      ContactSheetError
    );
  });
});

describe('downscale', () => {
  it('averages rather than samples', () => {
    // A 2x1 image of black and white halves must become one mid grey, which
    // point sampling could never produce.
    const data = Buffer.from([0, 0, 0, 255, 255, 255]);
    const result = downscale({ width: 2, height: 1, data }, 1, 1);
    expect(pixel(result, 0, 0)).toEqual([128, 128, 128]);
  });

  it('keeps a solid colour solid at any size', () => {
    const decoded = decodePng(solid(64, 64, [10, 20, 30]));
    const small = downscale(decoded, 7, 7);
    expect(pixel(small, 3, 3)).toEqual([10, 20, 30]);
  });
});

describe('buildContactSheet', () => {
  const pages = (count: number, width = 400, height = 300) =>
    Array.from({ length: count }, (_, index) => ({
      page: index + 1,
      png: page(width, height, 60),
    }));

  it('tiles every page into one image', () => {
    const sheet = buildContactSheet(pages(20));
    expect(sheet.pageCount).toBe(20);
    expect(sheet.columns * sheet.rows).toBeGreaterThanOrEqual(20);
    // Roughly landscape: a sheet taller than it is wide has to be scrolled.
    expect(sheet.width).toBeGreaterThan(sheet.height);
    expect(decodePng(sheet.png).width).toBe(sheet.width);
  });

  it('labels each cell with its page number', () => {
    const sheet = buildContactSheet(pages(3), { columns: 3 });
    const image = decodePng(sheet.png);
    // The label strip sits below the thumbnails; ink there is the only thing
    // darker than the sheet ground in that band.
    const labelBand = 12 + Math.round(360 / (400 / 300)) + 5;
    let ink = 0;
    for (let y = labelBand; y < labelBand + 14; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (pixel(image, x, y)[0] < 150) ink += 1;
      }
    }
    expect(ink).toBeGreaterThan(20);
  });

  it('honours an explicit column count', () => {
    const sheet = buildContactSheet(pages(6), { columns: 2 });
    expect(sheet.columns).toBe(2);
    expect(sheet.rows).toBe(3);
  });

  it('letterboxes a page whose shape differs from the first', () => {
    const sheet = buildContactSheet(
      [
        { page: 1, png: page(400, 300, 60) },
        { page: 2, png: page(300, 400, 60) },
      ],
      { columns: 2 }
    );
    // Both cells keep the same footprint, so the odd page reads as odd.
    expect(sheet.columns).toBe(2);
    expect(sheet.rows).toBe(1);
  });

  it('grows with the page count, so a long document outgrows the budget', () => {
    const small = buildContactSheet(pages(20));
    const large = buildContactSheet(pages(40));
    expect(large.width * large.height).toBeGreaterThan(
      small.width * small.height
    );
  });

  it('refuses an empty selection', () => {
    expect(() => buildContactSheet([])).toThrow(ContactSheetError);
  });
});

describe('numberWidth', () => {
  it('measures what drawNumber will paint', () => {
    expect(numberWidth(7, 2)).toBe(10);
    expect(numberWidth(12, 2)).toBe(22);
  });
});

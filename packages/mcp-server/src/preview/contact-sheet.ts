/**
 * Many pages, one image.
 *
 * Cross-page consistency — rhythm, alignment, whether every section opener
 * looks like the others — is a question about the set, and asking it one page
 * at a time costs twenty images and answers nothing. A contact sheet turns it
 * into a single look.
 *
 * Composed here in plain Node rather than by shelling out to an image tool.
 * The pipeline already asks the host for LibreOffice and poppler; a third
 * binary that only exists to paste PNGs together would be a new way for the
 * preview to be unavailable. What is needed is small and exact: decode the
 * 8-bit PNGs pdftoppm writes, box-average them down, paste them into a grid,
 * label each cell, and encode one PNG back out.
 */

import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Channels per pixel, by PNG colour type. Palette (3) is unsupported. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export interface RgbImage {
  width: number;
  height: number;
  /** Three bytes per pixel, row-major, no padding. */
  data: Buffer;
}

export class ContactSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactSheetError';
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * An 8-bit non-interlaced PNG as RGB.
 *
 * Alpha is composited onto white rather than kept: the sheet is a flat image,
 * and a page that arrives with transparency is a page whose white ground was
 * left implicit.
 */
export function decodePng(png: Buffer): RgbImage {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new ContactSheetError('Not a PNG.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length > png.length) break;
    if (type === 'IHDR') {
      width = png.readUInt32BE(start);
      height = png.readUInt32BE(start + 4);
      const bitDepth = png[start + 8];
      const colorType = png[start + 9];
      const interlace = png[start + 12];
      if (bitDepth !== 8) {
        throw new ContactSheetError(`Unsupported PNG bit depth ${bitDepth}.`);
      }
      if (interlace !== 0) {
        throw new ContactSheetError('Interlaced PNGs are not supported.');
      }
      channels = CHANNELS[colorType] ?? 0;
      if (channels === 0) {
        throw new ContactSheetError(
          `Unsupported PNG colour type ${colorType}.`
        );
      }
    } else if (type === 'IDAT') {
      idat.push(png.subarray(start, start + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }
  if (width === 0 || height === 0 || channels === 0) {
    throw new ContactSheetError('PNG header missing or unreadable.');
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.allocUnsafe(width * height * 3);
  const previous = Buffer.alloc(stride);
  const current = Buffer.allocUnsafe(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    if (rowStart + stride >= raw.length + 1 && rowStart >= raw.length) {
      throw new ContactSheetError('PNG data ended early.');
    }
    const filter = raw[rowStart];
    raw.copy(current, 0, rowStart + 1, rowStart + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = current[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) {
        throw new ContactSheetError(`Unknown PNG row filter ${filter}.`);
      }
      current[x] = value & 0xff;
    }
    // Alpha over white, so a transparent page reads as paper.
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 3;
      let r: number;
      let g: number;
      let b: number;
      let alpha = 255;
      if (channels === 1) {
        r = g = b = current[source];
      } else if (channels === 2) {
        r = g = b = current[source];
        alpha = current[source + 1];
      } else {
        r = current[source];
        g = current[source + 1];
        b = current[source + 2];
        if (channels === 4) alpha = current[source + 3];
      }
      if (alpha === 255) {
        data[target] = r;
        data[target + 1] = g;
        data[target + 2] = b;
      } else {
        const inverse = 255 - alpha;
        data[target] = (r * alpha + 255 * inverse) / 255;
        data[target + 1] = (g * alpha + 255 * inverse) / 255;
        data[target + 2] = (b * alpha + 255 * inverse) / 255;
      }
    }
    current.copy(previous);
  }
  return { width, height, data };
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, crc]);
}

/** RGB back to a PNG. Every row is Paeth-filtered, which suits flat art. */
export function encodePng(image: RgbImage): Buffer {
  const { width, height, data } = image;
  const stride = width * 3;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const target = y * (stride + 1);
    raw[target] = 4;
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const left = x >= 3 ? data[index - 3] : 0;
      const up = y > 0 ? data[index - stride] : 0;
      const upLeft = y > 0 && x >= 3 ? data[index - stride - 3] : 0;
      raw[target + 1 + x] = (data[index] - paeth(left, up, upLeft)) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Box-average down to `width` × `height`.
 *
 * Averaging rather than sampling: a page of 9pt text sampled at one pixel in
 * five turns into speckle, and the whole point of the sheet is that the text
 * still reads as text.
 */
export function downscale(
  source: RgbImage,
  width: number,
  height: number
): RgbImage {
  const data = Buffer.allocUnsafe(width * height * 3);
  const xScale = source.width / width;
  const yScale = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * yScale);
    const y1 = Math.max(
      y0 + 1,
      Math.min(source.height, Math.ceil((y + 1) * yScale))
    );
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * xScale);
      const x1 = Math.max(
        x0 + 1,
        Math.min(source.width, Math.ceil((x + 1) * xScale))
      );
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        let index = (sy * source.width + x0) * 3;
        for (let sx = x0; sx < x1; sx += 1) {
          r += source.data[index];
          g += source.data[index + 1];
          b += source.data[index + 2];
          index += 3;
          count += 1;
        }
      }
      const target = (y * width + x) * 3;
      data[target] = Math.round(r / count);
      data[target + 1] = Math.round(g / count);
      data[target + 2] = Math.round(b / count);
    }
  }
  return { width, height, data };
}

/**
 * A 5x7 bitmap per digit, as row bitmasks read left to right from bit 4.
 *
 * Page numbers are all a label has to say, so ten glyphs are the whole font.
 * Shipping a real typeface to write "12" under a thumbnail would mean a font
 * file, a shaper and a licence.
 */
const DIGITS: readonly (readonly number[])[] = [
  [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
];

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

function drawNumber(
  target: RgbImage,
  value: number,
  originX: number,
  originY: number,
  scale: number,
  ink: readonly [number, number, number]
): void {
  const text = String(value);
  let cursor = originX;
  for (const character of text) {
    const glyph = DIGITS[Number(character)];
    if (glyph) {
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        for (let column = 0; column < GLYPH_WIDTH; column += 1) {
          if ((glyph[row] & (1 << (GLYPH_WIDTH - 1 - column))) === 0) continue;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const x = cursor + column * scale + dx;
              const y = originY + row * scale + dy;
              if (x < 0 || y < 0 || x >= target.width || y >= target.height) {
                continue;
              }
              const index = (y * target.width + x) * 3;
              target.data[index] = ink[0];
              target.data[index + 1] = ink[1];
              target.data[index + 2] = ink[2];
            }
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + 1) * scale;
  }
}

/** Width of a rendered number, so a caller can centre it. */
export function numberWidth(value: number, scale: number): number {
  return String(value).length * (GLYPH_WIDTH + 1) * scale - scale;
}

export interface ContactSheetPage {
  page: number;
  png: Buffer;
}

export interface ContactSheetOptions {
  /** Target width of one thumbnail, in pixels. */
  thumbnailWidth?: number;
  /** Force a column count instead of deriving one. */
  columns?: number;
}

export interface ContactSheet {
  png: Buffer;
  width: number;
  height: number;
  columns: number;
  rows: number;
  pageCount: number;
}

/**
 * A thumbnail wide enough that 10pt body text still reads as text at a
 * glance. Below roughly this, the sheet answers "is there a page here" and
 * stops answering "does this page look right".
 */
const DEFAULT_THUMBNAIL_WIDTH = 360;
const GUTTER = 12;
const LABEL_SCALE = 2;
const LABEL_HEIGHT = GLYPH_HEIGHT * LABEL_SCALE;
const LABEL_GAP = 5;
const SHEET_BACKGROUND: readonly [number, number, number] = [244, 244, 246];
const CELL_BORDER: readonly [number, number, number] = [206, 206, 212];
const LABEL_INK: readonly [number, number, number] = [90, 90, 98];

/**
 * Roughly landscape, because that is the shape of a screen.
 *
 * Scored on the *cell* aspect rather than the page's: a cell carries a label
 * strip under the thumbnail, and ignoring it makes a 20-page sheet come out
 * marginally taller than it is wide.
 */
function chooseColumns(count: number, cellAspect: number): number {
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const aspect = (columns * cellAspect) / rows;
    // 4:3 reads as a sheet; much wider or taller has to be scrolled.
    const score =
      Math.abs(Math.log(aspect / (4 / 3))) + (columns * rows - count) * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = columns;
    }
  }
  return best;
}

function fill(
  image: RgbImage,
  colour: readonly [number, number, number]
): void {
  for (let index = 0; index < image.data.length; index += 3) {
    image.data[index] = colour[0];
    image.data[index + 1] = colour[1];
    image.data[index + 2] = colour[2];
  }
}

function blit(target: RgbImage, source: RgbImage, x0: number, y0: number) {
  for (let y = 0; y < source.height; y += 1) {
    const targetRow = (y0 + y) * target.width + x0;
    source.data.copy(
      target.data,
      targetRow * 3,
      y * source.width * 3,
      (y + 1) * source.width * 3
    );
  }
}

function strokeRect(
  target: RgbImage,
  x0: number,
  y0: number,
  width: number,
  height: number,
  colour: readonly [number, number, number]
): void {
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
    const index = (y * target.width + x) * 3;
    target.data[index] = colour[0];
    target.data[index + 1] = colour[1];
    target.data[index + 2] = colour[2];
  };
  for (let x = x0 - 1; x <= x0 + width; x += 1) {
    paint(x, y0 - 1);
    paint(x, y0 + height);
  }
  for (let y = y0 - 1; y <= y0 + height; y += 1) {
    paint(x0 - 1, y);
    paint(x0 + width, y);
  }
}

/**
 * Every page in one labelled grid.
 *
 * Cells are uniform: the first page's aspect sets the cell, and a page of a
 * different shape is letterboxed inside it rather than breaking the grid. A
 * deck with one portrait slide among landscape ones should look wrong in the
 * sheet, because it will look wrong in the deck.
 */
export function buildContactSheet(
  pages: readonly ContactSheetPage[],
  options: ContactSheetOptions = {}
): ContactSheet {
  if (pages.length === 0) {
    throw new ContactSheetError('A contact sheet needs at least one page.');
  }
  const decoded = pages.map((entry) => ({
    page: entry.page,
    image: decodePng(entry.png),
  }));

  const thumbnailWidth = Math.max(
    64,
    Math.round(options.thumbnailWidth ?? DEFAULT_THUMBNAIL_WIDTH)
  );
  const first = decoded[0].image;
  const pageAspect = first.width / first.height;
  const thumbnailHeight = Math.max(1, Math.round(thumbnailWidth / pageAspect));
  const cellHeight = thumbnailHeight + LABEL_GAP + LABEL_HEIGHT;
  const columns = Math.max(
    1,
    Math.min(
      decoded.length,
      options.columns ??
        chooseColumns(decoded.length, thumbnailWidth / cellHeight)
    )
  );
  const rows = Math.ceil(decoded.length / columns);

  const width = GUTTER + columns * (thumbnailWidth + GUTTER);
  const height = GUTTER + rows * (cellHeight + GUTTER);
  const sheet: RgbImage = {
    width,
    height,
    data: Buffer.allocUnsafe(width * height * 3),
  };
  fill(sheet, SHEET_BACKGROUND);

  decoded.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = GUTTER + column * (thumbnailWidth + GUTTER);
    const cellY = GUTTER + row * (cellHeight + GUTTER);

    // Letterbox: fit inside the cell, keep the page's own proportions.
    const aspect = entry.image.width / entry.image.height;
    let drawWidth = thumbnailWidth;
    let drawHeight = Math.max(1, Math.round(thumbnailWidth / aspect));
    if (drawHeight > thumbnailHeight) {
      drawHeight = thumbnailHeight;
      drawWidth = Math.max(1, Math.round(thumbnailHeight * aspect));
    }
    const offsetX = cellX + Math.floor((thumbnailWidth - drawWidth) / 2);
    const offsetY = cellY + Math.floor((thumbnailHeight - drawHeight) / 2);
    blit(
      sheet,
      downscale(entry.image, drawWidth, drawHeight),
      offsetX,
      offsetY
    );
    strokeRect(sheet, offsetX, offsetY, drawWidth, drawHeight, CELL_BORDER);

    drawNumber(
      sheet,
      entry.page,
      cellX +
        Math.floor((thumbnailWidth - numberWidth(entry.page, LABEL_SCALE)) / 2),
      cellY + thumbnailHeight + LABEL_GAP,
      LABEL_SCALE,
      LABEL_INK
    );
  });

  return {
    png: encodePng(sheet),
    width,
    height,
    columns,
    rows,
    pageCount: decoded.length,
  };
}

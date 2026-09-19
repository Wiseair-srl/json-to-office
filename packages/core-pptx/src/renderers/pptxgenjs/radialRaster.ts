/**
 * Radial gradients as pixels.
 *
 * DrawingML has one radial gradient, `<a:path path="circle">` with a
 * `fillToRect`, and the two applications that matter disagree on what it
 * means. LibreOffice draws a true circle around the focus whose last stop sits
 * at half the box's diagonal; PowerPoint lays the path out in shape-relative
 * space, so on a 16:9 slide it becomes an ellipse and a corner focus spreads
 * across the whole slide. The product's model — the preview, the gallery and
 * the `pptx/text-contrast` sampler in `quality/facts.ts` — is LibreOffice's.
 *
 * So this backend never hands either application a radial gradient: it paints
 * that model into a PNG and ships the picture, which both draw identically.
 * Linear gradients agree across applications and stay vector.
 *
 * The painter is plain arithmetic and the encoder is pako, not resvg or
 * `node:zlib`: a native rasterizer or a SIMD deflate can differ by a bit
 * between CPUs, and these bytes land in a package the corpus goldens hash.
 */

import pako from 'pako';
import type { PptxIrRadialGradient } from '../../ir/types';

/** Bitmap long edge for a full slide; a smooth ramp needs no more. */
const MAX_EDGE_PX = 1600;
/** Pixels per inch below the cap, so a small shape gets a small bitmap. */
const PX_PER_INCH = 160;
const MIN_EDGE_PX = 32;
const EMU_PER_INCH = 914400;
/** Distinct gradients kept across renders; a deck rarely has more. */
const CACHE_LIMIT = 32;

/** The focus point, as fractions of the box. */
const FOCUS_POINTS: Record<
  PptxIrRadialGradient['focus'],
  readonly [number, number]
> = {
  center: [0.5, 0.5],
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomLeft: [0, 1],
  bottomRight: [1, 1],
};

/** Renders a radial gradient over a box of the given size to PNG bytes. */
export type RadialRasterizer = (
  gradient: PptxIrRadialGradient,
  widthEmu: number,
  heightEmu: number
) => Uint8Array;

/** Bitmap size for a box: aspect kept, long edge capped. */
export function radialRasterSize(
  widthEmu: number,
  heightEmu: number
): { width: number; height: number } {
  const w = Math.max(widthEmu, 1);
  const h = Math.max(heightEmu, 1);
  const longInches = Math.max(w, h) / EMU_PER_INCH;
  const longPx = Math.min(
    MAX_EDGE_PX,
    Math.max(MIN_EDGE_PX, Math.round(longInches * PX_PER_INCH))
  );
  const scale = longPx / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

interface Stop {
  /** 0..1 along the radius. */
  at: number;
  rgba: [number, number, number, number];
}

function parseStops(gradient: PptxIrRadialGradient): Stop[] {
  return gradient.stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.position - b.stop.position || a.index - b.index)
    .map(({ stop }) => {
      const hex = parseInt(stop.color.hex, 16);
      const alpha =
        stop.color.transparency !== undefined
          ? 255 *
            (1 - Math.min(100, Math.max(0, stop.color.transparency)) / 100)
          : 255;
      return {
        at: Math.min(100, Math.max(0, stop.position)) / 100,
        rgba: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, alpha],
      };
    });
}

/**
 * Paint the gradient: a circle centred on the focus whose last stop sits at
 * half the box diagonal, padded beyond it with the last colour — the geometry
 * `quality/facts.ts` samples. Each pixel is sampled at its centre and the
 * stops interpolate linearly, alpha included.
 */
export function paintRadialGradient(
  gradient: PptxIrRadialGradient,
  width: number,
  height: number
): { pixels: Uint8Array; channels: 3 | 4 } {
  const stops = parseStops(gradient);
  const channels = stops.every((stop) => stop.rgba[3] === 255) ? 3 : 4;
  const [fx, fy] = FOCUS_POINTS[gradient.focus] ?? FOCUS_POINTS.center;
  const cx = fx * width;
  const cy = fy * height;
  const radius = Math.sqrt(width * width + height * height) / 2;
  const pixels = new Uint8Array(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - cx;
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius);
      let next = 0;
      while (next < stops.length && stops[next].at < t) next += 1;
      const offset = (y * width + x) * channels;
      if (next === 0 || next === stops.length) {
        const only = stops[next === 0 ? 0 : stops.length - 1].rgba;
        for (let c = 0; c < channels; c += 1) pixels[offset + c] = only[c];
        continue;
      }
      const from = stops[next - 1];
      const to = stops[next];
      const u = (t - from.at) / (to.at - from.at);
      for (let c = 0; c < channels; c += 1) {
        pixels[offset + c] = Math.round(
          from.rgba[c] + (to.rgba[c] - from.rgba[c]) * u
        );
      }
    }
  }
  return { pixels, channels };
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

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

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Rows with the Paeth filter, which leaves a smooth two-dimensional ramp
 * mostly zeros — about a third the size of an unfiltered encode.
 */
function paethFiltered(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const up = row - stride;
    const at = y * (stride + 1);
    out[at] = 4;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? pixels[row + i - channels] : 0;
      const b = y > 0 ? pixels[up + i] : 0;
      const c = y > 0 && i >= channels ? pixels[up + i - channels] : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[at + 1 + i] = (pixels[row + i] - predictor) & 255;
    }
  }
  return out;
}

/** An 8-bit RGB or RGBA PNG. */
export function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      pako.deflate(paethFiltered(pixels, width, height, channels), {
        level: 6,
      })
    ),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/* ------------------------------------------------------------------ *
 * Rasterizer
 * ------------------------------------------------------------------ */

const cache = new Map<string, Uint8Array>();

/**
 * PNG bytes for a radial gradient over a box. Identical requests return the
 * identical array — packaging deduplicates media by identity — and, the
 * painter and encoder being pure JavaScript, identical bytes on every
 * platform.
 */
export const rasterizeRadialGradient: RadialRasterizer = (
  gradient,
  widthEmu,
  heightEmu
) => {
  const { width, height } = radialRasterSize(widthEmu, heightEmu);
  const key = JSON.stringify([gradient.focus, gradient.stops, width, height]);
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency so the cache evicts the least recently used entry.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const { pixels, channels } = paintRadialGradient(gradient, width, height);
  const png = encodePng(pixels, width, height, channels);
  cache.set(key, png);
  if (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string);
  }
  return png;
};

/** A PNG as the data URI PptxGenJS takes for `data`. */
export function pngDataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

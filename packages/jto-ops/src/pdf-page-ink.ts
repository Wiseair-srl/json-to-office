/**
 * Where the ink is on a rendered page, row by row.
 *
 * Text geometry says where the words are; it says nothing about a chart, a
 * table rule or a full-bleed image, and a page that holds only those would
 * read as blank. A low-resolution grayscale raster of the same PDF answers
 * the other question — how far down the page anything at all was painted —
 * and that is what the page-fill rule needs. `pdftoppm -gray` writes one
 * PGM (P5) file per page: an ASCII header, then one byte per pixel, so
 * reading it needs no image library.
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/** One page's ink profile, as cached beside its text geometry. */
export interface PdfPageInk {
  /** Raster rows the page was sampled into; row `r` spans `heightPt * r / rows` to `heightPt * (r + 1) / rows`. */
  rows: number;
  /** Row indices, ascending, where at least one pixel is darker than the ink threshold. */
  inked: number[];
}

export interface Pgm {
  width: number;
  height: number;
  maxValue: number;
  /** Row-major, one value per pixel, `width * height` long. */
  pixels: Uint8Array;
}

/** Pixels at or below this value count as ink: dark enough to be text, a rule or a chart bar, not anti-aliasing haze. */
export const INK_THRESHOLD = 200;

/** Dots per inch the fill measurement rasterizes at: an A4 page is ~280 rows, enough to place content to within 3pt. */
export const INK_DPI = 24;

/** Parse a binary PGM (`P5`) as pdftoppm writes it: header tokens, one whitespace byte, then the pixels. */
export function parsePgm(buffer: Buffer): Pgm {
  const header = /^P5\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s/.exec(
    buffer.subarray(0, 64).toString('latin1')
  );
  if (!header) throw new Error('Not a binary PGM (P5) image.');
  const width = Number(header[1]);
  const height = Number(header[2]);
  const maxValue = Number(header[3]);
  if (maxValue > 255) throw new Error('16-bit PGM is not supported.');
  const start = header[0].length;
  // Check the Buffer's own length, not the view: a small Buffer lives in
  // Node's shared pool, where a longer view would silently read a neighbour.
  if (buffer.length - start < width * height) {
    throw new Error('PGM shorter than its declared size.');
  }
  const pixels = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset + start,
    width * height
  );
  return { width, height, maxValue, pixels };
}

/** Rows carrying at least one pixel at or below `threshold`, ascending. */
export function inkedRows(pgm: Pgm, threshold = INK_THRESHOLD): number[] {
  const rows: number[] = [];
  for (let row = 0; row < pgm.height; row += 1) {
    const start = row * pgm.width;
    const end = start + pgm.width;
    for (let i = start; i < end; i += 1) {
      if (pgm.pixels[i] <= threshold) {
        rows.push(row);
        break;
      }
    }
  }
  return rows;
}

export function pageInkFromPgm(buffer: Buffer, threshold?: number): PdfPageInk {
  const pgm = parsePgm(buffer);
  return { rows: pgm.height, inked: inkedRows(pgm, threshold) };
}

function pdftoppmCandidates(): string[] {
  const configured = process.env.PDFTOPPM_PATH?.trim();
  return [...new Set([...(configured ? [configured] : []), 'pdftoppm'])];
}

async function run(binary: string, args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

// Same memoization shape as the pdftotext resolution beside this file:
// success is cached per process, failure retries on the next call.
let pdftoppmPromise: Promise<string> | undefined;
async function resolvePdftoppm(): Promise<string> {
  if (!pdftoppmPromise) {
    pdftoppmPromise = (async () => {
      for (const candidate of pdftoppmCandidates()) {
        try {
          await run(candidate, ['-v'], 10_000);
          return candidate;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // pdftoppm -v prints to stderr and exits 0 on modern poppler; a
          // non-ENOENT failure still means the binary exists.
          if (code !== 'ENOENT' && code !== 'EACCES') return candidate;
        }
      }
      throw new Error(
        'Page ink extraction needs pdftoppm (poppler), which was not found. ' +
          `Install poppler-utils or set PDFTOPPM_PATH (searched: ${pdftoppmCandidates().join(', ')}).`
      );
    })().catch((error) => {
      pdftoppmPromise = undefined;
      throw error;
    });
  }
  return pdftoppmPromise;
}

export interface ExtractPdfPageInkOptions {
  dpi?: number;
  threshold?: number;
  /** A resolved pdftoppm path, when the caller already found one. */
  binary?: string;
  timeoutMs?: number;
}

/**
 * Rasterize every page of a PDF in grayscale at a low resolution and read
 * back which rows carry ink. One pdftoppm spawn into a private temp dir,
 * removed before returning; the result is small enough to cache with the
 * text geometry.
 */
export async function extractPdfPageInk(
  pdfPath: string,
  options: ExtractPdfPageInkOptions = {}
): Promise<PdfPageInk[]> {
  const binary = options.binary ?? (await resolvePdftoppm());
  const dpi = options.dpi ?? INK_DPI;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-page-ink-'));
  try {
    const prefix = path.join(dir, 'page');
    await run(
      binary,
      ['-gray', '-r', String(dpi), pdfPath, prefix],
      options.timeoutMs ?? 60_000
    );
    const files = (await fs.readdir(dir))
      .filter((name) => /^page-\d+\.pgm$/.test(name))
      .sort(
        (a, b) =>
          Number(/\d+/.exec(a)?.[0] ?? 0) - Number(/\d+/.exec(b)?.[0] ?? 0)
      );
    const pages: PdfPageInk[] = [];
    for (const file of files) {
      pages.push(
        pageInkFromPgm(
          await fs.readFile(path.join(dir, file)),
          options.threshold
        )
      );
    }
    return pages;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

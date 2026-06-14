/**
 * PPTX rasterizer — the concrete service backing docx `visual` components.
 *
 * Pipeline: presentation JSON → (core-pptx) .pptx → (LibreOffice) PDF →
 * (poppler/pdftoppm) PNG. Returns a base64 data URI plus the natural pixel
 * dimensions. Results are content-addressed and cached on disk so repeated
 * builds of an unchanged visual skip the (multi-second) LibreOffice run.
 *
 * This is injected via `services.pptx.render`; the published engine packages
 * never depend on these binaries.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  PptxRasterizer,
  PptxRasterizeRequest,
  PptxRasterizeResult,
} from '@json-to-office/shared';

const SOFFICE_TIMEOUT_MS = 60000;
const PDFTOPPM_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 5000;
const MAX_BUFFER = 64 * 1024 * 1024;

function exec(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

async function binaryWorks(binary: string): Promise<boolean> {
  if (binary.includes(path.sep)) {
    try {
      await fs.access(binary);
    } catch {
      return false;
    }
  }
  try {
    await exec(binary, ['--version'], PROBE_TIMEOUT_MS);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A non-ENOENT failure still means the binary exists (e.g. bad flag).
    return code !== 'ENOENT' && code !== 'EACCES';
  }
}

function sofficeCandidates(): string[] {
  const candidates: string[] = [];
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  if (configured) candidates.push(configured);
  if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    candidates.push(
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    );
  }
  candidates.push('soffice', 'libreoffice');
  return [...new Set(candidates)];
}

function pdftoppmCandidates(): string[] {
  const candidates: string[] = [];
  const configured = process.env.PDFTOPPM_PATH?.trim();
  if (configured) candidates.push(configured);
  candidates.push('pdftoppm');
  return [...new Set(candidates)];
}

async function resolveBinary(
  candidates: string[],
  label: string,
  install: string
): Promise<string> {
  for (const candidate of candidates) {
    if (await binaryWorks(candidate)) return candidate;
  }
  throw new Error(
    `Visual rasterization needs ${label}, which was not found. ${install} ` +
      `(searched: ${candidates.join(', ')}).`
  );
}

// Memoize resolved binary paths per process — they don't change at runtime, so
// re-probing (spawning `--version` for every cache-miss rasterize) is wasted
// work. A failed resolution is NOT cached, so a later call retries.
let sofficePromise: Promise<string> | undefined;
let pdftoppmPromise: Promise<string> | undefined;
function resolveSoffice(): Promise<string> {
  if (!sofficePromise) {
    sofficePromise = resolveBinary(
      sofficeCandidates(),
      'LibreOffice (soffice)',
      'Install LibreOffice or set LIBREOFFICE_PATH.'
    ).catch((error) => {
      sofficePromise = undefined;
      throw error;
    });
  }
  return sofficePromise;
}
function resolvePdftoppm(): Promise<string> {
  if (!pdftoppmPromise) {
    pdftoppmPromise = resolveBinary(
      pdftoppmCandidates(),
      'pdftoppm (poppler)',
      'Install poppler-utils or set PDFTOPPM_PATH.'
    ).catch((error) => {
      pdftoppmPromise = undefined;
      throw error;
    });
  }
  return pdftoppmPromise;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Validate a PNG buffer and read its width/height from the IHDR chunk. Returns
 * null for anything that isn't a complete PNG (empty/truncated/corrupt) so the
 * caller can re-render or error rather than emit a 0×0 / broken image. pdftoppm
 * always outputs PNG, so a PNG-only check is sufficient here.
 */
function parsePngSize(png: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then IHDR: length(4) + "IHDR"(4) + width(4) + height(4)
  if (png.length < 24) return null;
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (png.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

let tmpCounter = 0;
/**
 * Write the cache file atomically (temp file + rename) so a concurrent reader
 * never observes a half-written PNG. Best-effort: failures are swallowed (the
 * cache is an optimization), but a partial temp file is cleaned up.
 */
async function writeCacheAtomic(
  cacheDir: string,
  cachePath: string,
  png: Buffer
): Promise<void> {
  const tmp = `${cachePath}.tmp-${process.pid}-${tmpCounter++}`;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(tmp, png);
    await fs.rename(tmp, cachePath);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

function cacheKey(request: PptxRasterizeRequest): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ p: request.presentation, dpi: request.dpi }))
    .digest('hex');
}

function toDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Build a LibreOffice-backed pptx rasterizer.
 *
 * @param options.cacheDir - directory for the content-addressed PNG cache
 *   (default: <tmp>/jto-visual-cache). Pass `null` to disable caching.
 */
export function createLibreOfficePptxRasterizer(options?: {
  cacheDir?: string | null;
}): PptxRasterizer {
  const cacheDir =
    options?.cacheDir === undefined
      ? path.join(os.tmpdir(), 'jto-visual-cache')
      : options.cacheDir;

  return async function rasterize(
    request: PptxRasterizeRequest
  ): Promise<PptxRasterizeResult> {
    const key = cacheKey(request);
    const cachePath = cacheDir ? path.join(cacheDir, `${key}.png`) : null;

    if (cachePath) {
      const cached = await fs.readFile(cachePath).catch(() => null);
      if (cached) {
        const size = parsePngSize(cached);
        if (size) return { base64DataUri: toDataUri(cached), ...size };
        // Corrupt/partial cache file (e.g. a killed prior render) — discard it
        // and re-render rather than embed a broken image.
        await fs.rm(cachePath, { force: true }).catch(() => {});
      }
    }

    // 1. JSON → .pptx (in-process, pure JS)
    const corePptx = await import('@json-to-office/core-pptx');
    const pptxBuffer = await corePptx.generateBufferFromJson(
      request.presentation as any
    );

    const [soffice, pdftoppm] = await Promise.all([
      resolveSoffice(),
      resolvePdftoppm(),
    ]);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-visual-'));
    try {
      const pptxPath = path.join(tempDir, 'visual.pptx');
      const pdfPath = path.join(tempDir, 'visual.pdf');
      const pngPrefix = path.join(tempDir, 'visual');
      await fs.writeFile(pptxPath, pptxBuffer);

      // 2. .pptx → PDF (single slide → single page)
      const userProfile = `file://${path.join(tempDir, 'profile').replace(/\\/g, '/')}`;
      await exec(
        soffice,
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--nodefault',
          `-env:UserInstallation=${userProfile}`,
          '--convert-to',
          'pdf:impress_pdf_Export',
          '--outdir',
          tempDir,
          pptxPath,
        ],
        SOFFICE_TIMEOUT_MS
      );

      // 3. PDF → PNG at the requested DPI (single page, no page suffix)
      await exec(
        pdftoppm,
        ['-r', String(request.dpi), '-png', '-singlefile', pdfPath, pngPrefix],
        PDFTOPPM_TIMEOUT_MS
      );

      const png = await fs.readFile(`${pngPrefix}.png`);
      const size = parsePngSize(png);
      if (!size) {
        throw new Error(
          'Rasterization produced an invalid PNG (empty or truncated output from pdftoppm).'
        );
      }

      if (cachePath) {
        await writeCacheAtomic(cacheDir!, cachePath, png);
      }

      return { base64DataUri: toDataUri(png), ...size };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

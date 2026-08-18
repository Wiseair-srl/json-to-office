/**
 * PPTX rasterizer — the concrete service backing docx `visual` components.
 *
 * Pipeline: presentation JSON → (core-pptx) .pptx → (LibreOffice) PDF →
 * (poppler/pdftoppm) PNG. Returns a base64 data URI plus the natural pixel
 * dimensions. Results are content-addressed and cached on disk so repeated
 * builds of an unchanged visual skip the (multi-second) LibreOffice run.
 *
 * Single and batch rasterization share one engine (#153). A batch keeps one
 * .pptx per slide and converts them all in a single `soffice` launch — the
 * launch is the dominant cost, and per-file conversion keeps slides fully
 * independent: each has its own PDF and PNG (no page↔slide index mapping),
 * its own dpi, and a cache key identical to the single-slide path, so both
 * paths share the same disk cache.
 *
 * Every engine run works against a wall-clock deadline (one batch-scaled
 * soffice window plus one pdftoppm window) so a wedged conversion fails the
 * remaining slides quickly instead of holding the caller — and its
 * concurrency slot — for minutes.
 *
 * This is injected via `services.pptx.render` / `services.pptx.renderBatch`;
 * the published engine packages never depend on these binaries.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_VISUAL_DPI,
  type PptxRasterizer,
  type PptxBatchRasterizer,
  type PptxRasterizeRequest,
  type PptxRasterizeResult,
  type PptxRasterizeBatchSlideResult,
  type PptxRasterizeFailureStage,
} from '@json-to-office/shared';

const SOFFICE_TIMEOUT_MS = 60000;
/** Extra soffice budget per additional slide in a batch launch. */
const SOFFICE_BATCH_EXTRA_PER_SLIDE_MS = 15000;
/** Hard ceiling for one batch soffice launch. */
const SOFFICE_BATCH_TIMEOUT_CAP_MS = 300000;
/**
 * Max isolated single-file launches after a batch launch left PDFs missing.
 * Covers the realistic case (one poisoned slide crashed the batch; its
 * successors are fine) without letting a broken environment turn one request
 * into dozens of sequential 60s timeouts.
 */
const MAX_ISOLATED_RETRIES = 3;
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

/**
 * Process-wide rasterizer cache counters (#156). The disk cache had zero
 * observability even though `visual` — the component family with the
 * heaviest cache benefit — lives here rather than in the component cache
 * (which bypasses `visual` by design).
 */
export interface RasterizerCacheStats {
  /** Slides served from the content-addressed PNG disk cache. */
  diskHits: number;
  /** Unique slides that missed the disk cache and needed the engine. */
  diskMisses: number;
  /** diskHits / (diskHits + diskMisses), 0 when no lookups. */
  hitRate: number;
  /** Requests resolved by batch-internal dedupe (duplicate slides). */
  dedupedRequests: number;
  /** Slides successfully rendered by the engine (LibreOffice + pdftoppm). */
  rendered: number;
  /** Slides that failed at any engine stage. */
  failed: number;
  /** PNG files currently in the disk cache directories. */
  entries: number;
  /** Total bytes of those PNG files. */
  bytes: number;
}

const rasterizerCounters = {
  diskHits: 0,
  diskMisses: 0,
  dedupedRequests: 0,
  rendered: 0,
  failed: 0,
};

/** Cache directories any engine run has used (for the disk scan). */
const knownCacheDirs = new Set<string>();

/**
 * Get rasterizer cache statistics: process-lifetime counters plus a live
 * scan of the disk cache directories (default dir included, so entries from
 * previous processes are visible too).
 */
export async function getRasterizerCacheStats(): Promise<RasterizerCacheStats> {
  const dirs = new Set(knownCacheDirs);
  const defaultDir = resolveCacheDir();
  if (defaultDir) dirs.add(defaultDir);

  let entries = 0;
  let bytes = 0;
  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.png')) continue;
        try {
          const stat = await fs.stat(path.join(dir, file));
          entries++;
          bytes += stat.size;
        } catch {}
      }
    } catch {
      // Missing dir — nothing cached there.
    }
  }

  const lookups = rasterizerCounters.diskHits + rasterizerCounters.diskMisses;
  return {
    ...rasterizerCounters,
    hitRate: lookups > 0 ? rasterizerCounters.diskHits / lookups : 0,
    entries,
    bytes,
  };
}

/**
 * Delete every cached PNG in the known cache directories (default dir
 * included) and reset the counters. Backs "Clear all caches" (#156) — the
 * disk cache used to survive it.
 */
export async function clearRasterizerCache(): Promise<void> {
  const dirs = new Set(knownCacheDirs);
  const defaultDir = resolveCacheDir();
  if (defaultDir) dirs.add(defaultDir);

  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir);
      await Promise.all(
        files
          .filter((file) => file.endsWith('.png'))
          .map((file) => fs.rm(path.join(dir, file), { force: true }))
      );
    } catch {}
  }

  rasterizerCounters.diskHits = 0;
  rasterizerCounters.diskMisses = 0;
  rasterizerCounters.dedupedRequests = 0;
  rasterizerCounters.rendered = 0;
  rasterizerCounters.failed = 0;
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

function cacheKey(request: {
  presentation: unknown;
  dpi: number;
  baseDir?: string;
}): string {
  return (
    crypto
      .createHash('sha256')
      // baseDir joins the key: the same relative asset path means different
      // pixels under different base directories (#142).
      .update(
        JSON.stringify({
          p: request.presentation,
          dpi: request.dpi,
          base: request.baseDir,
        })
      )
      .digest('hex')
  );
}

function toDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Engine-internal result: the wire shape plus the original error object. */
type EngineSlideResult = PptxRasterizeBatchSlideResult & { cause?: unknown };

/** One unique unit of work: a slide deck plus every request index it serves. */
interface SlideJob {
  presentation: unknown;
  dpi: number;
  /** Request indexes resolved by this job (batch-internal dedup). */
  indexes: number[];
  cachePath: string | null;
  pptxPath: string;
  pdfPath: string;
  pngPrefix: string;
}

const sofficeArgs = (
  profileDir: string,
  outDir: string,
  files: string[]
): string[] => [
  '--headless',
  '--norestore',
  '--nolockcheck',
  '--nodefault',
  `-env:UserInstallation=file://${profileDir.replace(/\\/g, '/')}`,
  '--convert-to',
  'pdf:impress_pdf_Export',
  '--outdir',
  outDir,
  ...files,
];

/**
 * Rasterize N independent single-slide presentations, amortizing the soffice
 * launch across every cache miss. Returns per-slide results (index-aligned);
 * only environment-level failures (missing binaries) throw.
 */
async function rasterizeSlidesWithEngine(
  slides: Array<{ presentation: unknown; dpi: number }>,
  baseDir: string | undefined,
  cacheDir: string | null
): Promise<EngineSlideResult[]> {
  const results: EngineSlideResult[] = new Array(slides.length);
  if (cacheDir) knownCacheDirs.add(cacheDir);

  // 1. Dedupe by content-addressed key: identical slides build, convert, and
  //    hit the cache exactly once, then fan out to every requesting index.
  const jobsByKey = new Map<string, SlideJob>();
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const key = cacheKey({
      presentation: slide.presentation,
      dpi: slide.dpi,
      baseDir,
    });
    const existing = jobsByKey.get(key);
    if (existing) {
      existing.indexes.push(i);
    } else {
      jobsByKey.set(key, {
        presentation: slide.presentation,
        dpi: slide.dpi,
        indexes: [i],
        cachePath: cacheDir ? path.join(cacheDir, `${key}.png`) : null,
        pptxPath: '',
        pdfPath: '',
        pngPrefix: '',
      });
    }
  }

  rasterizerCounters.dedupedRequests += slides.length - jobsByKey.size;

  const fail = (
    job: SlideJob,
    stage: PptxRasterizeFailureStage,
    error: string,
    cause?: unknown
  ) => {
    rasterizerCounters.failed++;
    for (const i of job.indexes)
      results[i] = { ok: false, error, stage, cause };
  };
  const succeed = (job: SlideJob, result: PptxRasterizeResult) => {
    for (const i of job.indexes) results[i] = { ok: true, ...result };
  };

  // 2. Resolve cache hits for the unique jobs in parallel.
  const uncached: SlideJob[] = [];
  await Promise.all(
    [...jobsByKey.values()].map(async (job) => {
      if (job.cachePath) {
        const cached = await fs.readFile(job.cachePath).catch(() => null);
        if (cached) {
          const size = parsePngSize(cached);
          if (size) {
            rasterizerCounters.diskHits++;
            succeed(job, { base64DataUri: toDataUri(cached), ...size });
            return;
          }
          // Corrupt/partial cache file (e.g. a killed prior render) — discard
          // it and re-render rather than embed a broken image.
          await fs.rm(job.cachePath, { force: true }).catch(() => {});
        }
        rasterizerCounters.diskMisses++;
      }
      uncached.push(job);
    })
  );
  if (uncached.length === 0) return results;

  // 3. JSON → .pptx (in-process, pure JS). A build failure is a per-slide
  //    content error; the remaining slides still convert.
  const corePptx = await import('@json-to-office/core-pptx');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-visual-'));
  try {
    const built: SlideJob[] = [];
    for (let j = 0; j < uncached.length; j++) {
      const job = uncached[j];
      job.pptxPath = path.join(tempDir, `slide-${j}.pptx`);
      job.pdfPath = path.join(tempDir, `slide-${j}.pdf`);
      job.pngPrefix = path.join(tempDir, `slide-${j}`);
      try {
        const pptxBuffer = await corePptx.generateBufferFromJson(
          job.presentation as any,
          { baseDir }
        );
        await fs.writeFile(job.pptxPath, pptxBuffer);
        built.push(job);
      } catch (error) {
        fail(job, 'build', errorMessage(error), error);
      }
    }
    if (built.length === 0) return results;

    const [soffice, pdftoppm] = await Promise.all([
      resolveSoffice(),
      resolvePdftoppm(),
    ]);

    // 4. .pptx → PDF: ONE soffice launch converts every deck (the launch is
    //    the multi-second cost being amortized). The timeout scales with the
    //    slide count so a large batch is not misread as a hang, and the whole
    //    engine run gets a deadline of one batch window + one pdftoppm window
    //    per slide — bounded work no matter how conversions misbehave. The
    //    PNG phase is sequential over every slide, so its share must scale
    //    with the slide count like the soffice window does; otherwise a slow
    //    soffice launch drains the budget and slides whose PDFs converted
    //    fine fail spuriously. An HTTP client that gives up sooner falls
    //    back to per-visual calls on its own.
    const batchTimeoutMs = Math.min(
      SOFFICE_TIMEOUT_MS +
        SOFFICE_BATCH_EXTRA_PER_SLIDE_MS * (built.length - 1),
      SOFFICE_BATCH_TIMEOUT_CAP_MS
    );
    const deadlineAt =
      Date.now() + batchTimeoutMs + PDFTOPPM_TIMEOUT_MS * built.length;
    const remainingMs = () => deadlineAt - Date.now();

    let batchError: unknown;
    try {
      await exec(
        soffice,
        sofficeArgs(
          path.join(tempDir, 'profile'),
          tempDir,
          built.map((job) => job.pptxPath)
        ),
        batchTimeoutMs
      );
    } catch (error) {
      batchError = error;
    }

    // 5. Per-slide PDF check. soffice reports batch conversion coarsely (it
    //    can skip a file or die mid-run), so the PDFs on disk are the truth.
    //    A missing PDF gets an isolated single-file launch — salvaging slides
    //    left unprocessed by a mid-batch crash and pinning the error on the
    //    slide that caused it — but only within MAX_ISOLATED_RETRIES and the
    //    deadline, and not when nothing at all converted (an environmental
    //    failure that a retry would only repeat).
    const converted: SlideJob[] = [];
    const missing: SlideJob[] = [];
    for (const job of built) {
      ((await fileExists(job.pdfPath)) ? converted : missing).push(job);
    }

    let retriesLeft =
      missing.length > 0 &&
      built.length > 1 &&
      (batchError === undefined || converted.length > 0)
        ? MAX_ISOLATED_RETRIES
        : 0;
    for (const [r, job] of missing.entries()) {
      const retryBudget = Math.min(SOFFICE_TIMEOUT_MS, remainingMs());
      if (retriesLeft > 0 && retryBudget > 1000) {
        retriesLeft--;
        let retryError: unknown;
        try {
          await exec(
            soffice,
            sofficeArgs(path.join(tempDir, `profile-retry-${r}`), tempDir, [
              job.pptxPath,
            ]),
            retryBudget
          );
        } catch (error) {
          retryError = error;
        }
        if (await fileExists(job.pdfPath)) {
          converted.push(job);
          continue;
        }
        batchError ??= retryError;
      }
      const cause = batchError;
      fail(
        job,
        'convert',
        `LibreOffice failed to convert the slide to PDF${
          cause ? `: ${errorMessage(cause)}` : '.'
        }`,
        cause
      );
    }

    // 6. PDF → PNG at each slide's own dpi (single page, no page suffix).
    //    pdftoppm is cheap per file; each conversion still respects the
    //    engine deadline so a pathological PDF cannot stack 30s timeouts.
    for (const job of converted) {
      const budget = Math.min(PDFTOPPM_TIMEOUT_MS, remainingMs());
      if (budget <= 1000) {
        fail(
          job,
          'rasterize',
          'Rasterization deadline exceeded before this slide could be converted to PNG.'
        );
        continue;
      }
      try {
        await exec(
          pdftoppm,
          [
            '-r',
            String(job.dpi),
            '-png',
            '-singlefile',
            job.pdfPath,
            job.pngPrefix,
          ],
          budget
        );
        const png = await fs.readFile(`${job.pngPrefix}.png`);
        const size = parsePngSize(png);
        if (!size) {
          throw new Error(
            'Rasterization produced an invalid PNG (empty or truncated output from pdftoppm).'
          );
        }
        if (job.cachePath) {
          await writeCacheAtomic(cacheDir!, job.cachePath, png);
        }
        rasterizerCounters.rendered++;
        succeed(job, { base64DataUri: toDataUri(png), ...size });
      } catch (error) {
        fail(job, 'rasterize', errorMessage(error), error);
      }
    }

    return results;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function resolveCacheDir(options?: {
  cacheDir?: string | null;
}): string | null {
  return options?.cacheDir === undefined
    ? path.join(os.tmpdir(), 'jto-visual-cache')
    : options.cacheDir;
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
  const cacheDir = resolveCacheDir(options);

  return async function rasterize(
    request: PptxRasterizeRequest
  ): Promise<PptxRasterizeResult> {
    const [result] = await rasterizeSlidesWithEngine(
      [{ presentation: request.presentation, dpi: request.dpi }],
      request.baseDir,
      cacheDir
    );
    if (!result) throw new Error('Rasterization produced no result.');
    if (!result.ok) {
      const error = new Error(result.error) as Error & { cause?: unknown };
      // Preserve the original failure (exec exit code/signal, fs error) for
      // programmatic consumers — parity with the pre-batch implementation
      // that threw the underlying error directly.
      if (result.cause !== undefined) error.cause = result.cause;
      throw error;
    }
    return {
      base64DataUri: result.base64DataUri,
      width: result.width,
      height: result.height,
    };
  };
}

/**
 * Build a LibreOffice-backed BATCH pptx rasterizer (#153): many independent
 * single-slide presentations, one soffice launch, per-slide results. Shares
 * the content-addressed disk cache with the single-slide rasterizer — the
 * per-slide cache key is identical on both paths.
 */
export function createLibreOfficePptxBatchRasterizer(options?: {
  cacheDir?: string | null;
}): PptxBatchRasterizer {
  const cacheDir = resolveCacheDir(options);

  return async function rasterizeBatch(request) {
    const engineResults = await rasterizeSlidesWithEngine(
      request.slides.map((slide) => ({
        presentation: slide.presentation,
        dpi: slide.dpi ?? DEFAULT_VISUAL_DPI,
      })),
      request.baseDir,
      cacheDir
    );
    // Strip the engine-internal `cause` (non-serializable) from the results.
    return {
      results: engineResults.map((result) =>
        result.ok
          ? result
          : { ok: false, error: result.error, stage: result.stage }
      ),
    };
  };
}

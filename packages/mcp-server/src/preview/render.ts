/**
 * Document JSON → PNG pages.
 *
 * Pipeline: JSON → (core) .docx/.pptx → (LibreOffice) PDF → (poppler) one PNG
 * per selected page. `jto-ops`' rasterizer already runs this route for a
 * single slide behind a docx `visual`; what is new here is the whole-document
 * shape — many pages out of one conversion, an arbitrary selection over them,
 * and a page count that is not known until the PDF exists.
 *
 * Three properties are load-bearing and easy to lose:
 *
 * - Profile isolation. Every soffice launch gets its own `UserInstallation`
 *   directory. Without it a launch attaches to whatever profile is already
 *   open — a developer's running LibreOffice, or a concurrent conversion —
 *   and either hangs or silently converts nothing.
 * - Font staging. The document's resolved faces are staged for the launch
 *   through the shared `FontStager`, so a preview shows the document's real
 *   typography rather than the host's fallbacks. The handle is closed before
 *   the temp tree is removed, because the fontconfig stager freezes its
 *   directory to 0o555 and `rm` cannot unlink inside it afterwards.
 * - Per-page caching. PNGs are filed under a key that covers every input, so
 *   an unchanged document re-previewed launches nothing at all.
 *
 * Nothing here writes to stdout: that stream carries MCP protocol frames.
 * `execFile` captures the child's output — soffice is chatty on stdout — and
 * everything reportable comes back as a diagnostic.
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { GenerationWarning, ResolvedFont } from '@json-to-office/shared';
import { getFontStager, type FontStageHandle } from '@json-to-office/jto-ops';

import type { FormatAdapter, FormatName } from '../lib/adapters.js';
import {
  ERROR_CODES,
  diagnostic,
  failure,
  failureFrom,
  fromValidationErrors,
  type Diagnostic,
  type Failure,
} from '../lib/errors.js';
import type { RenderOptionsInput } from '../lib/schema.js';
import { probeBinary } from '../tools/info.js';
import { PREVIEW_ERROR_CODES, type PreviewStage } from './codes.js';
import {
  derivePreviewCacheKeys,
  digestAssets,
  digestFonts,
  digestThemeFile,
  type PreviewCacheKeys,
} from './cache-key.js';
import {
  MAX_PREVIEW_PAGES,
  PREVIEW_DEFAULT_DPI,
  budgetSuggestion,
  describeBudget,
  estimatedInlineBudget,
  type PreviewOutputMode,
} from './limits.js';
import {
  missingDependencyFailure,
  probePreviewDependencies,
  readConverterVersions,
  type ConverterVersions,
  type DependencyProbe,
} from './dependencies.js';
import {
  canonicalRangeSpec,
  formatPageSelection,
  parsePageSpec,
  resolvePages,
  ALL_PAGES,
  type PageRange,
} from './page-spec.js';

/** One conversion of a whole document. Scaled by nothing: it is a single launch. */
const SOFFICE_TIMEOUT_MS = 180_000;
/** One page. pdftoppm is fast; a page that needs longer is pathological. */
const PDFTOPPM_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Cached pages older than this are swept, whether or not the cache is large. */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Ceiling on what survives the age sweep. A 300-DPI page is 1-3 MB. */
const CACHE_MAX_BYTES = 512 * 1024 * 1024;

/**
 * A per-user suffix for the cache directory.
 *
 * `os.tmpdir()` is already per-user on macOS but shared by every account on
 * Linux, so one fixed name there would mix one user's rendered pages with
 * another's — and hand whoever created the directory first control of its
 * permissions. The uid is the natural discriminator; Windows reports -1 for
 * everyone, so the account name is hashed rather than used raw, which keeps
 * the directory name a fixed-width token whatever the name contains.
 */
function cacheOwnerToken(): string {
  try {
    const info = os.userInfo();
    if (typeof info.uid === 'number' && info.uid >= 0) return String(info.uid);
    return crypto
      .createHash('sha256')
      .update(info.username)
      .digest('hex')
      .slice(0, 12);
  } catch {
    // No passwd entry for this process. A shared directory is still a better
    // cache than no cache.
    return 'shared';
  }
}

/** Where PNGs are filed when the caller does not choose. */
export function defaultPreviewCacheDir(): string {
  return path.join(os.tmpdir(), `jto-mcp-preview-cache-${cacheOwnerToken()}`);
}

export interface PreviewCacheSweepOptions {
  maxAgeMs?: number;
  maxBytes?: number;
  /** Injectable clock, so the age rule is testable without touching mtimes. */
  now?: number;
}

export interface PreviewCacheSweep {
  removed: number;
  bytes: number;
}

/**
 * Bound the cache directory.
 *
 * Nothing else ever removes from it: the directory outlives the process, is
 * shared by every connection, and a miss only ever adds. Without this a
 * long-lived host accumulates every page it has ever previewed until the disk
 * says no — and the failure lands on whatever else needed the space, not on
 * this server.
 *
 * Eviction is by age of write, then oldest-first until the survivors fit the
 * ceiling. Not an LRU: a cache hit does not touch the file, and stat-plus-utimes
 * on every hit would cost more than the occasional re-render it saves. Deleting
 * a page or its sibling meta file only ever costs a conversion, so entries are
 * treated as independent and nothing has to be kept in step.
 */
export async function sweepPreviewCache(
  cacheDir: string,
  options: PreviewCacheSweepOptions = {}
): Promise<PreviewCacheSweep> {
  const maxAgeMs = options.maxAgeMs ?? CACHE_MAX_AGE_MS;
  const maxBytes = options.maxBytes ?? CACHE_MAX_BYTES;
  const now = options.now ?? Date.now();

  const names = await fs.readdir(cacheDir).catch(() => undefined);
  if (!names) return { removed: 0, bytes: 0 };

  const entries: Array<{ file: string; mtimeMs: number; size: number }> = [];
  for (const name of names) {
    const file = path.join(cacheDir, name);
    const stat = await fs.stat(file).catch(() => undefined);
    if (!stat?.isFile()) continue;
    entries.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
  }

  const doomed = entries.filter((entry) => now - entry.mtimeMs > maxAgeMs);
  const kept = entries
    .filter((entry) => now - entry.mtimeMs <= maxAgeMs)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  let total = kept.reduce((sum, entry) => sum + entry.size, 0);
  while (total > maxBytes && kept.length > 0) {
    const oldest = kept.shift() as (typeof kept)[number];
    doomed.push(oldest);
    total -= oldest.size;
  }

  let removed = 0;
  let bytes = 0;
  for (const entry of doomed) {
    // Another process may be sweeping or writing the same directory; a file
    // already gone is the outcome we wanted, not a failure.
    const ok = await fs.rm(entry.file, { force: true }).then(
      () => true,
      () => false
    );
    if (!ok) continue;
    removed += 1;
    bytes += entry.size;
  }
  return { removed, bytes };
}

/** How often a connection re-checks a cache directory it has already swept. */
const CACHE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Sweep before the cache is consulted, at most once an hour per directory.
 *
 * Sweeping on every write would re-walk the directory for no new information.
 * Sweeping only at startup would leave a connection that stays open for days —
 * the normal shape for this server — filling the directory again with nothing
 * to stop it, so the guard is an interval rather than a one-shot.
 */
const sweptDirs = new Map<string, { at: number; done: Promise<unknown> }>();
function ensureSwept(cacheDir: string): Promise<unknown> {
  const previous = sweptDirs.get(cacheDir);
  if (previous && Date.now() - previous.at < CACHE_SWEEP_INTERVAL_MS) {
    return previous.done;
  }
  // A cache that cannot be pruned is still a usable cache, so failures here
  // are swallowed rather than failing the preview.
  const done = sweepPreviewCache(cacheDir).catch(() => undefined);
  sweptDirs.set(cacheDir, { at: Date.now(), done });
  return done;
}

export interface RenderPreviewOptions {
  format: FormatName;
  document: unknown;
  /** Page spec — see `page-spec.ts`. Defaults to every page. */
  pages?: string;
  dpi?: number;
  render?: RenderOptionsInput;
  /** How the caller intends to receive pages; decides the pre-flight refusal. */
  outputMode?: PreviewOutputMode;
  getAdapter(format: FormatName): FormatAdapter;
  /** Injectable for the missing-dependency path. */
  probe?: DependencyProbe;
  /** `null` disables the disk cache. */
  cacheDir?: string | null;
  signal?: AbortSignal;
  onProgress?: (update: PreviewProgress) => void;
  /** Override the per-call page ceiling. Tests use it; production does not. */
  maxPages?: number;
}

export interface PreviewProgress {
  progress: number;
  total: number;
  message: string;
}

export interface RenderedPage {
  page: number;
  png: Buffer;
  width: number;
  height: number;
  /** True when the PNG came off disk and no converter ran for it. */
  cached: boolean;
}

export interface PreviewRenderSuccess {
  ok: true;
  diagnostics: Diagnostic[];
  format: FormatName;
  totalPages: number;
  pages: RenderedPage[];
  /** Canonical spelling of what was selected, e.g. `"1-3,7"`. */
  selection: string;
  dpi: number;
  keys: PreviewCacheKeys;
  converters: ConverterVersions;
  cache: { hits: number; misses: number; enabled: boolean };
  timings: { generateMs: number; convertMs: number; rasterizeMs: number };
}

export type PreviewRenderResult = PreviewRenderSuccess | Failure;

function elapsed(from: bigint): number {
  return Number((process.hrtime.bigint() - from) / 1_000_000n);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cancelled(): Failure {
  return failure(ERROR_CODES.CANCELLED, 'The preview was cancelled.', {
    severity: 'info',
  });
}

function renderFailure(
  stage: PreviewStage,
  detail: string,
  context: Record<string, unknown> = {}
): Failure {
  const suggestion =
    stage === 'build'
      ? 'Run jto_validate on the document: a build failure is a defect in the JSON, not in the renderer.'
      : 'Re-run at a lower DPI or with fewer pages; if it persists, the document may use a feature LibreOffice cannot import.';
  return failure(
    PREVIEW_ERROR_CODES.RENDER_FAILED,
    `Preview failed at the ${stage} stage: ${detail}`,
    { suggestion, context: { stage, ...context } }
  );
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Validate a PNG and read its IHDR dimensions.
 *
 * `jto-ops` keeps its own copy of this private, and a truncated PNG is exactly
 * what a killed converter leaves behind — so a cached file is re-checked on
 * every read rather than trusted because it exists.
 */
export function parsePngSize(
  png: Buffer
): { width: number; height: number } | null {
  if (png.length < 24) return null;
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (png.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Page count straight out of the PDF bytes.
 *
 * LibreOffice writes page objects uncompressed, so counting them costs a
 * regex and no process. A producer that packs them into object streams
 * returns 0 here and the caller falls back to `pdfinfo`.
 */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

function exec(
  binary: string,
  args: string[],
  timeoutMs: number,
  options: { env?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        ...(options.signal && { signal: options.signal }),
      },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

/**
 * soffice arguments, mirroring `jto-ops`' rasterizer.
 *
 * `-env:UserInstallation` is the isolation: a `file://` URL built from the
 * profile directory, forward slashes even on Windows. The filter is chosen by
 * format because Writer and Impress export through different ones and the
 * wrong pick converts nothing.
 */
function sofficeArgs(
  format: FormatName,
  profileDir: string,
  outDir: string,
  file: string
): string[] {
  const filter = format === 'pptx' ? 'impress_pdf_Export' : 'writer_pdf_Export';
  return [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--nodefault',
    `-env:UserInstallation=file://${profileDir.replace(/\\/g, '/')}`,
    '--convert-to',
    `pdf:${filter}`,
    '--outdir',
    outDir,
    file,
  ];
}

/** Count a spec's pages when every range is closed; undefined when open-ended. */
export function boundedPageCount(
  ranges: readonly PageRange[]
): number | undefined {
  const pages = new Set<number>();
  for (const range of ranges) {
    if (range.to === null) return undefined;
    for (let page = range.from; page <= range.to; page += 1) pages.add(page);
  }
  return pages.size;
}

interface CacheIO {
  enabled: boolean;
  readMeta(documentKey: string): Promise<number | undefined>;
  writeMeta(documentKey: string, totalPages: number): Promise<void>;
  readPage(key: string): Promise<Buffer | undefined>;
  writePage(key: string, png: Buffer): Promise<void>;
}

function createCacheIO(cacheDir: string | null): CacheIO {
  if (cacheDir === null) {
    return {
      enabled: false,
      readMeta: async () => undefined,
      writeMeta: async () => {},
      readPage: async () => undefined,
      writePage: async () => {},
    };
  }

  const metaPath = (key: string) => path.join(cacheDir, `${key}.meta.json`);
  const pagePath = (key: string) => path.join(cacheDir, `${key}.png`);

  return {
    enabled: true,

    async readMeta(documentKey) {
      try {
        const raw = await fs.readFile(metaPath(documentKey), 'utf8');
        const parsed = JSON.parse(raw) as { totalPages?: unknown };
        return typeof parsed.totalPages === 'number' &&
          Number.isInteger(parsed.totalPages) &&
          parsed.totalPages > 0
          ? parsed.totalPages
          : undefined;
      } catch {
        return undefined;
      }
    },

    async writeMeta(documentKey, totalPages) {
      await writeAtomic(
        cacheDir,
        metaPath(documentKey),
        Buffer.from(JSON.stringify({ totalPages }))
      );
    },

    async readPage(key) {
      const file = pagePath(key);
      const png = await fs.readFile(file).catch(() => undefined);
      if (!png) return undefined;
      if (parsePngSize(png)) return png;
      // A killed converter leaves half a PNG behind; discard rather than
      // hand back an image that will not decode.
      await fs.rm(file, { force: true }).catch(() => {});
      return undefined;
    },

    async writePage(key, png) {
      await writeAtomic(cacheDir, pagePath(key), png);
    },
  };
}

let tempCounter = 0;
/** Temp file plus rename, so a concurrent reader never sees half a PNG. */
async function writeAtomic(
  dir: string,
  target: string,
  data: Buffer
): Promise<void> {
  const temp = `${target}.tmp-${process.pid}-${tempCounter++}`;
  try {
    // 0o700 on creation: the per-user directory name keeps accounts apart,
    // but only the mode keeps another account out of one it did not create.
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  } catch {
    // The cache is an optimization; a failure to populate it is not a failure
    // to preview. Clean up the partial file and move on.
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

/** `pdfinfo` lives in poppler alongside `pdftoppm`; look next door first. */
async function resolvePdfinfo(
  pdftoppmPath: string
): Promise<string | undefined> {
  const sibling = path.join(
    path.dirname(pdftoppmPath),
    process.platform === 'win32' ? 'pdfinfo.exe' : 'pdfinfo'
  );
  const status = await probeBinary([sibling, 'pdfinfo'], 'PDFTOPPM_PATH');
  return status.available ? status.path : undefined;
}

async function pdfinfoPageCount(
  pdfinfo: string,
  pdfPath: string,
  signal?: AbortSignal
): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(
      pdfinfo,
      [pdfPath],
      {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        ...(signal && { signal }),
      },
      (error, stdout) => {
        if (error && !stdout) return resolve(undefined);
        const match = /^Pages:\s+(\d+)/m.exec(stdout ?? '');
        resolve(match ? Number(match[1]) : undefined);
      }
    );
  });
}

/**
 * Render selected pages of a document to PNG.
 *
 * Every failure is a value: a missing binary, a malformed page spec, an
 * oversized request and a LibreOffice crash all come back as `ok: false` with
 * diagnostics the caller can act on. Only a genuine bug throws, and the tool
 * wrapper turns that into `E_INTERNAL`.
 */
export async function renderPreview(
  options: RenderPreviewOptions
): Promise<PreviewRenderResult> {
  const {
    format,
    document,
    signal,
    onProgress,
    outputMode = 'auto',
    maxPages = MAX_PREVIEW_PAGES,
  } = options;
  const dpi = options.dpi ?? PREVIEW_DEFAULT_DPI;
  const render = options.render ?? {};
  const diagnostics: Diagnostic[] = [];

  const parsed = parsePageSpec(options.pages ?? ALL_PAGES);
  if (!parsed.ok) return parsed;

  // A closed selection is countable before anything runs, so an impossible
  // request is refused for the price of parsing it rather than for the price
  // of a conversion.
  const bounded = boundedPageCount(parsed.ranges);
  if (bounded !== undefined) {
    const refusal = refuseOversized(bounded, dpi, outputMode, maxPages);
    if (refusal) return refusal;
  }

  const probe = options.probe ?? probePreviewDependencies;
  const dependencies = await probe();
  const missing = missingDependencyFailure(dependencies);
  if (missing) return missing;
  if (signal?.aborted) return cancelled();

  const cacheDir =
    options.cacheDir === undefined
      ? defaultPreviewCacheDir()
      : options.cacheDir;
  const cache = createCacheIO(cacheDir);
  if (cacheDir !== null) await ensureSwept(cacheDir);

  // Total progress: generate, convert, then one step per page. The page count
  // is unknown until the PDF exists, so the total is revised upward once —
  // clients render a growing denominator fine, and inventing a fake one would
  // be worse.
  let progressTotal = 3;
  let progressDone = 0;
  const report = (text: string) => {
    progressDone += 1;
    onProgress?.({
      progress: progressDone,
      total: progressTotal,
      message: text,
    });
  };

  const generateStarted = process.hrtime.bigint();
  const resolvedFonts: ResolvedFont[] = [];
  const warnings: GenerationWarning[] = [];
  let officeBytes: Buffer;
  let converters: ConverterVersions;
  try {
    // The version probe is a cold `soffice --version`; running it beside
    // generation hides most of its cost behind work that had to happen anyway.
    const [buffer, versions] = await Promise.all([
      options.getAdapter(format).generateBuffer(document, {
        ...render,
        warnings,
        fonts: {
          onResolved: (fonts) => resolvedFonts.push(...fonts),
        },
      }),
      readConverterVersions(dependencies, signal),
    ]);
    officeBytes = buffer;
    converters = versions;
  } catch (error) {
    if (signal?.aborted) return cancelled();
    // "Document validation failed" on its own is not something an agent can
    // repair. The adapter can say exactly which pointers are wrong, so ask it
    // and lead with that — the same diagnostics jto_validate would have given.
    return failureFrom([
      ...validationDiagnostics(options.getAdapter(format), document),
      ...renderFailure('build', message(error)).diagnostics,
    ]);
  }
  const generateMs = elapsed(generateStarted);
  diagnostics.push(...toDiagnostics(warnings));
  report('Document generated');
  if (signal?.aborted) return cancelled();

  const keys = derivePreviewCacheKeys({
    format,
    document,
    render,
    themeDigest: await digestThemeFile(render.themePath),
    assetsDigest: await digestAssets(document, render.baseDir),
    fontsDigest: digestFonts(resolvedFonts),
    dpi,
    // The run key names a whole request, so it carries the selection; the page
    // keys below deliberately do not, which is what lets two overlapping
    // selections share pages.
    pageSelection: canonicalRangeSpec(parsed.ranges),
    converters: converters.identities,
  });

  let hits = 0;
  let misses = 0;

  // Fully-cached fast path: the page count was recorded last time, so the
  // selection can be resolved and served without launching anything.
  const cachedTotal = await cache.readMeta(keys.documentKey);
  if (cachedTotal !== undefined) {
    const resolved = resolvePages(parsed.ranges, cachedTotal, maxPages);
    if (!resolved.ok) return resolved;
    const refusal = refuseOversized(
      resolved.pages.length,
      dpi,
      outputMode,
      maxPages
    );
    if (refusal) return refusal;

    const served = await readAllCached(cache, keys, resolved.pages);
    if (served) {
      hits = served.length;
      progressTotal = 1 + served.length;
      for (const page of served) report(`Page ${page.page} from cache`);
      return {
        ok: true,
        diagnostics: [...diagnostics, ...resolved.diagnostics],
        format,
        totalPages: cachedTotal,
        pages: served,
        selection: formatPageSelection(resolved.pages),
        dpi,
        keys,
        converters,
        cache: { hits, misses, enabled: cache.enabled },
        timings: { generateMs, convertMs: 0, rasterizeMs: 0 },
      };
    }
  }

  const soffice = dependencies.libreoffice.path as string;
  const pdftoppm = dependencies.pdftoppm.path as string;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-preview-'));
  const profileDir = path.join(tempDir, 'profile');
  const stem = `preview-${crypto.randomBytes(4).toString('hex')}`;
  const officePath = path.join(
    tempDir,
    `${stem}${format === 'pptx' ? '.pptx' : '.docx'}`
  );
  const pdfPath = path.join(tempDir, `${stem}.pdf`);
  let stageHandle: FontStageHandle | null = null;

  try {
    await fs.writeFile(officePath, officeBytes);

    // Staged after the cache probe, before the launch: a fully-cached preview
    // must not pay for writing font files it will never use.
    const stageable = resolvedFonts.filter((font) => font.sources.length > 0);
    if (stageable.length > 0) {
      stageHandle = await getFontStager().stage(stageable, tempDir, {
        profileDirs: [profileDir],
      });
    }

    const convertStarted = process.hrtime.bigint();
    try {
      await exec(
        soffice,
        sofficeArgs(format, profileDir, tempDir, officePath),
        SOFFICE_TIMEOUT_MS,
        {
          ...(stageHandle?.envOverrides && { env: stageHandle.envOverrides }),
          ...(signal && { signal }),
        }
      );
    } catch (error) {
      if (signal?.aborted) return cancelled();
      return renderFailure('convert', message(error), { binary: soffice });
    }
    const convertMs = elapsed(convertStarted);

    const pdf = await fs.readFile(pdfPath).catch(() => undefined);
    if (!pdf) {
      // soffice reports conversion coarsely and can exit 0 having written
      // nothing; the file on disk is the only truth.
      return renderFailure(
        'convert',
        'LibreOffice exited without producing a PDF.',
        { binary: soffice }
      );
    }
    report('Converted to PDF');
    if (signal?.aborted) return cancelled();

    let totalPages = countPdfPages(pdf);
    if (totalPages === 0) {
      const pdfinfo = await resolvePdfinfo(pdftoppm);
      if (pdfinfo) {
        totalPages = (await pdfinfoPageCount(pdfinfo, pdfPath, signal)) ?? 0;
      }
    }
    if (totalPages === 0) {
      return failure(
        PREVIEW_ERROR_CODES.PAGE_COUNT_UNAVAILABLE,
        'The page count of the converted PDF could not be determined.',
        {
          suggestion:
            'Install poppler’s pdfinfo alongside pdftoppm so the page count can be read directly.',
        }
      );
    }
    await cache.writeMeta(keys.documentKey, totalPages);

    const resolved = resolvePages(parsed.ranges, totalPages, maxPages);
    if (!resolved.ok) return resolved;
    diagnostics.push(...resolved.diagnostics);

    const refusal = refuseOversized(
      resolved.pages.length,
      dpi,
      outputMode,
      maxPages
    );
    if (refusal) return refusal;

    progressTotal = 2 + resolved.pages.length;
    const rasterizeStarted = process.hrtime.bigint();
    const pages: RenderedPage[] = [];

    for (const page of resolved.pages) {
      if (signal?.aborted) return cancelled();

      const key = keys.pageKey(page);
      const cached = await cache.readPage(key);
      if (cached) {
        const size = parsePngSize(cached) as { width: number; height: number };
        hits += 1;
        pages.push({ page, png: cached, cached: true, ...size });
        report(`Page ${page} from cache`);
        continue;
      }
      misses += 1;

      // One pdftoppm per page with `-singlefile`: the output name is then
      // exactly `<prefix>.png`, with no zero-padding that varies with the
      // document's page count, and cancellation lands between pages.
      const prefix = path.join(tempDir, `page-${page}`);
      try {
        await exec(
          pdftoppm,
          [
            '-r',
            String(dpi),
            '-png',
            '-f',
            String(page),
            '-l',
            String(page),
            '-singlefile',
            pdfPath,
            prefix,
          ],
          PDFTOPPM_TIMEOUT_MS,
          { ...(signal && { signal }) }
        );
      } catch (error) {
        if (signal?.aborted) return cancelled();
        return renderFailure('rasterize', message(error), {
          page,
          binary: pdftoppm,
        });
      }

      const png = await fs.readFile(`${prefix}.png`).catch(() => undefined);
      const size = png ? parsePngSize(png) : null;
      if (!png || !size) {
        return renderFailure(
          'rasterize',
          `pdftoppm produced no readable PNG for page ${page}.`,
          { page }
        );
      }
      await cache.writePage(key, png);
      pages.push({ page, png, cached: false, ...size });
      report(`Page ${page} rendered`);
    }

    return {
      ok: true,
      diagnostics,
      format,
      totalPages,
      pages,
      selection: formatPageSelection(resolved.pages),
      dpi,
      keys,
      converters,
      cache: { hits, misses, enabled: cache.enabled },
      timings: {
        generateMs,
        convertMs,
        rasterizeMs: elapsed(rasterizeStarted),
      },
    };
  } finally {
    // Order matters: the fontconfig stager freezes its staged directory to
    // 0o555, and `rm` cannot unlink inside a directory it cannot write.
    if (stageHandle) await stageHandle.cleanup().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Every requested page, or undefined when any of them is not on disk. */
async function readAllCached(
  cache: CacheIO,
  keys: PreviewCacheKeys,
  pages: readonly number[]
): Promise<RenderedPage[] | undefined> {
  if (!cache.enabled) return undefined;
  const rendered: RenderedPage[] = [];
  for (const page of pages) {
    const png = await cache.readPage(keys.pageKey(page));
    if (!png) return undefined;
    const size = parsePngSize(png) as { width: number; height: number };
    rendered.push({ page, png, cached: true, ...size });
  }
  return rendered;
}

/**
 * Refuse a request that cannot be answered, before answering it.
 *
 * The page ceiling applies in every mode — preview is a look, and fifty pages
 * is already more than a look. The byte ceiling applies only when the caller
 * insisted on inline images: in `auto` an oversized payload is not a refusal
 * at all, it is a fallback to paths, which the tool decides once the real
 * bytes are known.
 */
function refuseOversized(
  pageCount: number,
  dpi: number,
  outputMode: PreviewOutputMode,
  maxPages: number
): Failure | undefined {
  if (pageCount > maxPages) {
    return failure(
      PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC,
      `${pageCount} pages were selected; jto_preview renders at most ${maxPages} per call.`,
      {
        suggestion: `Narrow the selection, e.g. "1-${maxPages}", and call again for the rest.`,
        context: { selected: pageCount, maxPages },
      }
    );
  }
  if (outputMode !== 'images') return undefined;

  const budget = estimatedInlineBudget(pageCount, dpi);
  if (budget.fits) return undefined;
  return failure(PREVIEW_ERROR_CODES.TOO_LARGE, describeBudget(budget), {
    suggestion: budgetSuggestion(dpi),
    context: { budget, dpi },
  });
}

/**
 * Path-addressed reasons a document would not build.
 *
 * Best-effort: a validator that itself throws must not replace the build
 * failure the caller is already being told about.
 */
function validationDiagnostics(
  adapter: FormatAdapter,
  document: unknown
): Diagnostic[] {
  try {
    const result = adapter.validateDocument(document);
    return result.valid ? [] : fromValidationErrors(result.errors);
  } catch {
    return [];
  }
}

/** Generation warnings, preserved as diagnostics rather than dropped. */
function toDiagnostics(warnings: readonly GenerationWarning[]): Diagnostic[] {
  return warnings.map((warning) =>
    diagnostic(
      typeof warning.context?.code === 'string'
        ? warning.context.code
        : 'W_GENERATION',
      `${warning.component}: ${warning.message}`,
      {
        severity: warning.severity === 'info' ? 'info' : 'warning',
        ...(warning.context && { context: warning.context }),
      }
    )
  );
}

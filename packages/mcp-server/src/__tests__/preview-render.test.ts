/**
 * The pipeline itself, run for real where the host allows it.
 *
 * The parsing helpers and the progress bridge are pure and always run. The
 * end-to-end suite needs LibreOffice and poppler and skips itself when they
 * are absent, so a cold checkout stays green — set `JTO_REQUIRE_LIBREOFFICE=1`
 * to turn that skip into a failure where the tools are guaranteed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { getAdapter } from '../lib/adapters.js';
import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { createServer } from '../server.js';
import { ERROR_CODES } from '../lib/errors.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';
import {
  countPdfPages,
  defaultPreviewCacheDir,
  parsePngSize,
  renderPreview,
  sweepPreviewCache,
} from '../preview/render.js';
import { probePreviewDependencies } from '../preview/dependencies.js';
import { progressReporter, PREVIEW_FIDELITY_NOTE } from '../tools/preview.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('parsePngSize', () => {
  it('reads the dimensions of a real PNG', () => {
    // 4x2 PNG, the same fixture the docx smoke test uses.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC',
      'base64'
    );
    expect(parsePngSize(png)).toEqual({ width: 4, height: 2 });
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['truncated', Buffer.concat([PNG_MAGIC, Buffer.alloc(4)])],
    ['not a PNG', Buffer.from('GIF89a not a png at all really')],
  ])('rejects a %s buffer rather than reporting 0x0', (_label, buffer) => {
    expect(parsePngSize(buffer)).toBeNull();
  });
});

describe('countPdfPages', () => {
  it('counts page objects and ignores the page tree node', () => {
    const pdf = Buffer.from(
      '%PDF-1.6\n' +
        '1 0 obj<</Type /Pages /Count 2 /Kids[2 0 R 3 0 R]>>endobj\n' +
        '2 0 obj<</Type /Page /Parent 1 0 R>>endobj\n' +
        '3 0 obj<</Type/Page /Parent 1 0 R>>endobj\n'
    );
    expect(countPdfPages(pdf)).toBe(2);
  });

  it('reports zero when the page objects are not readable, so the caller falls back', () => {
    expect(countPdfPages(Buffer.from('%PDF-1.7\n<</Type /ObjStm>>'))).toBe(0);
  });
});

describe('progressReporter', () => {
  it('stays silent when the client sent no progress token', () => {
    const notify = vi.fn();
    expect(progressReporter({ mcpReq: { notify } } as never)).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('emits notifications/progress against the client’s token', () => {
    const notify = vi.fn(async () => {});
    const report = progressReporter({
      mcpReq: { notify, _meta: { progressToken: 'tok-1' } },
    } as never);
    expect(report).toBeDefined();

    report!({ progress: 2, total: 5, message: 'Page 2 rendered' });
    expect(notify).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: {
        progressToken: 'tok-1',
        progress: 2,
        total: 5,
        message: 'Page 2 rendered',
      },
    });
  });

  it.each([
    [
      'a rejected notification',
      async () => {
        throw new Error('transport closed');
      },
    ],
    [
      'a synchronously throwing transport',
      () => {
        throw new Error('transport closed');
      },
    ],
  ])(
    'swallows %s: a dropped frame is not a failed render',
    (_label, notify) => {
      const report = progressReporter({
        mcpReq: { notify, _meta: { progressToken: 7 } },
      } as never);
      expect(() =>
        report!({ progress: 1, total: 2, message: 'x' })
      ).not.toThrow();
    }
  );
});

describe('a document that will not build', () => {
  it('leads with the path-addressed reasons, not just "validation failed"', async () => {
    const result = await renderPreview({
      format: 'docx',
      // `name` is required; without it the core refuses the document.
      document: { children: [] },
      getAdapter,
      cacheDir: null,
      // Both binaries "present" so the run reaches generation; neither is
      // spawned, because the build fails first.
      probe: async () => ({
        libreoffice: {
          available: true,
          path: '/nowhere/soffice',
          envVar: 'LIBREOFFICE_PATH',
          searched: [],
        },
        pdftoppm: {
          available: true,
          path: '/nowhere/pdftoppm',
          envVar: 'PDFTOPPM_PATH',
          searched: [],
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.diagnostics.map((issue) => issue.code);
    expect(codes).toContain(PREVIEW_ERROR_CODES.RENDER_FAILED);
    // Something more useful than the bare failure came back with it.
    expect(result.diagnostics.length).toBeGreaterThan(1);
    expect(result.diagnostics[0].code).not.toBe(
      PREVIEW_ERROR_CODES.RENDER_FAILED
    );
  }, 60_000);
});

describe('preview cache hygiene', () => {
  const cacheName = (character: string, suffix = '.png') =>
    `${character.repeat(64)}${suffix}`;

  /** Write `name` into `dir` with an mtime `ageMs` in the past. */
  async function seed(
    dir: string,
    name: string,
    bytes: number,
    ageMs: number
  ): Promise<string> {
    const file = path.join(dir, name);
    await fs.writeFile(file, Buffer.alloc(bytes, 1));
    const when = new Date(Date.now() - ageMs);
    await fs.utimes(file, when, when);
    return file;
  }

  const exists = (file: string) =>
    fs.access(file).then(
      () => true,
      () => false
    );

  it('uses an unpredictable stable process namespace in shared tmp', () => {
    const dir = defaultPreviewCacheDir();
    expect(path.dirname(dir)).toBe(os.tmpdir());
    expect(path.basename(dir)).toMatch(
      /^jto-mcp-preview-cache-\d+-[a-f0-9]{24}$/
    );
    expect(defaultPreviewCacheDir()).toBe(dir);
  });

  it('drops entries past the age limit and keeps the rest', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-sweep-'));
    try {
      const stale = await seed(dir, cacheName('a'), 128, 10 * 24 * 3600_000);
      const fresh = await seed(dir, cacheName('b'), 128, 60_000);
      const unrelated = await seed(
        dir,
        'unrelated.png',
        128,
        10 * 24 * 3600_000
      );

      const swept = await sweepPreviewCache(dir, {
        maxAgeMs: 7 * 24 * 3600_000,
      });

      expect(swept.removed).toBe(1);
      expect(swept.bytes).toBe(128);
      expect(await exists(stale)).toBe(false);
      expect(await exists(fresh)).toBe(true);
      expect(await exists(unrelated)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('evicts oldest-first until the survivors fit the byte ceiling', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-sweep-'));
    try {
      const oldest = await seed(dir, cacheName('a'), 400, 3 * 3600_000);
      const middle = await seed(dir, cacheName('b'), 400, 2 * 3600_000);
      const newest = await seed(dir, cacheName('c'), 400, 1 * 3600_000);

      await sweepPreviewCache(dir, { maxBytes: 900 });

      expect(await exists(oldest)).toBe(false);
      expect(await exists(middle)).toBe(true);
      expect(await exists(newest)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('treats a cache directory that was never created as already clean', async () => {
    const dir = path.join(os.tmpdir(), `jto-mcp-sweep-absent-${Date.now()}`);
    await expect(sweepPreviewCache(dir)).resolves.toEqual({
      removed: 0,
      bytes: 0,
    });
    expect(await exists(dir)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'tightens an owned cache directory to owner-only',
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-sweep-'));
      try {
        await fs.chmod(dir, 0o755);
        await sweepPreviewCache(dir);
        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === 'win32')(
    'never follows a cache-directory symlink while sweeping',
    async () => {
      const parent = await fs.mkdtemp(
        path.join(os.tmpdir(), 'jto-mcp-sweep-link-')
      );
      const victimDir = path.join(parent, 'victim');
      const cacheLink = path.join(parent, 'cache');
      await fs.mkdir(victimDir);
      const victim = await seed(
        victimDir,
        cacheName('a'),
        64,
        400 * 24 * 3600_000
      );
      await fs.symlink(victimDir, cacheLink, 'dir');

      try {
        await expect(sweepPreviewCache(cacheLink)).resolves.toEqual({
          removed: 0,
          bytes: 0,
        });
        expect(await exists(victim)).toBe(true);
      } finally {
        await fs.rm(parent, { recursive: true, force: true });
      }
    }
  );

  it('sweeps the directory before a render consults it', async () => {
    // The wiring, not the rule: this document never builds, so nothing is
    // converted — but the sweep runs ahead of generation, which is the only
    // point at which an unbounded directory can be brought back under control.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-sweep-'));
    try {
      const stale = await seed(dir, cacheName('a'), 64, 400 * 24 * 3600_000);

      await renderPreview({
        format: 'docx',
        document: { children: [] },
        getAdapter,
        cacheDir: dir,
        probe: async () => ({
          libreoffice: {
            available: true,
            path: '/nowhere/soffice',
            envVar: 'LIBREOFFICE_PATH',
            searched: [],
          },
          pdftoppm: {
            available: true,
            path: '/nowhere/pdftoppm',
            envVar: 'PDFTOPPM_PATH',
            searched: [],
          },
        }),
      });

      expect(await exists(stale)).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

const dependencies = await probePreviewDependencies();
const canRender =
  dependencies.libreoffice.available && dependencies.pdftoppm.available;

if (!canRender && process.env.JTO_REQUIRE_LIBREOFFICE === '1') {
  throw new Error(
    'JTO_REQUIRE_LIBREOFFICE=1 but LibreOffice and/or poppler were not found: ' +
      JSON.stringify({
        libreoffice: dependencies.libreoffice.available,
        pdftoppm: dependencies.pdftoppm.available,
      })
  );
}

describe.skipIf(!canRender)(
  'end-to-end render (needs LibreOffice + poppler)',
  () => {
    let cacheDir: string;
    let outDir: string;
    let docx: unknown;
    let pptx: unknown;

    beforeAll(async () => {
      cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-pcache-'));
      outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-pout-'));
      docx = JSON.parse(
        await fs.readFile(
          path.join(repoRoot, 'examples/invoice.docx.json'),
          'utf8'
        )
      );
      pptx = JSON.parse(
        await fs.readFile(
          path.join(repoRoot, 'examples/quarterly-review.pptx.json'),
          'utf8'
        )
      );
    });

    afterAll(async () => {
      await fs.rm(cacheDir, { recursive: true, force: true });
      await fs.rm(outDir, { recursive: true, force: true });
    });

    it('renders DOCX pages to real PNGs', async () => {
      const progress: number[] = [];
      const result = await renderPreview({
        format: 'docx',
        document: docx,
        pages: '1-2',
        dpi: 96,
        getAdapter,
        cacheDir,
        onProgress: (update) => progress.push(update.progress),
      });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;

      expect(result.totalPages).toBeGreaterThanOrEqual(2);
      expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
      for (const page of result.pages) {
        expect(page.png.length).toBeGreaterThan(1000);
        expect(page.png.subarray(0, 8)).toEqual(PNG_MAGIC);
        expect(parsePngSize(page.png)).toEqual({
          width: page.width,
          height: page.height,
        });
        expect(page.width).toBeGreaterThan(400);
        expect(page.height).toBeGreaterThan(page.width);
      }
      expect(result.selection).toBe('1-2');
      expect(result.converters.libreoffice).toMatch(/LibreOffice/i);
      // Progress is reported once per stage and once per page, ascending.
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
      expect(progress.length).toBeGreaterThanOrEqual(4);
    }, 180_000);

    it('renders PPTX slides to real PNGs, wider than they are tall', async () => {
      const result = await renderPreview({
        format: 'pptx',
        document: pptx,
        pages: '1',
        dpi: 96,
        getAdapter,
        cacheDir,
      });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const [slide] = result.pages;
      expect(slide.png.subarray(0, 8)).toEqual(PNG_MAGIC);
      expect(slide.png.length).toBeGreaterThan(1000);
      expect(slide.width).toBeGreaterThan(slide.height);
    }, 180_000);

    it('reuses the cache for an unchanged document and misses for a changed one', async () => {
      const warm = await renderPreview({
        format: 'docx',
        document: docx,
        pages: '1',
        dpi: 96,
        getAdapter,
        cacheDir,
      });
      expect(warm.ok).toBe(true);
      if (!warm.ok) return;

      const again = await renderPreview({
        format: 'docx',
        document: docx,
        pages: '1',
        dpi: 96,
        getAdapter,
        cacheDir,
      });
      expect(again.ok).toBe(true);
      if (!again.ok) return;

      expect(again.cache).toMatchObject({ hits: 1, misses: 0 });
      expect(again.pages[0].cached).toBe(true);
      // Nothing was converted: the fast path never launched LibreOffice.
      expect(again.timings.convertMs).toBe(0);
      expect(again.keys.runKey).toBe(warm.keys.runKey);
      expect(again.pages[0].png).toEqual(warm.pages[0].png);

      const edited = JSON.parse(JSON.stringify(docx));
      edited.props.metadata.title = 'Edited for the cache test';
      const changed = await renderPreview({
        format: 'docx',
        document: edited,
        pages: '1',
        dpi: 96,
        getAdapter,
        cacheDir,
      });
      expect(changed.ok).toBe(true);
      if (!changed.ok) return;
      expect(changed.keys.documentKey).not.toBe(warm.keys.documentKey);
      expect(changed.cache.misses).toBe(1);
      expect(changed.pages[0].cached).toBe(false);
    }, 240_000);

    it('renders the same page at a different DPI rather than reusing it', async () => {
      const low = await renderPreview({
        format: 'docx',
        document: docx,
        pages: '1',
        dpi: 96,
        getAdapter,
        cacheDir,
      });
      const high = await renderPreview({
        format: 'docx',
        document: docx,
        pages: '1',
        dpi: 144,
        getAdapter,
        cacheDir,
      });
      expect(low.ok && high.ok).toBe(true);
      if (!low.ok || !high.ok) return;
      expect(high.pages[0].width).toBeGreaterThan(low.pages[0].width);
    }, 240_000);

    it('honours cancellation raised during the render', async () => {
      const controller = new AbortController();
      const pending = renderPreview({
        format: 'docx',
        document: docx,
        pages: 'all',
        dpi: 96,
        getAdapter,
        // No cache: a warm run would finish before the abort lands.
        cacheDir: null,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 50);

      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0].code).toBe(ERROR_CODES.CANCELLED);
    }, 180_000);

    describe('over the protocol', () => {
      let client: Client;

      beforeAll(async () => {
        const deps = createToolDeps({
          outputRoot: createOutputRoot({ flagDir: outDir }),
          serverVersion: '9.9.9-test',
        });
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        client = new Client({ name: 'preview-test', version: '1.0.0' });
        await Promise.all([
          createServer(deps).connect(serverTransport),
          client.connect(clientTransport),
        ]);
      });

      afterAll(async () => {
        await client.close();
      });

      it('advertises jto_preview with its page syntax and fidelity caveat', async () => {
        const { tools } = await client.listTools();
        const preview = tools.find((tool) => tool.name === 'jto_preview');
        expect(preview).toBeDefined();
        expect(preview?.description).toContain('LibreOffice');
        expect(preview?.description).toContain('1-3,7');
        const schema = preview?.inputSchema as {
          properties?: Record<string, { pattern?: string; maximum?: number }>;
        };
        expect(schema.properties?.pages?.pattern).toBeTruthy();
        expect(schema.properties?.dpi?.maximum).toBe(600);
      });

      it('returns image content blocks for a small inline preview', async () => {
        const result = await client.callTool({
          name: 'jto_preview',
          arguments: { format: 'docx', document: docx, pages: '1', dpi: 96 },
        });
        const payload = result.structuredContent as Record<string, any>;

        expect(payload.ok, JSON.stringify(payload)).toBe(true);
        expect(payload.delivery).toBe('images');
        expect(payload.pages).toHaveLength(1);
        expect(payload.pages[0].delivery).toBe('image');
        expect(payload.renderer.fidelity).toBe(PREVIEW_FIDELITY_NOTE);
        expect(payload.renderer.engine).toBe('libreoffice');

        const blocks = result.content as Array<Record<string, any>>;
        expect(blocks[0].type).toBe('text');
        const images = blocks.filter((block) => block.type === 'image');
        expect(images).toHaveLength(1);
        expect(images[0].mimeType).toBe('image/png');
        expect(
          Buffer.from(images[0].data as string, 'base64').subarray(0, 8)
        ).toEqual(PNG_MAGIC);
        // The bytes ride in the content blocks only — never duplicated into
        // structuredContent, which a client would then hold twice.
        expect(JSON.stringify(payload)).not.toContain(
          (images[0].data as string).slice(0, 64)
        );
      }, 180_000);

      it('writes files under the output root when asked for paths', async () => {
        const result = await client.callTool({
          name: 'jto_preview',
          arguments: {
            format: 'docx',
            document: docx,
            pages: '1-2',
            dpi: 96,
            outputMode: 'path',
            filenamePrefix: 'invoice',
          },
        });
        const payload = result.structuredContent as Record<string, any>;

        expect(payload.ok, JSON.stringify(payload)).toBe(true);
        expect(payload.delivery).toBe('paths');
        expect(
          (result.content as Array<Record<string, any>>).some(
            (block) => block.type === 'image'
          )
        ).toBe(false);

        // The output root reports its symlink-resolved identity, which on
        // macOS is /private/var, not the /var mkdtemp handed back.
        const realOut = await fs.realpath(outDir);
        for (const page of payload.pages) {
          expect(page.delivery).toBe('path');
          expect(page.artifact.mode).toBe('path');
          expect(page.artifact.path.startsWith(realOut)).toBe(true);
          const written = await fs.readFile(page.artifact.path);
          expect(written.subarray(0, 8)).toEqual(PNG_MAGIC);
          expect(written.length).toBe(page.artifact.bytes);
        }
        expect(
          payload.pages.map((page: any) => page.artifact.filename)
        ).toEqual(['invoice-p001.png', 'invoice-p002.png']);
      }, 180_000);

      it('refuses an oversized inline request instead of returning it', async () => {
        const result = await client.callTool({
          name: 'jto_preview',
          arguments: {
            format: 'docx',
            document: docx,
            pages: '1-40',
            dpi: 300,
            outputMode: 'images',
          },
        });
        const payload = result.structuredContent as Record<string, any>;

        expect(payload.ok).toBe(false);
        expect(payload.diagnostics[0].code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
        expect(payload.diagnostics[0].suggestion).toContain(
          'outputMode "path"'
        );
        // A refusal, not a protocol error: the agent can still act on it.
        expect(result.isError).toBeFalsy();
      }, 180_000);

      it('turns an out-of-range DPI into a readable result, not a crash', async () => {
        const result = await client.callTool({
          name: 'jto_preview',
          arguments: { format: 'docx', document: docx, dpi: 5000 },
        });
        // Schema violations come back as isError results from the SDK.
        expect(result.isError).toBe(true);
      });

      it('refuses a document source that names neither document nor handle', async () => {
        const result = await client.callTool({
          name: 'jto_preview',
          arguments: { format: 'docx' },
        });
        const payload = result.structuredContent as Record<string, any>;
        expect(payload.ok).toBe(false);
        expect(payload.diagnostics[0].code).toBe(
          ERROR_CODES.DOC_SOURCE_MISSING
        );
      });
    });
  }
);

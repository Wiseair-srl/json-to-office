import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RasterizeFontFace } from '@json-to-office/shared';

// ---------------------------------------------------------------------------
// Stubs. `execFile` stands in for soffice/pdftoppm (the `--version` probe
// always succeeds; conversion behaviour is per-test), and the font stager is
// a spy so we can assert exactly when and how it is invoked.
// ---------------------------------------------------------------------------

const execFileMock = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: unknown[]) => execFileMock(...args),
  };
});

const cleanupSpy = vi.fn(async () => {});
const stageSpy = vi.fn(async () => ({
  envOverrides: { JTO_FONT_PATHS: '/staged/Inter-400r.ttf' },
  cleanup: cleanupSpy,
}));
vi.mock('../font-staging/index.js', () => ({
  getFontStager: () => ({ stage: stageSpy }),
}));

/** Minimal buffer that satisfies the rasterizer's PNG header parser. */
function fakePng(width = 40, height = 20): Buffer {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

const presentation = () => ({
  name: 'pptx',
  props: { slideWidth: 4, slideHeight: 2 },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        { name: 'text', props: { text: 'hi', x: 0.5, y: 0.7, w: 3, h: 0.6 } },
      ],
    },
  ],
});

const face = (
  overrides: Partial<RasterizeFontFace> = {}
): RasterizeFontFace => ({
  family: 'Inter',
  weight: 400,
  italic: false,
  data: Buffer.alloc(32, 7).toString('base64'),
  ...overrides,
});

/** Fresh module instance so memoized binary resolution never leaks between tests. */
async function loadRasterizer() {
  vi.resetModules();
  return import('../pptx-rasterizer.js');
}

/** `--version` probes succeed; everything else defers to `onConvert`. */
function stubExec(onConvert: (binary: string, args: string[]) => Error | null) {
  execFileMock.mockImplementation(
    (binary: string, args: string[], _opts: unknown, cb: any) => {
      if (args.includes('--version')) return cb(null, '', '');
      return cb(onConvert(binary, args), '', '');
    }
  );
}

beforeEach(() => {
  execFileMock.mockReset();
  stageSpy.mockClear();
  cleanupSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

describe('cacheKey font sensitivity', () => {
  it('differs between a request with fonts and the identical request without', async () => {
    const { cacheKey, fontsDigest } = await loadRasterizer();
    const base = { presentation: presentation(), dpi: 200 };
    const withFonts = cacheKey({
      ...base,
      fontsKey: fontsDigest([face()]),
    });
    const without = cacheKey(base);
    expect(withFonts).not.toBe(without);
  });

  it('is identical when the same faces arrive in a different order', async () => {
    const { cacheKey, fontsDigest } = await loadRasterizer();
    const a = face({ weight: 400 });
    const b = face({
      weight: 700,
      data: Buffer.alloc(32, 9).toString('base64'),
    });
    const base = { presentation: presentation(), dpi: 200 };
    expect(cacheKey({ ...base, fontsKey: fontsDigest([a, b]) })).toBe(
      cacheKey({ ...base, fontsKey: fontsDigest([b, a]) })
    );
  });

  it("differs when a face's bytes change but its family/weight/italic do not", async () => {
    const { cacheKey, fontsDigest } = await loadRasterizer();
    const base = { presentation: presentation(), dpi: 200 };
    const original = cacheKey({ ...base, fontsKey: fontsDigest([face()]) });
    const rebuilt = cacheKey({
      ...base,
      fontsKey: fontsDigest([
        face({ data: Buffer.alloc(32, 8).toString('base64') }),
      ]),
    });
    expect(original).not.toBe(rebuilt);
  });

  it('leaves an empty or absent font list keyed exactly like no fonts', async () => {
    const { cacheKey, fontsDigest } = await loadRasterizer();
    expect(fontsDigest([])).toBeUndefined();
    expect(fontsDigest(undefined)).toBeUndefined();
    const base = { presentation: presentation(), dpi: 200 };
    expect(cacheKey({ ...base, fontsKey: fontsDigest([]) })).toBe(
      cacheKey(base)
    );
  });
});

// ---------------------------------------------------------------------------
// Staging lifecycle
// ---------------------------------------------------------------------------

describe('font staging around the soffice launch', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-raster-test-'));
  });
  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  });

  it('does NOT stage when every slide hits the disk cache', async () => {
    const { createLibreOfficePptxRasterizer, cacheKey, fontsDigest } =
      await loadRasterizer();
    const fonts = [face()];
    const key = cacheKey({
      presentation: presentation(),
      dpi: 200,
      baseDir: undefined,
      fontsKey: fontsDigest(fonts),
    });
    await fs.writeFile(path.join(cacheDir, `${key}.png`), fakePng());

    stubExec(() => new Error('soffice must not be launched on a full hit'));
    const rasterize = createLibreOfficePptxRasterizer({ cacheDir });
    const result = await rasterize({
      presentation: presentation(),
      dpi: 200,
      fonts,
    });

    expect(result.width).toBe(40);
    expect(stageSpy).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('stages, then cleans up exactly once, when the soffice exec rejects', async () => {
    const { createLibreOfficePptxRasterizer } = await loadRasterizer();
    stubExec((binary) =>
      binary.includes('pdftoppm') ? null : new Error('soffice exploded')
    );

    const rasterize = createLibreOfficePptxRasterizer({ cacheDir: null });
    await expect(
      rasterize({ presentation: presentation(), dpi: 200, fonts: [face()] })
    ).rejects.toThrow(/LibreOffice failed to convert/);

    expect(stageSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('passes the batch profile plus every retry profile in profileDirs', async () => {
    const { createLibreOfficePptxRasterizer } = await loadRasterizer();
    stubExec(() => new Error('soffice exploded'));

    const rasterize = createLibreOfficePptxRasterizer({ cacheDir: null });
    await rasterize({
      presentation: presentation(),
      dpi: 200,
      fonts: [face()],
    }).catch(() => {});

    expect(stageSpy).toHaveBeenCalledTimes(1);
    const [resolvedFonts, tempDir, options] = stageSpy.mock.calls[0] as any;
    // The wire faces are decoded back into ResolvedFont[] before staging.
    expect(resolvedFonts[0].family).toBe('Inter');
    expect(Buffer.isBuffer(resolvedFonts[0].sources[0].data)).toBe(true);
    expect(options.profileDirs).toEqual([
      path.join(tempDir, 'profile'),
      path.join(tempDir, 'profile-retry-0'),
      path.join(tempDir, 'profile-retry-1'),
      path.join(tempDir, 'profile-retry-2'),
    ]);
  });

  it('merges the stager env into the soffice launch but not the pdftoppm one', async () => {
    const { createLibreOfficePptxRasterizer } = await loadRasterizer();
    const seen: Array<{ binary: string; env: Record<string, string> }> = [];
    execFileMock.mockImplementation(
      (binary: string, args: string[], opts: any, cb: any) => {
        if (args.includes('--version')) return cb(null, '', '');
        seen.push({ binary, env: opts.env });
        return cb(new Error('stop here'), '', '');
      }
    );

    const rasterize = createLibreOfficePptxRasterizer({ cacheDir: null });
    await rasterize({
      presentation: presentation(),
      dpi: 200,
      fonts: [face()],
    }).catch(() => {});

    expect(seen.length).toBeGreaterThan(0);
    const soffice = seen.find((s) => !s.binary.includes('pdftoppm'));
    expect(soffice?.env.JTO_FONT_PATHS).toBe('/staged/Inter-400r.ttf');
  });

  it('does not stage at all when the request carries no fonts', async () => {
    const { createLibreOfficePptxRasterizer } = await loadRasterizer();
    stubExec(() => new Error('soffice exploded'));

    const rasterize = createLibreOfficePptxRasterizer({ cacheDir: null });
    await rasterize({ presentation: presentation(), dpi: 200 }).catch(() => {});

    expect(stageSpy).not.toHaveBeenCalled();
    expect(cleanupSpy).not.toHaveBeenCalled();
  });
});

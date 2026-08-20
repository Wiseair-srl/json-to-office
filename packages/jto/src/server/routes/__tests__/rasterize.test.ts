import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Hono } from 'hono';
import { createFormatRouter } from '../format';
import { Container } from '../../container';
import { PptxFormatAdapter } from '@json-to-office/jto-cli';
import { MAX_RASTERIZE_FONTS } from '@json-to-office/shared';
import { registerRasterizeRoute } from '../../rasterize-route';

async function post(app: Hono, url: string, body: unknown) {
  const bodyStr = JSON.stringify(body);
  return app.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyStr)),
    },
    body: bodyStr,
  });
}

function onPath(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_BINARIES =
  (existsSync('/Applications/LibreOffice.app/Contents/MacOS/soffice') ||
    onPath('soffice') ||
    onPath('libreoffice')) &&
  onPath('pdftoppm');

const slide = () => ({
  name: 'pptx',
  props: { slideWidth: 4, slideHeight: 2 },
  children: [
    {
      name: 'slide',
      props: { background: { color: 'EEEEEE' } },
      children: [
        { name: 'text', props: { text: 'hi', x: 0.5, y: 0.7, w: 3, h: 0.6 } },
      ],
    },
  ],
});

describe('/api/pptx/rasterize', () => {
  let app: Hono;

  beforeAll(() => {
    Container.initialize(new PptxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new PptxFormatAdapter()) as any);
  });

  it('rejects a body without a presentation (400)', async () => {
    const res = await post(app, '/rasterize', { dpi: 120 });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range dpi (400)', async () => {
    const res = await post(app, '/rasterize', {
      presentation: slide(),
      dpi: 5,
    });
    expect(res.status).toBe(400);
  });

  it.skipIf(!HAS_BINARIES)(
    'rasterizes a single-slide presentation to a PNG (200)',
    async () => {
      const res = await post(app, '/rasterize', {
        presentation: slide(),
        dpi: 120,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        base64DataUri: string;
        width: number;
        height: number;
      };
      expect(body.base64DataUri).toMatch(/^data:image\/png;base64,/);
      // 4in × 2in at 120 dpi → 480 × 240 px
      expect(body.width).toBe(480);
      expect(body.height).toBe(240);
    },
    30000
  );
});

describe('/api/pptx/rasterize/batch', () => {
  let app: Hono;

  beforeAll(() => {
    Container.initialize(new PptxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new PptxFormatAdapter()) as any);
  });

  it('rejects an empty slides array (400)', async () => {
    const res = await post(app, '/rasterize/batch', { slides: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a batch above MAX_RASTERIZE_BATCH_SLIDES (400)', async () => {
    const res = await post(app, '/rasterize/batch', {
      slides: Array.from({ length: 33 }, () => ({ presentation: slide() })),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a slide with an out-of-range dpi (400)', async () => {
    const res = await post(app, '/rasterize/batch', {
      slides: [{ presentation: slide(), dpi: 5 }],
    });
    expect(res.status).toBe(400);
  });

  it.skipIf(!HAS_BINARIES)(
    'rasterizes independent slides (own sizes and dpi) in order, in one request',
    async () => {
      const wide = {
        ...slide(),
        props: { slideWidth: 6, slideHeight: 3 },
      };
      const res = await post(app, '/rasterize/batch', {
        slides: [
          { presentation: slide(), dpi: 120 },
          { presentation: wide, dpi: 96 },
        ],
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: Array<
          | { ok: true; base64DataUri: string; width: number; height: number }
          | { ok: false; error: string }
        >;
      };
      expect(body.results).toHaveLength(2);
      const [first, second] = body.results;
      // 4in × 2in @120dpi → 480 × 240; 6in × 3in @96dpi → 576 × 288.
      expect(first).toMatchObject({ ok: true, width: 480, height: 240 });
      expect(second).toMatchObject({ ok: true, width: 576, height: 288 });
    },
    60000
  );

  it.skipIf(!HAS_BINARIES)(
    'reports a broken slide per-item without failing its siblings',
    async () => {
      const res = await post(app, '/rasterize/batch', {
        slides: [
          { presentation: slide(), dpi: 96 },
          // Invalid pptx definition: the builder rejects it per-slide.
          { presentation: { name: 'not-pptx' } },
        ],
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: Array<{ ok: boolean; error?: string }>;
      };
      expect(body.results[0].ok).toBe(true);
      expect(body.results[1].ok).toBe(false);
      expect(body.results[1].error).toBeTruthy();
    },
    60000
  );
});

// ---------------------------------------------------------------------------
// Font payload (Area 6). These mount the shared route registrar directly with
// injected rasterizers so they assert validation + forwarding without needing
// LibreOffice on the box.
// ---------------------------------------------------------------------------

describe('rasterize font payload', () => {
  const pngResult = {
    base64DataUri: 'data:image/png;base64,AAAA',
    width: 10,
    height: 10,
  };

  function appWithSpies() {
    const single = vi.fn(async () => pngResult);
    const batch = vi.fn(async (req: { slides: unknown[] }) => ({
      results: req.slides.map(() => ({ ok: true as const, ...pngResult })),
    }));
    const router = new Hono();
    registerRasterizeRoute(router, {
      getRasterizer: () => single as any,
      getBatchRasterizer: () => batch as any,
    });
    return { app: router, single, batch };
  }

  const aFace = (overrides: Record<string, unknown> = {}) => ({
    family: 'Inter',
    weight: 400,
    italic: false,
    data: Buffer.alloc(64, 1).toString('base64'),
    ...overrides,
  });

  it('forwards a top-level fonts array to the single rasterizer verbatim', async () => {
    const { app: a, single } = appWithSpies();
    const fonts = [aFace(), aFace({ weight: 700, italic: true })];
    const res = await post(a, '/rasterize', {
      presentation: slide(),
      dpi: 96,
      fonts,
    });
    expect(res.status).toBe(200);
    expect(single).toHaveBeenCalledTimes(1);
    expect((single.mock.calls[0] as any)[0].fonts).toEqual(fonts);
  });

  it('forwards a top-level fonts array to the batch rasterizer verbatim', async () => {
    const { app: a, batch } = appWithSpies();
    const fonts = [aFace()];
    const res = await post(a, '/rasterize/batch', {
      slides: [{ presentation: slide(), dpi: 96 }],
      fonts,
    });
    expect(res.status).toBe(200);
    expect((batch.mock.calls[0] as any)[0].fonts).toEqual(fonts);
  });

  it('reaches the rasterizer with NO fonts key when the request omits fonts', async () => {
    // Guards the cache-key equivalence: a fontless request must produce the
    // exact same engine input it did before fonts existed.
    const { app: a, single } = appWithSpies();
    await post(a, '/rasterize', { presentation: slide(), dpi: 96 });
    expect((single.mock.calls[0] as any)[0]).not.toHaveProperty('fonts');
  });

  it('rejects fonts nested inside a batch SLIDE object (400)', async () => {
    const { app: a } = appWithSpies();
    const res = await post(a, '/rasterize/batch', {
      slides: [{ presentation: slide(), dpi: 96, fonts: [aFace()] }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown key inside a font face (400)', async () => {
    const { app: a } = appWithSpies();
    const res = await post(a, '/rasterize', {
      presentation: slide(),
      fonts: [aFace({ path: '/etc/passwd' })],
    });
    expect(res.status).toBe(400);
  });

  it('rejects more than MAX_RASTERIZE_FONTS faces (400)', async () => {
    const { app: a } = appWithSpies();
    const res = await post(a, '/rasterize', {
      presentation: slide(),
      fonts: Array.from({ length: MAX_RASTERIZE_FONTS + 1 }, () => aFace()),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a font payload above MAX_RASTERIZE_FONT_BYTES (400)', async () => {
    const { app: a } = appWithSpies();
    // Each face is just under the per-face schema cap; four of them clear
    // the 8 MiB decoded budget without tripping the 32 MiB body limit first.
    const big = 'A'.repeat(3 * 1024 * 1024);
    const res = await post(a, '/rasterize', {
      presentation: slide(),
      fonts: Array.from({ length: 4 }, () => aFace({ data: big })),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('font payload is too large');
  });

  it('rejects a malformed face (missing italic) (400)', async () => {
    const { app: a } = appWithSpies();
    const res = await post(a, '/rasterize', {
      presentation: slide(),
      fonts: [{ family: 'Inter', weight: 400, data: 'AA==' }],
    });
    expect(res.status).toBe(400);
  });
});

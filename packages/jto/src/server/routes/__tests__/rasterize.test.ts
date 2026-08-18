import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Hono } from 'hono';
import { createFormatRouter } from '../format';
import { Container } from '../../container';
import { PptxFormatAdapter } from '@json-to-office/jto-cli';

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

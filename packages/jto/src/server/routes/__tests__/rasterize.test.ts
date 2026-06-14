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

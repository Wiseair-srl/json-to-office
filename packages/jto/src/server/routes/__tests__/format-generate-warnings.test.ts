/**
 * End-to-end proof that core font warnings reach the playground envelope —
 * on the first render AND on the cached second one. Before the sink existed,
 * `warnings` was always `[]` here; before the cache stored them, it was `[]`
 * again the moment the same document was rendered twice.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createFormatRouter } from '../format';
import { Container } from '../../container';
import { DocxFormatAdapter } from '@json-to-office/jto-cli';

// Hono's body-limit middleware reads Content-Length; tests must set it.
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

// Absent from POPULAR_GOOGLE_FONTS, so no auto-Google entry is built and the
// request actually takes the cache path.
const UNKNOWN_FAMILY = 'Acme Brand Sans';

const docWithUnknownFont = {
  name: 'docx',
  props: { theme: 'minimal', metadata: { title: 'route-warnings' } },
  children: [
    {
      name: 'paragraph',
      props: { text: 'Body.', font: { family: UNKNOWN_FAMILY } },
    },
  ],
};

interface GenerateEnvelope {
  success: boolean;
  cache: { status: 'HIT' | 'MISS' };
  warnings: {
    component: string;
    message: string;
    severity?: string;
    context?: Record<string, unknown>;
  }[];
}

describe('/api/docx/generate warnings', () => {
  let app: Hono;

  beforeAll(() => {
    Container.initialize(new DocxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new DocxFormatAdapter()) as any);
  });

  it('surfaces core font warnings on a cache MISS and keeps them on the HIT', async () => {
    const first = await post(app, '/generate', {
      jsonDefinition: docWithUnknownFont,
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as GenerateEnvelope;

    expect(firstBody.cache.status).toBe('MISS');
    expect(firstBody.warnings.length).toBeGreaterThan(0);
    for (const w of firstBody.warnings) {
      expect(typeof w.component).toBe('string');
      expect(w.component.length).toBeGreaterThan(0);
      expect(typeof w.message).toBe('string');
      expect(['warning', 'info']).toContain(w.severity);
    }
    expect(
      firstBody.warnings.some(
        (w) =>
          w.context?.code === 'FONT_UNRESOLVED' &&
          w.message.includes(UNKNOWN_FAMILY)
      )
    ).toBe(true);

    const second = await post(app, '/generate', {
      jsonDefinition: docWithUnknownFont,
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as GenerateEnvelope;

    expect(secondBody.cache.status).toBe('HIT');
    expect(secondBody.warnings).toEqual(firstBody.warnings);
  });
});

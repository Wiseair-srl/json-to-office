/**
 * Backend selection over the playground's HTTP surface.
 *
 * Three things have to hold for the picker to mean anything: the server says
 * which backends it has rather than the client guessing, a chosen backend
 * actually reaches the compiler, and the cache does not hand back the other
 * one's bytes. The last is the easiest to get wrong and the hardest to notice —
 * a document that looks unchanged after switching backends looks like the
 * switch did nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createAPIApp } from '../../app';
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

const document = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { level: 1, text: 'Backend' } },
    { name: 'paragraph', props: { text: 'Same document, either backend.' } },
  ],
};

/** A threaded comment, which the office-open backend does not declare. */
const threaded = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'paragraph',
      props: {
        text: 'Commented.',
        comment: {
          text: 'Parent',
          author: 'A',
          replies: [{ text: 'Reply', author: 'B' }],
        },
      },
    },
  ],
};

interface GenerateEnvelope {
  success: boolean;
  data: { document: string };
  cache: { status: 'HIT' | 'MISS' };
}

describe('/api/docx/renderers', () => {
  let app: Hono;

  beforeAll(() => {
    // The whole app, not just the router: the `{success, error}` envelope a
    // failure arrives in is applied by the app's error handler, and asserting
    // on a bare router would check a shape the client never sees.
    app = createAPIApp(new DocxFormatAdapter()) as unknown as Hono;
  });

  it('lists the backends the core registers, default first', async () => {
    const response = await app.request('/api/docx/renderers');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      data: { ids: string[]; default: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.ids).toEqual(['docxjs', 'office-open']);
    expect(body.data.default).toBe('docxjs');
  });

  it('renders through the backend the request names', async () => {
    const viaDefault = await post(app, '/api/docx/generate', {
      jsonDefinition: document,
      options: { renderer: 'docxjs' },
    });
    const viaOfficeOpen = await post(app, '/api/docx/generate', {
      jsonDefinition: document,
      options: { renderer: 'office-open' },
    });

    expect(viaDefault.status).toBe(200);
    expect(viaOfficeOpen.status).toBe(200);
    const a = (await viaDefault.json()) as GenerateEnvelope;
    const b = (await viaOfficeOpen.json()) as GenerateEnvelope;

    // Both are documents, and they are not the same document.
    expect(a.data.document.length).toBeGreaterThan(0);
    expect(b.data.document).not.toBe(a.data.document);
  }, 30_000);

  it('caches each backend separately', async () => {
    const send = (renderer: string) =>
      post(app, '/api/docx/generate', {
        jsonDefinition: document,
        options: { renderer },
      });

    // Warm both, then ask for each again: a shared key would make the second
    // backend's first request a HIT carrying the first backend's bytes.
    const firstDocxjs = (await (
      await send('docxjs')
    ).json()) as GenerateEnvelope;
    const firstOfficeOpen = (await (
      await send('office-open')
    ).json()) as GenerateEnvelope;
    const againDocxjs = (await (
      await send('docxjs')
    ).json()) as GenerateEnvelope;

    expect(againDocxjs.cache.status).toBe('HIT');
    expect(againDocxjs.data.document).toBe(firstDocxjs.data.document);
    expect(firstOfficeOpen.data.document).not.toBe(firstDocxjs.data.document);
  }, 30_000);

  it('answers a capability refusal with 400 and the feature name', async () => {
    const response = await post(app, '/api/docx/generate', {
      jsonDefinition: threaded,
      options: { renderer: 'office-open' },
    });

    // Not a 500: the document asked for something this backend cannot do, and
    // the message has to say which feature and where.
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('comment-threads');
    expect(body.error).toContain('sections[0].children[0]');
  }, 30_000);

  it('renders that same document on the default backend', async () => {
    const response = await post(app, '/api/docx/generate', {
      jsonDefinition: threaded,
    });

    expect(response.status).toBe(200);
  }, 30_000);
});

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
import { PptxFormatAdapter } from '@json-to-office/jto-cli';

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
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);

  it('renders that same document on the default backend', async () => {
    const response = await post(app, '/api/docx/generate', {
      jsonDefinition: threaded,
    });

    expect(response.status).toBe(200);
  }, 60_000);

  it('answers an unregistered backend with 400 and the ids that exist', async () => {
    const response = await post(app, '/api/docx/generate', {
      jsonDefinition: document,
      options: { renderer: 'nope' },
    });

    // Naming a backend that does not exist is bad input, not the service
    // falling over — a 500 here told clients to retry something that can only
    // fail again (#263).
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('"nope"');
    expect(body.error).toContain('"docxjs"');
    expect(body.error).toContain('"office-open"');
  }, 60_000);

  it('returns evidence-rich quality gate failures as client errors', async () => {
    const skippedHeading = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'heading', props: { level: 1, text: 'One' } },
        { name: 'heading', props: { level: 3, text: 'Deep' } },
      ],
    };
    const quality = { policy: { gate: 'info' } };

    const response = await post(app, '/api/docx/generate', {
      jsonDefinition: skippedHeading,
      options: { quality },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, any>;
    expect(body).toMatchObject({
      success: false,
      code: 'QUALITY_GATE_FAILED',
      quality: { blocked: true },
    });
    expect(body.quality.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_QUALITY_HEADING_SKIP',
        blocking: true,
        certainty: 'deterministic',
      })
    );

    const validation = await post(app, '/api/docx/validate', {
      jsonDefinition: skippedHeading,
      options: { quality },
    });
    const validationBody = (await validation.json()) as Record<string, any>;
    expect(validationBody).toMatchObject({
      success: false,
      data: {
        valid: false,
        qualityAnalysis: { blocked: true },
      },
    });
  }, 60_000);

  it('rejects a profile targeting another renderer', async () => {
    const quality = {
      profile: {
        id: 'office-open-only',
        formats: ['docx'],
        rendererTargets: ['office-open'],
      },
    };
    const generation = await post(app, '/api/docx/generate', {
      jsonDefinition: document,
      options: { renderer: 'docxjs', quality },
    });
    const validation = await post(app, '/api/docx/validate', {
      jsonDefinition: document,
      options: { renderer: 'docxjs', quality },
    });

    expect(generation.status).toBe(400);
    expect(validation.status).toBe(400);
    expect((await generation.json()) as Record<string, unknown>).toMatchObject({
      success: false,
      error: expect.stringContaining('does not support renderer'),
    });
    expect((await validation.json()) as Record<string, unknown>).toMatchObject({
      success: false,
      error: expect.stringContaining('does not support renderer'),
    });
  });

  it('rejects a policy whose gate it cannot read', async () => {
    // `policy` crosses the wire as a free-form object, so a typo'd gate meets
    // a parser for the first time once analysis starts. It used to be ignored
    // there, leaving gating quietly off for a request that asked for it — and
    // once the parser started throwing, an unmapped code would have made the
    // caller's typo read as a server fault.
    const quality = { policy: { gate: 'warn' } };
    const generation = await post(app, '/api/docx/generate', {
      jsonDefinition: document,
      options: { quality },
    });
    const validation = await post(app, '/api/docx/validate', {
      jsonDefinition: document,
      options: { quality },
    });

    expect(generation.status).toBe(400);
    expect(validation.status).toBe(400);
    // The message names the value and the ones that would have worked;
    // without it the client is told "400" and left to guess which key.
    expect((await generation.json()) as Record<string, unknown>).toMatchObject({
      success: false,
      code: 'CLIENT_ERROR',
      error: expect.stringContaining('invalid gate "warn"'),
    });
    expect((await validation.json()) as Record<string, unknown>).toMatchObject({
      success: false,
      code: 'CLIENT_ERROR',
      error: expect.stringContaining('invalid gate "warn"'),
    });
  });
});

describe('/api/pptx/generate renderer validation', () => {
  it('answers an unregistered backend with 400 and the PPTX ids', async () => {
    const app = createAPIApp(new PptxFormatAdapter()) as unknown as Hono;
    const response = await post(app, '/api/pptx/generate', {
      jsonDefinition: {
        name: 'pptx',
        props: { title: 'Renderer' },
        children: [{ name: 'slide', props: {}, children: [] }],
      },
      options: { renderer: 'nope' },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('"nope"');
    expect(body.error).toContain('"pptxgenjs"');
    expect(body.error).toContain('"office-open"');
  }, 60_000);
});

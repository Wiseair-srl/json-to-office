/**
 * The preview regenerates the document, so it has to use the chosen backend.
 *
 * The from-json preview takes JSON rather than the already-generated file and
 * builds it again server-side, which is what lets resolved fonts reach the
 * LibreOffice stager. It also meant the preview ignored the backend picker: the
 * PDF on screen came from the default renderer while the download came from the
 * selected one, and a capability refusal was invisible until you downloaded
 * (#255).
 *
 * These assertions stop before LibreOffice runs — generation is the half under
 * test, and a refusal never reaches the converter — so they hold on a machine
 * with no LibreOffice installed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createAPIApp } from '../../app';
import { DocxFormatAdapter } from '@json-to-office/jto-cli';

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

const PREVIEW = '/api/docx/preview/libreoffice-from-json';

describe('from-json preview backend selection', () => {
  let app: Hono;

  beforeAll(() => {
    app = createAPIApp(new DocxFormatAdapter()) as unknown as Hono;
  });

  it('generates through the backend the request names', async () => {
    const response = await post(app, PREVIEW, {
      jsonDefinition: threaded,
      options: { renderer: 'office-open' },
    });

    // The refusal is the proof the renderer reached generation: the default
    // backend renders this document happily, so a 400 naming the feature can
    // only have come from office-open.
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('comment-threads');
    expect(body.error).toContain('sections[0].children[0]');
  }, 60_000);

  it('rejects a backend nobody registered', async () => {
    const response = await post(app, PREVIEW, {
      jsonDefinition: threaded,
      options: { renderer: 'nope' },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('"nope"');
    expect(body.error).toContain('"docxjs"');
  }, 60_000);

  it('does not refuse the same document on the default backend', async () => {
    const response = await post(app, PREVIEW, {
      jsonDefinition: threaded,
      options: { renderer: 'docxjs' },
    });

    // Generation succeeds; whether the conversion does depends on whether
    // LibreOffice is installed, which is not what this file is about.
    expect(response.status).not.toBe(400);
  }, 60_000);
});

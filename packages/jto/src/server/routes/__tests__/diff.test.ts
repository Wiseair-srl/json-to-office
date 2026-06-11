import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createFormatRouter } from '../format';
import { Container } from '../../container';
import { DocxFormatAdapter, PptxFormatAdapter } from '@json-to-office/jto-cli';

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

const docOf = (text: string) => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'paragraph', props: { text } }],
});

describe('/api/docx/diff', () => {
  let app: Hono;

  beforeAll(() => {
    Container.initialize(new DocxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new DocxFormatAdapter()) as any);
  });

  it('returns redline document and summary', async () => {
    const res = await post(app, '/diff', {
      oldDefinition: docOf('The fee is 10%.'),
      newDefinition: docOf('The fee is 12%.'),
      options: { author: 'test-suite' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.document.props.trackRevisions).toBe(true);
    expect(body.data.summary.tracked.modified).toBe(1);
    const revision = body.data.document.children[0].props.revision;
    expect(revision.author).toBe('test-suite');
    expect(revision.segments.some((s: any) => s.type === 'delete')).toBe(true);
  });

  it('accepts string definitions', async () => {
    const res = await post(app, '/diff', {
      oldDefinition: JSON.stringify(docOf('a')),
      newDefinition: JSON.stringify(docOf('b')),
    });
    expect(res.status).toBe(200);
  });

  it('rejects invalid documents with 400 and validation errors', async () => {
    const res = await post(app, '/diff', {
      oldDefinition: { name: 'docx', props: {}, children: [{ name: 'nope' }] },
      newDefinition: docOf('b'),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Old document');
  });

  it('rejects malformed JSON strings with 400', async () => {
    const res = await post(app, '/diff', {
      oldDefinition: '{not json',
      newDefinition: docOf('b'),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid date with 400', async () => {
    const res = await post(app, '/diff', {
      oldDefinition: docOf('a'),
      newDefinition: docOf('b'),
      options: { date: 'garbage' },
    });
    expect(res.status).toBe(400);
  });
});

describe('/api/pptx/diff', () => {
  it('is not mounted for pptx', async () => {
    Container.initialize(new PptxFormatAdapter());
    const app = new Hono();
    app.route('/', createFormatRouter(new PptxFormatAdapter()) as any);
    const res = await post(app, '/diff', {
      oldDefinition: {},
      newDefinition: {},
    });
    expect(res.status).toBe(404);
  });
});

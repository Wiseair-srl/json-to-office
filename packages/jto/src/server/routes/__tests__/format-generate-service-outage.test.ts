/**
 * A chart needs the Highcharts export server. When nothing is listening, the
 * playground used to answer "Internal server error during document
 * generation" while the log carried the one line that says how to fix it.
 * The outage is a 503 with that line.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createFormatRouter } from '../format';
import { Container } from '../../container';
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

/** A port nothing listens on, so the request fails at connect. */
const NOBODY = 'http://127.0.0.1:1';

const chartDocument = {
  name: 'docx',
  props: { theme: 'minimal', metadata: { title: 'outage' } },
  children: [
    {
      name: 'highcharts',
      props: {
        width: '100%',
        options: {
          chart: { type: 'column', width: 600, height: 300 },
          xAxis: { categories: ['Q1'] },
          series: [{ name: 'Revenue (€m)', data: [1] }],
        },
      },
    },
  ],
};

describe('/api/docx/generate without the export server', () => {
  let app: Hono;
  const previous = process.env.HIGHCHARTS_SERVER_URL;
  beforeAll(() => {
    // Both routes to the adapter: the environment the server reads, and the
    // request option a caller may pass.
    process.env.HIGHCHARTS_SERVER_URL = NOBODY;
    Container.initialize(new DocxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new DocxFormatAdapter()) as any);
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.HIGHCHARTS_SERVER_URL;
    else process.env.HIGHCHARTS_SERVER_URL = previous;
  });

  it('answers 503 with the line that says how to start it', async () => {
    const res = await post(app, '/generate', {
      jsonDefinition: chartDocument,
      options: { services: { highcharts: { url: NOBODY } } },
    });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('Highcharts Export Server is not running');
    expect(text).toContain('npx highcharts-export-server --enableServer true');
  });
});

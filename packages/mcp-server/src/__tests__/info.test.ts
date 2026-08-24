/**
 * `jto_info`'s dependency probe, which is the only warning an agent gets before
 * it authors something this host cannot render.
 *
 * The binaries have their own suite (`preview-dependencies.test.ts`); what is
 * asserted here is the chart export service, which gates a COMPONENT rather
 * than a tool and so was invisible: a DOCX with two `highcharts` nodes
 * validated clean, then failed at generation against a service nothing had
 * mentioned.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { highchartsServerUrl, probeService } from '../tools/info.js';

let client: Client;

async function info(args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name: 'jto_info', arguments: args });
  return result.structuredContent as any;
}

beforeAll(async () => {
  const server = createServer(createToolDeps({ serverVersion: '9.9.9-test' }));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'info-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('jto_info dependencies', () => {
  it('reports the Highcharts export server it would actually post to', async () => {
    const reported = (await info()).previewDependencies.highchartsExportServer;

    expect(typeof reported.available).toBe('boolean');
    expect(reported.envVar).toBe('HIGHCHARTS_SERVER_URL');
    expect(reported.url).toBe(new URL(highchartsServerUrl()).origin);
    if (!reported.available) expect(typeof reported.detail).toBe('string');
  });

  it('says so in the diagnostics when nothing is listening', async () => {
    const result = await info();
    const chart = result.previewDependencies.highchartsExportServer;
    const named = result.diagnostics.filter((entry: any) =>
      String(entry.message).includes('Highcharts')
    );

    if (chart.available) {
      expect(named).toEqual([]);
      return;
    }
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({
      severity: 'info',
      code: 'E_DEPENDENCY_MISSING',
      context: { component: 'highcharts' },
    });
    // The two things an agent can do about it: start one, or use `visual`.
    expect(named[0].suggestion).toContain('highcharts-export-server');
    expect(named[0].suggestion).toContain('visual');
  });

  it('skips the probe with the dependencies', async () => {
    const skipped = await info({ includePreviewDependencies: false });
    expect(skipped.previewDependencies).toBeUndefined();
  });

  it('calls a port nothing listens on absent rather than throwing', async () => {
    // Port 1 on the loopback is refused instantly on every platform we run on.
    const status = await probeService('http://127.0.0.1:1', 'IRRELEVANT');
    expect(status.available).toBe(false);
    expect(status.url).toBe('http://127.0.0.1:1');
    expect(status.detail).toBeTruthy();
  });

  it('treats an unparseable serverUrl as absent, not as a crash', async () => {
    const status = await probeService('http://', 'IRRELEVANT');
    expect(status.available).toBe(false);
    expect(status.detail).toBeTruthy();
  });
});

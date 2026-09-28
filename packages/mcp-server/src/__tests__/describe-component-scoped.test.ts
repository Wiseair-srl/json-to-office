/**
 * `jto_describe_component` for a component one renderer cannot draw.
 *
 * No shipped component is scoped to one renderer any more — the docx `chart`
 * was the last, until docx.js learned to draw it (#478) — but the registry's
 * `renderers` mechanism stays, and so does the answer the tool gives for it:
 * not "unknown", but which renderer does draw it. The docx.js profile here is
 * built without `chart`, which is exactly what a scoped component looks like
 * to the tool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';

// Hoisted above the imports by vitest, so the server's tools see it.
vi.mock('../tools/discover.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../tools/discover.js')>();
  return {
    ...original,
    formatSchemas: (format: Parameters<typeof original.formatSchemas>[0]) => {
      const schemas = original.formatSchemas(format);
      if (format !== 'docx') return schemas;
      return {
        ...schemas,
        profiles: schemas.profiles.map((profile) =>
          profile.id === 'docxjs'
            ? {
                ...profile,
                components: new Map(
                  [...profile.components].filter(([name]) => name !== 'chart')
                ),
              }
            : profile
        ),
      };
    },
  };
});

let client: Client;

interface DescribeResult {
  ok: boolean;
  diagnostics: Array<{ code: string; message: string; suggestion?: string }>;
}

async function describeComponent(args: Record<string, unknown>) {
  const result = await client.callTool({
    name: 'jto_describe_component',
    arguments: args,
  });
  return result.structuredContent as unknown as DescribeResult;
}

beforeAll(async () => {
  const server = createServer(createToolDeps({ serverVersion: '9.9.9-test' }));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('jto_describe_component, renderer-scoped', () => {
  it('says which renderer supports a component the asked-for one does not', async () => {
    const result = await describeComponent({
      format: 'docx',
      name: 'chart',
      renderer: 'docxjs',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('E_UNKNOWN_COMPONENT');
    expect(result.diagnostics[0]?.suggestion).toContain('office-open');
  });
});

/**
 * `jto_preview`'s option checks, which answer before anything is rendered.
 *
 * Kept apart from `preview-render.test.ts` because none of this needs
 * LibreOffice: the whole point is that a bad option is refused before a
 * converter is ever reached, so these run on a bare host.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';

const DOCX = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'paragraph', props: { text: 'Hello.' } }],
};

let client: Client;

beforeAll(async () => {
  const server = createServer(createToolDeps({ serverVersion: '9.9.9-test' }));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'preview-options-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('jto_preview options', () => {
  // It used to forward the value into the core, which raised a RangeError deep
  // in packaging; `guarded` could only call that E_INTERNAL — "always a bug
  // here, never the caller's" — and hand back a stack trace.
  it('refuses a generatedAt it cannot parse, in the same words as generate', async () => {
    const result = await client.callTool({
      name: 'jto_preview',
      arguments: { format: 'docx', document: DOCX, generatedAt: 'yesterday' },
    });
    const structured = result.structuredContent as any;

    expect(result.isError).toBeFalsy();
    expect(structured.ok).toBe(false);
    expect(structured.diagnostics[0]).toMatchObject({
      code: 'E_INVALID_DATE',
      context: { option: 'generatedAt', value: 'yesterday' },
    });
    expect(structured.diagnostics[0].context.stack).toBeUndefined();
  });

  it('takes the same diagnostic budget jto_validate and jto_generate take', async () => {
    const tools = (await client.listTools()).tools as unknown as Array<{
      name: string;
      inputSchema: { properties?: Record<string, unknown> };
    }>;
    const capped = tools
      .filter((tool) => tool.inputSchema.properties?.maxDiagnostics)
      .map((tool) => tool.name)
      .sort();

    expect(capped).toEqual(['jto_generate', 'jto_preview', 'jto_validate']);
  });

  it('refuses an unknown renderer before probing host dependencies', async () => {
    const result = await client.callTool({
      name: 'jto_preview',
      arguments: { format: 'docx', document: DOCX, renderer: 'nope' },
    });
    const structured = result.structuredContent as any;

    expect(result.isError).toBeFalsy();
    expect(structured.ok).toBe(false);
    expect(structured.diagnostics[0]).toMatchObject({
      code: 'E_UNKNOWN_RENDERER',
      context: { rendererIds: expect.any(Array) },
    });
  });

  it('rejects executable theme modules before rendering', async () => {
    const result = await client.callTool({
      name: 'jto_preview',
      arguments: { format: 'docx', document: DOCX, themePath: 'theme.mjs' },
    });
    const structured = result.structuredContent as any;

    expect(result.isError).toBeFalsy();
    expect(structured.ok).toBe(false);
    expect(structured.diagnostics[0].code).toBe('E_INVALID_THEME_PATH');
  });
});

/**
 * Protocol-level coverage over a linked in-memory transport.
 *
 * Complements `stdio.test.ts`: this one needs no build, so the tool surface
 * and `jto_info`'s contract stay covered on a cold checkout, while the stdio
 * suite proves the framing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer, SERVER_INSTRUCTIONS } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';

let scratch: string;
let client: Client;

async function connect(): Promise<Client> {
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
  });
  const server = createServer(deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    connected.connect(clientTransport),
  ]);
  return connected;
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-test-'));
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('advertises jto_info with a JSON Schema the SDK will enforce', async () => {
    const { tools } = await client.listTools();
    const info = tools.find((tool) => tool.name === 'jto_info');
    expect(info).toBeDefined();
    expect(info?.inputSchema.type).toBe('object');
    expect(info?.outputSchema?.type).toBe('object');
    expect(
      (info?.outputSchema as { required?: string[] } | undefined)?.required
    ).toEqual(expect.arrayContaining(['ok', 'diagnostics']));
  });

  // Pinned as an exact ordered list, not a subset: `tools/list` order is the
  // order an agent reads the surface in, and a tool that silently stops
  // registering is exactly the regression a `toContain` check would miss.
  it('registers every tool, in the order server.ts wires them', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'jto_info',
      'jto_discover',
      'jto_describe_component',
      'jto_validate',
      'jto_generate',
      'jto_preview',
      'jto_docx_diff',
      'jto_workspace_create',
      'jto_workspace_inspect',
      'jto_workspace_patch',
      'jto_workspace_snapshot',
      'jto_workspace_list',
      'jto_workspace_close',
    ]);
  });

  // The four document-taking tools are the ones #271 requires to accept a
  // workspace reference wherever they accept inline JSON. `jto_docx_diff`
  // nests the pair per side, since it takes two documents.
  it('offers every document-taking tool both a document and a handle', async () => {
    const { tools } = await client.listTools();
    const properties = (name: string): Record<string, unknown> => {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as {
        properties?: Record<string, unknown>;
      };
      return schema?.properties ?? {};
    };

    for (const name of ['jto_validate', 'jto_generate', 'jto_preview']) {
      expect(Object.keys(properties(name))).toEqual(
        expect.arrayContaining(['document', 'handle', 'revision'])
      );
    }

    for (const side of ['before', 'after']) {
      const bag = properties('jto_docx_diff')[side] as {
        properties?: Record<string, unknown>;
      };
      expect(Object.keys(bag.properties ?? {})).toEqual(
        expect.arrayContaining(['document', 'handle', 'revision'])
      );
    }
  });
});

describe('jto_info', () => {
  it('reports versions, formats, renderers and the output root', async () => {
    const result = await client.callTool({ name: 'jto_info', arguments: {} });
    const info = result.structuredContent as Record<string, any>;

    expect(info.ok).toBe(true);
    expect(info.diagnostics).toBeInstanceOf(Array);
    expect(info.server).toMatchObject({
      name: 'json-to-office',
      package: '@json-to-office/mcp-server',
      version: '9.9.9-test',
      protocolTransport: 'stdio',
    });
    expect(info.runtime.node).toBe(process.versions.node);
    for (const name of [
      '@json-to-office/jto-ops',
      '@json-to-office/shared',
      '@json-to-office/shared-docx',
      '@json-to-office/shared-pptx',
      '@json-to-office/core-docx',
      '@json-to-office/core-pptx',
    ]) {
      expect(info.packages[name]).toMatch(/^\d+\.\d+\.\d+/);
    }

    expect(info.formats.map((format: any) => format.name)).toEqual([
      'docx',
      'pptx',
    ]);
    for (const format of info.formats) {
      expect(format.rendererIds.length).toBeGreaterThan(0);
    }

    // `persistent: false` is the default: handles live in memory until a
    // workspace directory is configured (#290).
    expect(info.workspaces).toEqual({
      available: true,
      open: 0,
      persistent: false,
    });
    expect(info.output.root).toBe(path.join(scratch, 'out'));
    expect(info.output.maxInlineArtifactBytes).toBe(4 * 1024 * 1024);
  });

  it('probes the preview dependencies by default and skips on request', async () => {
    const probed = (await client.callTool({ name: 'jto_info', arguments: {} }))
      .structuredContent as Record<string, any>;
    expect(probed.previewDependencies.libreoffice).toHaveProperty('available');
    expect(probed.previewDependencies.pdftoppm.envVar).toBe('PDFTOPPM_PATH');

    const skipped = (
      await client.callTool({
        name: 'jto_info',
        arguments: { includePreviewDependencies: false },
      })
    ).structuredContent as Record<string, any>;
    expect(skipped.previewDependencies).toBeUndefined();
  });

  it('mirrors structuredContent in the text block', async () => {
    const result = await client.callTool({ name: 'jto_info', arguments: {} });
    const [block] = result.content as [{ type: string; text: string }];
    expect(block.type).toBe('text');
    expect(JSON.parse(block.text)).toEqual(result.structuredContent);
  });

  // Regression: the output schema used to require the six success fields, so
  // a jto_info that threw produced `{ok:false, diagnostics}`, failed the SDK's
  // own output validation, and reached the agent as an unreadable isError blob
  // instead of the internal error it is.
  it('still reports readably when the tool body throws', async () => {
    const deps = createToolDeps({
      outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'boom') }),
      serverVersion: '9.9.9-test',
      getAdapter: () => {
        throw new Error('core is not installed');
      },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const broken = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([
      createServer(deps).connect(serverTransport),
      broken.connect(clientTransport),
    ]);

    try {
      const result = await broken.callTool({
        name: 'jto_info',
        arguments: {},
      });
      const info = result.structuredContent as Record<string, any>;
      expect(info.ok).toBe(false);
      expect(info.diagnostics[0].code).toBe('E_INTERNAL');
      expect(info.diagnostics[0].message).toContain('core is not installed');
    } finally {
      await broken.close();
    }
  });

  it('turns a schema violation into an isError result, not a protocol error', async () => {
    const result = await client.callTool({
      name: 'jto_info',
      arguments: { includePreviewDependencies: 'yes please' },
    });
    expect(result.isError).toBe(true);
  });
});

describe('instructions', () => {
  it('states the invariants #271 requires', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/JSON is authoritative/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Make small edits/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Validate often/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Preview when/);
    expect(SERVER_INSTRUCTIONS).toMatch(/Snapshot before risky changes/);
  });

  it('reaches the client at initialize', async () => {
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });
});

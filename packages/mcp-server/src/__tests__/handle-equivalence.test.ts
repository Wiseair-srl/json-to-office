/**
 * #271's headline promise, checked rather than asserted in a README.
 *
 * "Inline tools remain first-class and behavior-equivalent" is a claim about
 * every document-taking tool, not about the workspace tools — so this suite
 * runs each of them twice over the SAME document, once with the JSON inline and
 * once with nothing but a handle, and demands the answers agree everywhere
 * except in the `source` field that exists precisely to tell them apart.
 *
 * Written against the assembled server over the protocol, because the thing
 * being tested is the seam between `resolveDocumentSource` and each tool's own
 * body — mocking either end would test the mock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { setWorkspaceStore } from '../lib/workspace-store.js';
import { probePreviewDependencies } from '../preview/dependencies.js';

const GENERATION_TIMEOUT_MS = 120_000;

const DOCX = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'Service Agreement', level: 1 } },
    { name: 'paragraph', props: { text: 'Payment is due within 30 days.' } },
  ],
};

const REVISED = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'Service Agreement', level: 1 } },
    { name: 'paragraph', props: { text: 'Payment is due within 14 days.' } },
  ],
};

const BROKEN = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'heading', props: { level: 1 } }],
};

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

async function call(
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  return (result as any).structuredContent;
}

async function open(document: unknown): Promise<string> {
  const created = await call('jto_workspace_create', {
    format: 'docx',
    document,
  });
  if (!created?.ok) {
    throw new Error(`create failed: ${JSON.stringify(created)}`);
  }
  return created.workspace.handle as string;
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-equiv-'));
  // The holder is process-wide; a store left by another suite would be a
  // workspace this one can see.
  setWorkspaceStore(undefined);
  client = await connect();
});

afterEach(async () => {
  await client.close();
  setWorkspaceStore(undefined);
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('jto_validate', () => {
  it('agrees on a good document whether it arrived inline or by handle', async () => {
    const handle = await open(DOCX);
    const inline = await call('jto_validate', {
      format: 'docx',
      document: DOCX,
    });
    const byHandle = await call('jto_validate', { format: 'docx', handle });

    expect(inline.source).toEqual({ origin: 'inline' });
    expect(byHandle.source).toEqual({
      origin: 'workspace',
      handle,
      revision: 1,
    });

    // Everything but `source` — the field whose whole job is to differ.
    const withoutSource = (result: Record<string, unknown>) => {
      const rest = { ...result };
      delete rest.source;
      return rest;
    };
    expect(withoutSource(byHandle)).toEqual(withoutSource(inline));
  });

  it('reports the same diagnostics, at the same pointers, for a broken one', async () => {
    const handle = await open(BROKEN);
    const inline = await call('jto_validate', {
      format: 'docx',
      document: BROKEN,
    });
    const byHandle = await call('jto_validate', { format: 'docx', handle });

    expect(inline.ok).toBe(false);
    expect(byHandle.ok).toBe(false);
    expect(byHandle.diagnostics).toEqual(inline.diagnostics);
    expect(byHandle.counts).toEqual(inline.counts);
    // The point of pointer-shaped paths: a diagnostic off the handle is a
    // patch target for that same handle.
    expect(inline.diagnostics[0].path).toMatch(/^\//);
  });

  it('honours a pinned revision instead of silently reading the newer tree', async () => {
    const handle = await open(DOCX);
    await call('jto_workspace_snapshot', { handle });
    await call('jto_workspace_patch', {
      handle,
      operations: [{ op: 'remove', path: '/children/1' }],
    });

    const head = await call('jto_validate', { format: 'docx', handle });
    expect(head.source).toEqual({ origin: 'workspace', handle, revision: 2 });

    const pinned = await call('jto_validate', {
      format: 'docx',
      handle,
      revision: 1,
    });
    expect(pinned.source).toEqual({
      origin: 'workspace',
      handle,
      revision: 1,
    });

    const stale = await call('jto_validate', {
      format: 'docx',
      handle,
      revision: 99,
    });
    expect(stale.ok).toBe(false);
    expect(stale.diagnostics[0].code).toBe('E_STALE_REVISION');
  });
});

describe('jto_generate', () => {
  it(
    'produces the same bytes from a handle as from inline JSON',
    async () => {
      const handle = await open(DOCX);
      const shared = {
        format: 'docx',
        deterministic: true,
        generatedAt: '2026-01-01T00:00:00.000Z',
      };

      const inline = await call('jto_generate', {
        ...shared,
        document: DOCX,
        filename: 'inline.docx',
        outputMode: 'base64',
      });
      const byHandle = await call('jto_generate', {
        ...shared,
        handle,
        filename: 'handle.docx',
        outputMode: 'base64',
      });

      expect(inline.ok).toBe(true);
      expect(byHandle.ok).toBe(true);
      expect(byHandle.artifact.base64).toBe(inline.artifact.base64);
      expect(byHandle.source).toEqual({
        origin: 'workspace',
        handle,
        revision: 1,
      });
      expect(inline.source).toEqual({ origin: 'inline' });
    },
    GENERATION_TIMEOUT_MS
  );
});

describe('jto_docx_diff', () => {
  it(
    'diffs handle against handle exactly as it diffs inline against inline',
    async () => {
      const before = await open(DOCX);
      const after = await open(REVISED);

      const inline = await call('jto_docx_diff', {
        before: { document: DOCX },
        after: { document: REVISED },
        dryRun: true,
      });
      const byHandle = await call('jto_docx_diff', {
        before: { handle: before },
        after: { handle: after },
        dryRun: true,
      });

      expect(inline.ok).toBe(true);
      expect(byHandle.ok).toBe(true);
      expect(byHandle.summary).toEqual(inline.summary);
      expect(byHandle.before).toEqual({
        origin: 'workspace',
        handle: before,
        revision: 1,
      });
      expect(byHandle.after).toEqual({
        origin: 'workspace',
        handle: after,
        revision: 1,
      });
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'accepts one side inline and the other by handle',
    async () => {
      const after = await open(REVISED);
      const mixed = await call('jto_docx_diff', {
        before: { document: DOCX },
        after: { handle: after },
        dryRun: true,
      });

      expect(mixed.ok).toBe(true);
      expect(mixed.before).toEqual({ origin: 'inline' });
      expect(mixed.after.origin).toBe('workspace');
      expect(mixed.summary.tracked.modified).toBeGreaterThan(0);
    },
    GENERATION_TIMEOUT_MS
  );
});

const dependencies = await probePreviewDependencies();
const canRender =
  dependencies.libreoffice.available && dependencies.pdftoppm.available;

describe.skipIf(!canRender)('jto_preview (needs LibreOffice + poppler)', () => {
  it(
    'renders the same pages from a handle as from inline JSON',
    async () => {
      const handle = await open(DOCX);
      const shared = { format: 'docx', pages: '1', outputMode: 'images' };

      const inline = await call('jto_preview', {
        ...shared,
        document: DOCX,
      });
      const byHandle = await call('jto_preview', { ...shared, handle });

      expect(inline.ok).toBe(true);
      expect(byHandle.ok).toBe(true);
      expect(byHandle.source).toEqual({
        origin: 'workspace',
        handle,
        revision: 1,
      });
      expect(inline.source).toEqual({ origin: 'inline' });

      expect(byHandle.totalPages).toBe(inline.totalPages);
      expect(byHandle.selection).toBe(inline.selection);
      // Identical document and options means one cache identity, whichever
      // door it came in by — which is also what makes the second call a hit.
      expect(byHandle.cache.documentKey).toBe(inline.cache.documentKey);
      expect(byHandle.pages[0].bytes).toBe(inline.pages[0].bytes);
    },
    GENERATION_TIMEOUT_MS
  );
});

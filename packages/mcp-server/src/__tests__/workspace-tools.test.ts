/**
 * The workspace tools as an agent meets them: over the protocol, through the
 * SDK's own schema validation, with nothing but handles between calls.
 *
 * The headline case is `the authoring loop`: a document is opened once and
 * never sent again — every later call names it by handle, and the assertions
 * check the tool payloads rather than the store's internals.
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
import {
  setWorkspaceStore,
  unavailableWorkspaceStore,
  type WorkspaceStore,
} from '../lib/workspace-store.js';
import {
  createMemoryWorkspaceStore,
  WORKSPACE_ERROR_CODES,
} from '../workspace/store.js';
import { ERROR_CODES } from '../lib/errors.js';

let scratch: string;
let client: Client;

async function connect(store?: WorkspaceStore): Promise<Client> {
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
    ...(store && { workspaces: () => store }),
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
  return { ...(result as any), out: (result as any).structuredContent };
}

async function ok(
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const result = await call(name, args);
  if (!result.out?.ok) {
    throw new Error(`${name} failed: ${JSON.stringify(result.out ?? result)}`);
  }
  return result.out;
}

const heading = (text: string) => ({
  name: 'heading',
  props: { text, level: 1 },
});

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-ws-'));
  // A connection's store follows its deps, so `connect` is isolated on its
  // own; this only clears the host override, which is still process-wide and
  // would make every connection here share one store.
  setWorkspaceStore(undefined);
  client = await connect();
});

afterEach(async () => {
  await client.close();
  setWorkspaceStore(undefined);
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('advertises all six workspace tools with enforceable schemas', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      'jto_workspace_create',
      'jto_workspace_inspect',
      'jto_workspace_patch',
      'jto_workspace_snapshot',
      'jto_workspace_list',
      'jto_workspace_close',
    ]) {
      expect(names).toContain(name);
    }

    const patch = tools.find((tool) => tool.name === 'jto_workspace_patch');
    const operations = (patch?.inputSchema as any).properties.operations;
    expect(operations.items.properties.op.enum).toEqual([
      'add',
      'remove',
      'replace',
      'move',
      'copy',
      'test',
    ]);
    // Only the envelope is required: a failure carries diagnostics and no
    // `workspace`, and the SDK discards structuredContent that misses a
    // required field.
    expect((patch?.outputSchema as any).required).toEqual([
      'ok',
      'diagnostics',
    ]);
    expect((patch?.outputSchema as any).properties.workspace).toBeDefined();
  });

  it('turns an input-schema violation into a tool error, not a protocol error', async () => {
    const result = await call('jto_workspace_patch', {
      handle: 'ws_whatever',
      operations: [],
    });
    expect(result.isError).toBe(true);
  });
});

describe('the authoring loop', () => {
  it('creates, inspects a subset, patches and snapshots without resending the document', async () => {
    const created = await ok('jto_workspace_create', {
      format: 'docx',
      title: 'Quarterly report',
      document: {
        name: 'docx',
        props: { theme: 'minimal' },
        children: [heading('Draft')],
      },
    });
    const handle = created.workspace.handle;
    expect(created.workspace).toMatchObject({
      revision: 1,
      format: 'docx',
      title: 'Quarterly report',
      pinnedRevisions: [],
    });

    // Read two pointers, not the tree.
    const inspected = await ok('jto_workspace_inspect', {
      handle,
      paths: [
        '/props/theme',
        '/children/0/props/text',
        '/props/metadata/title',
      ],
    });
    expect(inspected.projection).toEqual({
      '/props/theme': 'minimal',
      '/children/0/props/text': 'Draft',
    });
    expect(inspected.missingPaths).toEqual(['/props/metadata/title']);
    expect(inspected.document).toBeUndefined();
    expect(inspected.diagnostics[0]).toMatchObject({
      severity: 'warning',
      path: '/props/metadata/title',
    });

    const patched = await ok('jto_workspace_patch', {
      handle,
      baseRevision: 1,
      operations: [
        { op: 'replace', path: '/children/0/props/text', value: 'Q3 results' },
        {
          op: 'add',
          path: '/children/-',
          value: { name: 'paragraph', props: { text: 'Revenue grew.' } },
        },
        { op: 'add', path: '/props/metadata', value: { title: 'Q3' } },
      ],
    });
    expect(patched.workspace.revision).toBe(2);

    const snapshot = await ok('jto_workspace_snapshot', { handle });
    expect(snapshot.workspace.pinnedRevisions).toEqual([2]);
    expect(snapshot.document).toMatchObject({
      name: 'docx',
      props: { theme: 'minimal', metadata: { title: 'Q3' } },
    });
    expect(snapshot.document.children).toHaveLength(2);
    expect(snapshot.diagnostics).toEqual([]);

    // A risky change, then back to the pinned revision.
    await ok('jto_workspace_patch', {
      handle,
      operations: [{ op: 'remove', path: '/children/1' }],
    });
    const pinned = await ok('jto_workspace_inspect', { handle, revision: 2 });
    expect(pinned.workspace.revision).toBe(2);
    expect(pinned.document.children).toHaveLength(2);

    const head = await ok('jto_workspace_inspect', { handle });
    expect(head.workspace.revision).toBe(3);
    expect(head.document.children).toHaveLength(1);
  });

  it('validates and repairs by handle, never resending the document', async () => {
    const handle = (
      await ok('jto_workspace_create', {
        format: 'docx',
        document: {
          name: 'docx',
          props: {},
          children: [heading('One')],
        },
      })
    ).workspace.handle;

    // #204's tools take `handle` wherever they take `document`, so the whole
    // validate/repair loop runs on the server's copy.
    expect(await ok('jto_validate', { format: 'docx', handle })).toMatchObject({
      valid: true,
      source: { origin: 'workspace', handle, revision: 1 },
    });

    await ok('jto_workspace_patch', {
      handle,
      operations: [
        { op: 'replace', path: '/children/0/props/level', value: 'nope' },
      ],
    });

    const invalid = (await call('jto_validate', { format: 'docx', handle }))
      .out;
    expect(invalid.ok).toBe(false);
    // The diagnostic's pointer is the patch target for the repair.
    const broken = invalid.diagnostics[0].path;
    expect(broken).toBe('/children/0/props/level');

    await ok('jto_workspace_patch', {
      handle,
      operations: [{ op: 'replace', path: broken, value: 2 }],
    });
    expect(await ok('jto_validate', { format: 'docx', handle })).toMatchObject({
      valid: true,
      source: { revision: 3 },
    });
  });

  it('opens an empty skeleton to patch into, and says that is what it did', async () => {
    const created = await ok('jto_workspace_create', { format: 'pptx' });
    expect(created.diagnostics[0]).toMatchObject({
      severity: 'info',
      code: 'W_BLANK_DOCUMENT',
    });

    await ok('jto_workspace_patch', {
      handle: created.workspace.handle,
      operations: [
        { op: 'add', path: '/children/-', value: { name: 'slide' } },
      ],
    });
    const inspected = await ok('jto_workspace_inspect', {
      handle: created.workspace.handle,
    });
    expect(inspected.document).toEqual({
      name: 'pptx',
      props: {},
      children: [{ name: 'slide' }],
    });
  });

  it('keeps an invalid intermediate state instead of rejecting it', async () => {
    const created = await ok('jto_workspace_create', { format: 'docx' });
    const patched = await ok('jto_workspace_patch', {
      handle: created.workspace.handle,
      operations: [{ op: 'replace', path: '/name', value: 12 }],
    });
    expect(patched.workspace.revision).toBe(2);
  });
});

describe('failures an agent has to repair', () => {
  let handle: string;

  beforeEach(async () => {
    const created = await ok('jto_workspace_create', {
      format: 'docx',
      document: { name: 'docx', props: {}, children: [heading('One')] },
    });
    handle = created.workspace.handle;
  });

  it('applies none of a patch whose last operation fails', async () => {
    const failure = (
      await call('jto_workspace_patch', {
        handle,
        operations: [
          { op: 'add', path: '/props/author', value: 'Wiseair' },
          { op: 'replace', path: '/children/4/props/text', value: 'nope' },
        ],
      })
    ).out;
    expect(failure.ok).toBe(false);
    expect(failure.diagnostics[0]).toMatchObject({
      code: 'E_PATCH_FAILED',
      path: '/children/4',
      context: { operationIndex: 1 },
    });

    const after = await ok('jto_workspace_inspect', { handle });
    expect(after.workspace.revision).toBe(1);
    expect(after.document.props).toEqual({});
  });

  it('rejects a stale baseRevision', async () => {
    await ok('jto_workspace_patch', {
      handle,
      operations: [{ op: 'add', path: '/props/author', value: 'Wiseair' }],
    });
    const failure = (
      await call('jto_workspace_patch', {
        handle,
        baseRevision: 1,
        operations: [{ op: 'add', path: '/children/-', value: heading('Two') }],
      })
    ).out;
    expect(failure.diagnostics[0]).toMatchObject({
      code: ERROR_CODES.STALE_REVISION,
      context: { requested: 1, current: 2 },
    });
  });

  it('explains a pointer that is not RFC 6901', async () => {
    const failure = (
      await call('jto_workspace_patch', {
        handle,
        operations: [{ op: 'add', path: 'children/-', value: {} }],
      })
    ).out;
    expect(failure.diagnostics[0].code).toBe('E_INVALID_POINTER');
    expect(failure.diagnostics[0].message).toMatch(/start with "\/"/);
    expect(failure.diagnostics[0].suggestion).toMatch(/RFC 6901/);
  });

  it('reports a test operation that guarded a change correctly', async () => {
    const failure = (
      await call('jto_workspace_patch', {
        handle,
        operations: [
          { op: 'test', path: '/children/0/props/text', value: 'Two' },
          { op: 'replace', path: '/children/0/props/text', value: 'Three' },
        ],
      })
    ).out;
    expect(failure.diagnostics[0].code).toBe('E_PATCH_TEST_FAILED');

    const after = await ok('jto_workspace_inspect', {
      handle,
      paths: ['/children/0/props/text'],
    });
    expect(after.projection['/children/0/props/text']).toBe('One');
  });

  it('refuses to work on a closed handle', async () => {
    expect(await ok('jto_workspace_close', { handle })).toMatchObject({
      handle,
      closed: true,
    });

    const failure = (
      await call('jto_workspace_patch', {
        handle,
        operations: [{ op: 'add', path: '/props/author', value: 'x' }],
      })
    ).out;
    expect(failure.diagnostics[0].code).toBe(ERROR_CODES.UNKNOWN_HANDLE);

    const again = await ok('jto_workspace_close', { handle });
    expect(again.closed).toBe(false);
    expect(again.diagnostics[0].severity).toBe('info');
  });

  it('refuses a root that would make the document unreadable', async () => {
    const refused = (
      await call('jto_workspace_patch', {
        handle,
        operations: [{ op: 'replace', path: '', value: 42 }],
      })
    ).out;
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics[0].code).toBe(
      WORKSPACE_ERROR_CODES.INVALID_ROOT
    );

    // Why it is refused at the write: both read tools declare `document` as an
    // object, so a committed scalar comes back from the SDK as an isError text
    // blob with no structured content — the agent could not read its own JSON
    // to repair it, which is the one thing a workspace must never do.
    const inspected = await call('jto_workspace_inspect', { handle });
    expect(inspected.isError).toBeFalsy();
    expect(inspected.out.document).toMatchObject({ name: 'docx' });

    const snapshot = await call('jto_workspace_snapshot', { handle });
    expect(snapshot.isError).toBeFalsy();
    expect(snapshot.out.ok).toBe(true);
  });
});

describe('two workspaces', () => {
  it('cannot observe or mutate each other', async () => {
    const source = { name: 'docx', props: { theme: 'minimal' }, children: [] };
    const left = (
      await ok('jto_workspace_create', { format: 'docx', document: source })
    ).workspace.handle;
    const right = (
      await ok('jto_workspace_create', { format: 'docx', document: source })
    ).workspace.handle;

    await ok('jto_workspace_patch', {
      handle: left,
      operations: [
        { op: 'replace', path: '/props/theme', value: 'corporate' },
        { op: 'add', path: '/children/-', value: heading('Only on the left') },
      ],
    });

    const other = await ok('jto_workspace_inspect', { handle: right });
    expect(other.workspace.revision).toBe(1);
    expect(other.document).toEqual(source);

    await ok('jto_workspace_close', { handle: left });
    expect(
      (await ok('jto_workspace_inspect', { handle: right })).document
    ).toEqual(source);
  });
});

describe('store ownership', () => {
  it('keeps two connections in one process from reading each other', async () => {
    // What an embedding host does: a second `createToolDeps`/`createServer`
    // pair, same process. Handles are documented as valid only on the
    // connection that opened them, so the store has to follow `deps` rather
    // than live at module scope.
    const second = await connect();
    try {
      const document = {
        name: 'docx',
        props: { secret: 'first connection' },
        children: [],
      };
      const handle = (
        await ok('jto_workspace_create', { format: 'docx', document })
      ).workspace.handle;

      const listed = (await second.callTool({
        name: 'jto_workspace_list',
        arguments: {},
      })) as any;
      expect(listed.structuredContent.workspaces).toEqual([]);

      // `jto_workspace_list` makes handles enumerable on the connection that
      // owns them, so reaching across is not guesswork — it is the same
      // string, on a store it must not reach.
      for (const tool of ['jto_workspace_inspect', 'jto_workspace_snapshot']) {
        const reached = (await second.callTool({
          name: tool,
          arguments: { handle },
        })) as any;
        expect(reached.structuredContent.ok).toBe(false);
        expect(reached.structuredContent.diagnostics[0].code).toBe(
          ERROR_CODES.UNKNOWN_HANDLE
        );
      }

      // Every other tool resolves handles through the same connection store.
      const validated = (await second.callTool({
        name: 'jto_validate',
        arguments: { format: 'docx', handle },
      })) as any;
      expect(validated.structuredContent.diagnostics[0].code).toBe(
        ERROR_CODES.UNKNOWN_HANDLE
      );

      expect((await ok('jto_workspace_inspect', { handle })).document).toEqual(
        document
      );
    } finally {
      await second.close();
    }
  });

  it('leaves a host that switched workspaces off switched off', async () => {
    // The other half of "did the host install one": an installed stand-in is a
    // decision, not an absence, so no connection store may be opened over it.
    setWorkspaceStore(unavailableWorkspaceStore);
    const off = await connect();
    try {
      const created = (await off.callTool({
        name: 'jto_workspace_create',
        arguments: { format: 'docx' },
      })) as any;
      expect(created.structuredContent.ok).toBe(false);
      expect(created.structuredContent.diagnostics[0].code).toBe(
        ERROR_CODES.WORKSPACES_UNAVAILABLE
      );
    } finally {
      await off.close();
    }
  });
});

describe('jto_workspace_list', () => {
  it('gives an agent its handles back after losing them', async () => {
    const first = (
      await ok('jto_workspace_create', {
        format: 'docx',
        title: 'Report',
        document: { name: 'docx', props: {}, children: [heading('One')] },
      })
    ).workspace.handle;
    await ok('jto_workspace_patch', {
      handle: first,
      operations: [{ op: 'add', path: '/children/-', value: heading('Two') }],
    });
    await ok('jto_workspace_create', { format: 'pptx', title: 'Deck' });

    // Simulated context loss: the agent knows nothing but the tool name.
    const listed = await ok('jto_workspace_list');
    expect(listed.available).toBe(true);
    expect(listed.workspaces).toHaveLength(2);
    expect(listed.workspaces[0]).toMatchObject({
      handle: first,
      title: 'Report',
      revision: 2,
    });
    expect(listed.workspaces[0].bytes).toBeGreaterThan(0);
    expect(listed.limits.maxWorkspaces).toBeGreaterThan(0);
    expect(listed.usage.workspaces).toBe(2);

    const recovered = await ok('jto_workspace_inspect', {
      handle: listed.workspaces[0].handle,
      paths: ['/children/1/props/text'],
    });
    expect(recovered.projection['/children/1/props/text']).toBe('Two');
  });

  it('reports an empty list rather than a failure when nothing is open', async () => {
    const listed = await ok('jto_workspace_list');
    expect(listed.workspaces).toEqual([]);
  });
});

describe('jto_workspace_snapshot to a file', () => {
  it('writes the JSON under the output root instead of returning it inline', async () => {
    const handle = (
      await ok('jto_workspace_create', {
        format: 'docx',
        document: { name: 'docx', props: {}, children: [heading('One')] },
      })
    ).workspace.handle;

    const snapshot = await ok('jto_workspace_snapshot', {
      handle,
      filename: 'backup/report.docx.json',
    });
    expect(snapshot.document).toBeUndefined();
    expect(snapshot.artifact).toMatchObject({
      mode: 'path',
      filename: 'backup/report.docx.json',
      mimeType: 'application/json',
    });
    // The root is realpath'd, which on macOS turns /var into /private/var.
    const root = await fs.realpath(path.join(scratch, 'out'));
    expect(snapshot.artifact.path.startsWith(root)).toBe(true);
    expect(snapshot.artifact.relative).toBe(
      path.join('backup', 'report.docx.json')
    );

    const written = JSON.parse(
      await fs.readFile(snapshot.artifact.path, 'utf8')
    );
    expect(written.children[0].props.text).toBe('One');
  });

  it('refuses a filename that escapes the output root', async () => {
    const handle = (await ok('jto_workspace_create', { format: 'docx' }))
      .workspace.handle;
    const failure = (
      await call('jto_workspace_snapshot', {
        handle,
        filename: '../escaped.json',
      })
    ).out;
    expect(failure.ok).toBe(false);
    expect(failure.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
  });
});

describe('bounded, with a reason', () => {
  it('warns when a snapshot exports without a pin', async () => {
    await client.close();
    client = await connect(
      createMemoryWorkspaceStore({ maxPinnedRevisions: 0 })
    );

    const handle = (await ok('jto_workspace_create', { format: 'docx' }))
      .workspace.handle;
    const snapshot = await ok('jto_workspace_snapshot', { handle });

    expect(snapshot.workspace.pinnedRevisions).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'W_SNAPSHOT_NOT_PINNED',
      }),
    ]);
  });

  it('refuses capacity overflow and reports TTL eviction', async () => {
    await client.close();
    let clock = 1_700_000_000_000;
    const store = createMemoryWorkspaceStore({
      maxWorkspaces: 1,
      idleTtlMs: 60_000,
      now: () => clock,
    });
    client = await connect(store);

    const first = (await ok('jto_workspace_create', { format: 'docx' }))
      .workspace.handle;
    clock += 1_000;
    const refused = (await call('jto_workspace_create', { format: 'docx' }))
      .out;
    expect(refused.diagnostics[0].code).toBe('E_WORKSPACE_LIMIT');

    const preserved = await ok('jto_workspace_inspect', { handle: first });
    expect(preserved.workspace.handle).toBe(first);

    clock += 60_001;
    const expired = (await call('jto_workspace_inspect', { handle: first }))
      .out;
    expect(expired.diagnostics[0]).toMatchObject({
      code: 'E_WORKSPACE_EVICTED',
      context: { reason: 'ttl' },
    });
    expect(expired.diagnostics[0].suggestion).toMatch(/snapshot/i);
  });
});

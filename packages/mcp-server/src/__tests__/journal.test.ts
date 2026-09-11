/**
 * The run journal (#422), read the way the importer reads it: a JSONL file on
 * disk, written by a server that an ordinary client talked to.
 *
 * What it has to prove is narrow. A Claude Desktop session leaves nothing the
 * harness can measure — the client's own log names each `tools/call` and none
 * of its arguments — so the server writes the evidence itself, when asked:
 * which tools ran in what order, what each answered, and the exact document
 * every successful generation delivered. What it must never do is the other
 * half: carry the client's content into a file nobody reviews, or break a
 * tool call because a log could not be written.
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
import { JOURNAL_ENV } from '../lib/journal.js';
import { createMemoryWorkspaceStore } from '../workspace/store.js';

let scratch: string;
let journalPath: string;
let client: Client;

/** A sentence that must never reach the journal. */
const SECRET = 'Margins recovered to 14.2% after the Leeds depot closed';

const docx = (text: string) => ({
  name: 'docx',
  props: { metadata: { title: 'Journal fixture' } },
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { text: 'Findings', level: 1 } },
        { name: 'paragraph', props: { text } },
      ],
    },
  ],
});

async function connect(file: string | undefined): Promise<Client> {
  const store = createMemoryWorkspaceStore();
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
    workspaces: () => store,
    env: file === undefined ? {} : { [JOURNAL_ENV]: file },
  });
  const server = createServer(deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: 'journal-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    connected.connect(clientTransport),
  ]);
  return connected;
}

async function ok(name: string, args: Record<string, unknown>): Promise<any> {
  const result = (await client.callTool({ name, arguments: args })) as any;
  if (!result.structuredContent?.ok) {
    throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  }
  return result.structuredContent;
}

async function lines(): Promise<any[]> {
  const text = await fs.readFile(journalPath, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-journal-'));
  journalPath = path.join(scratch, 'desktop', 'journal.jsonl');
  client = await connect(journalPath);
});

afterEach(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('run journal', () => {
  it('is off unless the environment names a file', () => {
    expect(createToolDeps({ env: {} }).journal).toBeUndefined();
    expect(
      createToolDeps({ env: { [JOURNAL_ENV]: journalPath } }).journal?.path
    ).toBe(journalPath);
  });

  it('opens with the session, then writes one line per tool call in call order', async () => {
    await ok('jto_info', {});
    await ok('jto_validate', { format: 'docx', document: docx('Short.') });

    const [session, info, validate] = await lines();
    expect(session).toMatchObject({
      v: 1,
      type: 'session',
      server: { name: 'json-to-office', version: '9.9.9-test' },
    });
    expect(session.session).toMatch(/^s-[0-9a-f]{8}$/);
    expect(info).toMatchObject({
      type: 'call',
      session: session.session,
      seq: 1,
      tool: 'jto_info',
      result: { ok: true },
    });
    expect(validate).toMatchObject({
      type: 'call',
      seq: 2,
      tool: 'jto_validate',
      args: { format: 'docx' },
      result: { ok: true },
    });
    expect(typeof validate.durationMs).toBe('number');
    expect(Date.parse(validate.at)).not.toBeNaN();
  });

  it('keeps option values, reduces documents to a digest and never writes content', async () => {
    await ok('jto_validate', { format: 'docx', document: docx(SECRET) });

    const validate = (await lines()).find(
      (line) => line.tool === 'jto_validate'
    );
    expect(validate.args.format).toBe('docx');
    expect(validate.args.document).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      bytes: expect.any(Number),
    });
    expect(validate.result.diagnostics).toMatchObject({
      total: expect.any(Number),
    });
    expect(await fs.readFile(journalPath, 'utf8')).not.toContain('Leeds');
  });

  it('records a patch as its operations and paths, never their values', async () => {
    const created = await ok('jto_workspace_create', {
      format: 'docx',
      document: docx('Draft.'),
    });
    await ok('jto_workspace_patch', {
      handle: created.workspace.handle,
      operations: [
        {
          op: 'replace',
          path: '/children/0/children/1/props/text',
          value: SECRET,
        },
      ],
    });

    const patch = (await lines()).find(
      (line) => line.tool === 'jto_workspace_patch'
    );
    expect(patch.args).toMatchObject({
      handle: created.workspace.handle,
      operations: [
        { op: 'replace', path: '/children/0/children/1/props/text' },
      ],
    });
    expect(patch.result.workspace).toMatchObject({
      handle: created.workspace.handle,
      revision: 2,
    });
    expect(await fs.readFile(journalPath, 'utf8')).not.toContain('Leeds');
  });

  it('saves the exact document each successful generation delivered, from a handle or inline', async () => {
    const created = await ok('jto_workspace_create', {
      format: 'docx',
      document: docx('First draft.'),
    });
    const handle = created.workspace.handle;
    await ok('jto_workspace_patch', {
      handle,
      operations: [
        {
          op: 'replace',
          path: '/children/0/children/1/props/text',
          value: 'Accepted revision.',
        },
      ],
    });
    const fromHandle = await ok('jto_generate', { format: 'docx', handle });
    const inline = docx('Sent inline.');
    await ok('jto_generate', { format: 'docx', document: inline });

    const generations = (await lines()).filter(
      (line) => line.tool === 'jto_generate'
    );
    expect(generations).toHaveLength(2);

    const [byHandle, byValue] = generations;
    expect(byHandle.result.source).toEqual({
      origin: 'workspace',
      handle,
      revision: 2,
    });
    expect(byHandle.result.artifact).toMatchObject({
      mode: 'path',
      path: fromHandle.artifact.path,
      bytes: fromHandle.artifact.bytes,
    });
    const delivered = JSON.parse(
      await fs.readFile(byHandle.delivered.file, 'utf8')
    );
    expect(delivered.children[0].children[1].props.text).toBe(
      'Accepted revision.'
    );
    expect(byHandle.delivered.sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(byValue.result.source).toEqual({ origin: 'inline' });
    expect(
      JSON.parse(await fs.readFile(byValue.delivered.file, 'utf8'))
    ).toEqual(inline);
    expect(byValue.delivered.sha256).toBe(byValue.args.document.sha256);
  });

  it('writes no delivered document for a generation that did not deliver', async () => {
    const result = (await client.callTool({
      name: 'jto_generate',
      arguments: { format: 'docx', document: { name: 'docx', children: [7] } },
    })) as any;
    expect(result.structuredContent.ok).toBe(false);

    const generate = (await lines()).find(
      (line) => line.tool === 'jto_generate'
    );
    expect(generate.result.ok).toBe(false);
    expect(generate.result.diagnostics.errors.length).toBeGreaterThan(0);
    expect(generate.delivered).toBeUndefined();
  });

  it('journals a tool with no input schema, which the SDK calls with its context alone', async () => {
    await client.close();
    const store = createMemoryWorkspaceStore();
    const deps = createToolDeps({
      outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
      serverVersion: '9.9.9-test',
      workspaces: () => store,
      env: { [JOURNAL_ENV]: journalPath },
    });
    const server = createServer(deps);
    server.registerTool(
      'jto_test_ping',
      { description: 'A tool that takes nothing.' },
      async () => ({
        content: [
          { type: 'text' as const, text: '{"ok":true,"diagnostics":[]}' },
        ],
      })
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'journal-test', version: '1.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    await client.callTool({ name: 'jto_test_ping', arguments: {} });
    const ping = (await lines()).find((line) => line.tool === 'jto_test_ping');
    expect(ping.args).toEqual({});
    expect(ping.result).toMatchObject({ ok: true });
  });

  it('never lets a journal it cannot write break the tool call', async () => {
    await client.close();
    const blocked = path.join(scratch, 'a-file');
    await fs.writeFile(blocked, 'not a directory');
    journalPath = path.join(blocked, 'journal.jsonl');
    client = await connect(journalPath);

    const info = await ok('jto_info', {});
    expect(info.ok).toBe(true);
  });
});

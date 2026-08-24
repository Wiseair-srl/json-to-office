/**
 * `jto_docx_diff`, checked against the file it actually produces.
 *
 * The point of the tool is the WordprocessingML, not the summary: a redline
 * that renders the changes as coloured text would satisfy every count in
 * `summary` and still be useless in Word. So the emitted .docx is unzipped and
 * its `document.xml` read for real `w:ins` / `w:del` revisions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { inflateRawSync } from 'zlib';

import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createToolDeps, type ToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { register } from '../tools/diff.js';

const GENERATION_TIMEOUT_MS = 60_000;

const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/**
 * Read one entry out of a ZIP container.
 *
 * Hand-rolled because the package has no zip dependency and this suite needs
 * to look inside the .docx rather than trust its size. Reads the central
 * directory rather than scanning local headers, since a streamed entry's local
 * header carries a zero compressed size.
 */
function readZipEntry(archive: Buffer, name: string): string {
  const eocd = archive.lastIndexOf(EOCD_SIGNATURE);
  if (eocd < 0) throw new Error('not a zip archive');

  const entries = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);

  for (let index = 0; index < entries; index += 1) {
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const entryName = archive.toString(
      'utf8',
      cursor + 46,
      cursor + 46 + nameLength
    );

    if (entryName === name) {
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = archive.subarray(start, start + compressedSize);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`no entry "${name}" in archive`);
}

function contract(fee: string, notice: string) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      { name: 'heading', props: { text: 'Service Agreement', level: 1 } },
      {
        name: 'paragraph',
        props: { text: `The Client shall pay a fee equal to ${fee}.` },
      },
      {
        name: 'paragraph',
        props: { text: `Either party may terminate with ${notice} notice.` },
      },
    ],
  };
}

const BEFORE = contract('10% of monthly revenue', '30 days written');
const AFTER = contract('12% of monthly revenue', '30 days written');

let scratch: string;
let deps: ToolDeps;
let client: Client;

async function connect(): Promise<Client> {
  const server = new McpServer(
    { name: 'json-to-office', version: '9.9.9-test' },
    { capabilities: { tools: {} } }
  );
  register(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    connected.connect(clientTransport),
  ]);
  return connected;
}

async function diff(
  args: Record<string, unknown>
): Promise<{ result: Record<string, any>; isError: unknown }> {
  const called = await client.callTool({
    name: 'jto_docx_diff',
    arguments: args,
  });
  return {
    result: called.structuredContent as Record<string, any>,
    isError: called.isError,
  };
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-diff-'));
  deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
  });
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('jto_docx_diff', () => {
  it(
    'emits a redline whose changes are native Word revisions',
    async () => {
      const { result, isError } = await diff({
        before: { document: BEFORE },
        after: { document: AFTER },
        author: 'Reviewer',
      });

      expect(isError).toBeFalsy();
      expect(result.ok).toBe(true);
      expect(result.summary.tracked.modified).toBe(1);
      expect(result.summary.unchangedBlocks).toBe(2);
      expect(result.artifact.filename).toBe('redline.docx');

      const archive = await fs.readFile(result.artifact.path);
      expect(archive[0]).toBe(0x50);
      expect(archive[1]).toBe(0x4b);

      const xml = readZipEntry(archive, 'word/document.xml');
      expect(xml).toContain('<w:ins ');
      expect(xml).toContain('<w:del ');
      expect(xml).toContain('w:author="Reviewer"');
      // Deleted runs must be w:delText, or Word shows the old wording as if it
      // were still part of the document.
      expect(xml).toContain('w:delText');
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'produces the same bytes twice when no date is given',
    async () => {
      const first = await diff({
        before: { document: BEFORE },
        after: { document: AFTER },
        filename: 'first.docx',
        deterministic: true,
      });
      const second = await diff({
        before: { document: BEFORE },
        after: { document: AFTER },
        filename: 'second.docx',
        deterministic: true,
      });

      const a = await fs.readFile(first.result.artifact.path);
      const b = await fs.readFile(second.result.artifact.path);
      expect(a.equals(b)).toBe(true);
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'stamps the requested revision date',
    async () => {
      const { result } = await diff({
        before: { document: BEFORE },
        after: { document: AFTER },
        date: '2026-06-09T10:00:00Z',
      });
      const xml = readZipEntry(
        await fs.readFile(result.artifact.path),
        'word/document.xml'
      );
      expect(xml).toContain('2026-06-09T10:00:00');
    },
    GENERATION_TIMEOUT_MS
  );

  it('summarises without rendering on a dry run', async () => {
    const { result } = await diff({
      before: { document: BEFORE },
      after: { document: AFTER },
      dryRun: true,
      includeRedlineDocument: true,
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.artifact).toBeUndefined();
    expect(result.summary.tracked.modified).toBe(1);
    expect(result.redline.name).toBe('docx');
    await expect(fs.readdir(path.join(scratch, 'out'))).rejects.toThrow();
  });

  it('reports identical documents as no change at all', async () => {
    const { result } = await diff({
      before: { document: BEFORE },
      after: { document: BEFORE },
      dryRun: true,
    });
    expect(result.summary.tracked).toEqual({
      modified: 0,
      inserted: 0,
      deleted: 0,
    });
    expect(result.summary.untracked).toEqual([]);
  });

  it('surfaces changes the redline cannot express as revisions', async () => {
    const { result } = await diff({
      before: { document: BEFORE },
      // A placeholder inside changed text renders literally in the redline;
      // the engine says so rather than letting it pass as a real edit.
      after: {
        document: contract('{RATE} of monthly revenue', '30 days written'),
      },
      dryRun: true,
    });
    expect(result.summary.untracked.length).toBeGreaterThan(0);
    expect(result.summary.untracked[0]).toMatchObject({
      kind: 'modified',
      component: 'paragraph',
    });
    expect(result.summary.untracked[0].path).toMatch(/^\//);
  });

  it('names the side a broken document is on', async () => {
    const { result, isError } = await diff({
      before: {
        document: {
          name: 'docx',
          props: {},
          children: [{ name: 'paragraph', props: { text: 42 } }],
        },
      },
      after: { document: AFTER },
    });

    expect(isError).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: '/children/0/props/text',
      context: { side: 'before' },
    });
  });

  it('rejects a date it cannot parse before doing any work', async () => {
    const { result } = await diff({
      before: { document: BEFORE },
      after: { document: AFTER },
      date: 'last tuesday',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_INVALID_DATE');
  });

  it('requires a resolvable source on both sides', async () => {
    const { result } = await diff({
      before: { document: BEFORE },
      after: {},
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'E_DOC_SOURCE_MISSING',
      context: { side: 'after' },
    });
  });

  // Every other tool takes the document as a top-level sibling of `format`, so
  // an agent arriving here from twelve of them passes the document itself. It
  // used to be rejected by the schema with six repetitions of "must NOT have
  // additional properties" and no mention of which property, or of the wrapper.
  it('takes a bare document on either side, exactly like the wrapper', async () => {
    const wrapped = await diff({
      before: { document: BEFORE },
      after: { document: AFTER },
      dryRun: true,
    });
    const bare = await diff({ before: BEFORE, after: AFTER, dryRun: true });

    expect(bare.isError).toBeFalsy();
    expect(bare.result.ok).toBe(true);
    expect(bare.result.summary).toEqual(wrapped.result.summary);
    expect(bare.result.before).toEqual({ origin: 'inline' });
  });

  it('still names the two spellings when a side is neither', async () => {
    const { result } = await diff({
      before: BEFORE,
      after: { documnt: AFTER },
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'E_DOC_SOURCE_MISSING',
      context: { side: 'after' },
    });
  });

  it('rejects a generatedAt it cannot parse', async () => {
    const { result } = await diff({
      before: BEFORE,
      after: AFTER,
      generatedAt: 'the day before yesterday',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'E_INVALID_DATE',
      context: { option: 'generatedAt' },
    });
  });
});

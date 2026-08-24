/**
 * #271's promise, weighed on the wire.
 *
 * A workspace exists so an agent stops resending the document. That is a claim
 * about bytes, and bytes are only visible from outside the SDK client — so this
 * suite drives the server through `RawStdioServer`, which keeps every frame it
 * writes, and asserts against the actual size of the requests rather than
 * against the shape of the API that produced them.
 *
 * The document is deliberately bulky. On a 600-byte starter every request looks
 * small and the test would pass while proving nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';

import {
  bulkyDocx,
  makeScratch,
  parentDirOf,
  RawStdioServer,
  realRoot,
  ZIP_MAGIC,
  type JsonRpcMessage,
} from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const JOURNEY_TIMEOUT_MS = 180_000;

/** ~150 KB of JSON: heavy enough that resending it would be obvious. */
const DOCUMENT = bulkyDocx(1_500);
const DOCUMENT_BYTES = JSON.stringify(DOCUMENT).length;

let server: RawStdioServer;
let outputRoot: string;

function structured(message: JsonRpcMessage): Record<string, any> {
  expect(
    message.error,
    `unexpected JSON-RPC error: ${JSON.stringify(message.error)}`
  ).toBeUndefined();
  expect(message.result?.isError).toBeFalsy();
  return message.result?.structuredContent as Record<string, any>;
}

/** Bytes the last request occupied on the wire, framing included. */
function lastRequestBytes(): number {
  return server.sent[server.sent.length - 1].length + 1;
}

beforeAll(async () => {
  outputRoot = await makeScratch('jto-mcp-ws');
  server = await RawStdioServer.start(outputRoot);
  await server.openLegacy();
}, CONNECT_TIMEOUT_MS);

afterAll(async () => {
  await server?.close();
  if (outputRoot) await fs.rm(outputRoot, { recursive: true, force: true });
});

describe('editing a document by handle, never resending it', () => {
  let handle: string;
  let createBytes: number;

  it(
    'opens a workspace and hands back a handle at revision 1',
    async () => {
      const created = structured(
        await server.callTool('jto_workspace_create', {
          format: 'docx',
          document: DOCUMENT,
          title: 'bulk report',
        })
      );
      createBytes = lastRequestBytes();

      expect(created.ok).toBe(true);
      expect(created.workspace.revision).toBe(1);
      expect(created.workspace.format).toBe('docx');
      expect(created.workspace.title).toBe('bulk report');
      expect(created.workspace.bytes).toBeGreaterThan(100_000);
      handle = created.workspace.handle;
      expect(handle).toMatch(/\S/);

      // Sanity on the measurement itself: the one call that DOES carry the
      // document has to be the big one, or the comparisons below mean nothing.
      expect(createBytes).toBeGreaterThan(DOCUMENT_BYTES);
    },
    JOURNEY_TIMEOUT_MS
  );

  it('reads only the pointers it asks for', async () => {
    const inspected = structured(
      await server.callTool('jto_workspace_inspect', {
        handle,
        paths: [
          '/props/metadata/title',
          '/children/0/children/0/props/text',
          '/children/0/children/9/props/text',
          '/children/0/children/99999/props/text',
        ],
      })
    );

    expect(inspected.ok).toBe(true);
    expect(inspected.projection['/props/metadata/title']).toBe('Bulk report');
    expect(inspected.missingPaths).toEqual([
      '/children/0/children/99999/props/text',
    ]);
    // Absent by default when projecting — the entire point of asking for
    // pointers is not to receive the tree back.
    expect(inspected.document).toBeUndefined();

    const responseBytes = JSON.stringify(inspected).length;
    expect(
      responseBytes,
      'a four-pointer projection came back as big as the document'
    ).toBeLessThan(DOCUMENT_BYTES / 20);
  });

  it('patches in place, and the patch request is a rounding error next to the document', async () => {
    const patched = structured(
      await server.callTool('jto_workspace_patch', {
        handle,
        baseRevision: 1,
        operations: [
          {
            op: 'replace',
            path: '/props/metadata/title',
            value: 'Bulk report, revised',
          },
          {
            op: 'replace',
            path: '/children/0/children/0/props/text',
            value: 'Bulk report, revised',
          },
          {
            op: 'add',
            path: '/children/0/children/-',
            value: {
              name: 'paragraph',
              props: { text: 'Appended without resending anything.' },
            },
          },
        ],
      })
    );
    const patchBytes = lastRequestBytes();

    expect(patched.ok).toBe(true);
    expect(patched.workspace.revision).toBe(2);

    // The headline number. A three-operation edit against a 150 KB document
    // should cost well under a percent of what resending it would.
    expect(patchBytes).toBeLessThan(DOCUMENT_BYTES / 100);
    expect(patchBytes).toBeLessThan(createBytes / 100);
  });

  it('refuses a patch built against a revision that has moved', async () => {
    const stale = await server.callTool('jto_workspace_patch', {
      handle,
      baseRevision: 1,
      operations: [
        { op: 'replace', path: '/props/metadata/title', value: 'no' },
      ],
    });

    expect(stale.error).toBeUndefined();
    expect(stale.result?.isError).toBeFalsy();
    const result = stale.result?.structuredContent as Record<string, any>;
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_STALE_REVISION');

    // And nothing was burnt: the refusal must not have advanced the document.
    const listed = structured(await server.callTool('jto_workspace_list', {}));
    const record = listed.workspaces.find(
      (entry: any) => entry.handle === handle
    );
    expect(record.revision).toBe(2);
  });

  // First call in this file that reaches the DOCX core, so the child pays for
  // importing it and building its schema here rather than in `beforeAll`.
  it(
    'validates the open document from the handle alone',
    async () => {
      const validated = structured(
        await server.callTool('jto_validate', { format: 'docx', handle })
      );
      const validateBytes = lastRequestBytes();

      expect(validated.ok).toBe(true);
      expect(validated.source).toEqual({
        origin: 'workspace',
        handle,
        revision: 2,
      });
      expect(validateBytes).toBeLessThan(DOCUMENT_BYTES / 100);
    },
    JOURNEY_TIMEOUT_MS
  );

  it('snapshots to a file and pins the revision behind it', async () => {
    const snapshot = structured(
      await server.callTool('jto_workspace_snapshot', {
        handle,
        filename: 'workspace-snapshot.json',
      })
    );

    expect(snapshot.ok).toBe(true);
    expect(snapshot.workspace.pinnedRevisions).toContain(2);
    // Written, not inlined — the whole document did not come back over stdio.
    expect(snapshot.document).toBeUndefined();
    expect(snapshot.artifact.mode).toBe('path');
    expect(await parentDirOf(snapshot.artifact.path)).toBe(
      await realRoot(outputRoot)
    );

    const written = JSON.parse(
      await fs.readFile(snapshot.artifact.path, 'utf8')
    );
    expect(written.props.metadata.title).toBe('Bulk report, revised');
    expect(written.children[0].children).toHaveLength(
      (DOCUMENT.children as any[])[0].children.length + 1
    );
  });

  it('still reads the pinned revision after the document moves past it', async () => {
    const moved = structured(
      await server.callTool('jto_workspace_patch', {
        handle,
        operations: [
          {
            op: 'replace',
            path: '/props/metadata/title',
            value: 'Moved on',
          },
        ],
      })
    );
    expect(moved.workspace.revision).toBe(3);

    const pinned = structured(
      await server.callTool('jto_workspace_inspect', {
        handle,
        revision: 2,
        paths: ['/props/metadata/title'],
      })
    );
    expect(pinned.projection['/props/metadata/title']).toBe(
      'Bulk report, revised'
    );
  });

  it(
    'generates from the handle, and the file on disk carries the patches',
    async () => {
      const generated = structured(
        await server.callTool(
          'jto_generate',
          { format: 'docx', handle, revision: 3, filename: 'from-handle.docx' },
          JOURNEY_TIMEOUT_MS
        )
      );
      const generateBytes = lastRequestBytes();

      expect(generated.ok).toBe(true);
      expect(generated.source).toEqual({
        origin: 'workspace',
        handle,
        revision: 3,
      });
      expect(generateBytes).toBeLessThan(DOCUMENT_BYTES / 100);

      const bytes = await fs.readFile(generated.artifact.path);
      expect(bytes.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
      expect(bytes.length).toBe(generated.artifact.bytes);
    },
    JOURNEY_TIMEOUT_MS
  );

  it('closes the handle, and says so the second time', async () => {
    const closed = structured(
      await server.callTool('jto_workspace_close', { handle })
    );
    expect(closed).toMatchObject({ ok: true, handle, closed: true });

    const again = structured(
      await server.callTool('jto_workspace_close', { handle })
    );
    expect(again.closed).toBe(false);
    expect(again.diagnostics[0].code).toBe('E_UNKNOWN_HANDLE');

    const afterwards = structured(
      await server.callTool('jto_validate', { format: 'docx', handle })
    );
    expect(afterwards.ok).toBe(false);
    expect(afterwards.diagnostics[0].code).toBe('E_UNKNOWN_HANDLE');
  });

  it('never put the document back on the wire after opening it', () => {
    // The claim in one assertion: exactly one frame this connection sent was
    // ever document-sized, and it was the create.
    const heavy = server.sent.filter(
      (frame) => frame.length > DOCUMENT_BYTES / 4
    );
    expect(heavy).toHaveLength(1);
    expect(heavy[0]).toContain('jto_workspace_create');
  });
});

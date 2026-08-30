/**
 * The reported failure, reproduced and then fixed (#290).
 *
 * A 2026-08 field report lost five revisions of authoring when the host client
 * reset its session. The server was healthy the whole time — the documents
 * simply lived in the memory of a connection that no longer existed. That is a
 * claim about what survives a PROCESS, so this suite spawns two of them: one
 * that authors and is then killed, and a second that is handed nothing but the
 * same `--workspace-dir` and has to find the work again.
 *
 * The in-process suite (`workspace-persistence.test.ts`) covers the store's
 * semantics. What is only true here is that the flag reaches the store at all,
 * and that a genuinely dead child takes nothing with it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';

import {
  callTool,
  makeScratch,
  openSession,
  type StdioSession,
} from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const JOURNEY_TIMEOUT_MS = 180_000;

/** The five revisions the report lost, as headings appended one at a time. */
const HEADINGS = ['Scope', 'Method', 'Findings', 'Risks', 'Next steps'];

let workspaceRoot: string;
let outputRoot: string;
let handle: string;

async function connect(): Promise<StdioSession> {
  return openSession({ outputRoot, workspaceRoot });
}

beforeAll(async () => {
  outputRoot = await makeScratch('jto-mcp-recover-out');
  workspaceRoot = await makeScratch('jto-mcp-recover-ws');
}, CONNECT_TIMEOUT_MS);

afterAll(async () => {
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe('a workspace outliving the session that made it', () => {
  it(
    'authors five revisions, then loses the connection',
    async () => {
      const session = await connect();

      const info = (await callTool(session, 'jto_info', {
        includePreviewDependencies: false,
      })) as any;
      expect(info.workspaces).toMatchObject({
        available: true,
        persistent: true,
        root: workspaceRoot,
      });

      const created = (await callTool(session, 'jto_workspace_create', {
        format: 'docx',
        title: 'Field report',
        document: { name: 'docx', props: {}, children: [] },
      })) as any;
      expect(created.ok).toBe(true);
      handle = created.workspace.handle;
      expect(created.workspace.persisted).toBe(true);

      for (const [index, text] of HEADINGS.entries()) {
        const patched = (await callTool(session, 'jto_workspace_patch', {
          handle,
          baseRevision: index + 1,
          operations: [
            {
              op: 'add',
              path: '/children/-',
              value: { name: 'heading', props: { text, level: 2 } },
            },
          ],
        })) as any;
        expect(patched.ok).toBe(true);
        expect(patched.workspace.revision).toBe(index + 2);
      }

      // No close, no snapshot, no export — exactly what the report described.
      // `close` here tears the child process down with the transport.
      await session.close();
    },
    JOURNEY_TIMEOUT_MS
  );

  it(
    'finds the handle again from a new process, and keeps working on it',
    async () => {
      const session = await connect();
      try {
        // The agent has lost everything it knew, including the handle.
        const listed = (await callTool(
          session,
          'jto_workspace_list',
          {}
        )) as any;
        expect(listed.ok).toBe(true);
        expect(listed.persistence).toMatchObject({ root: workspaceRoot });

        const recovered = listed.workspaces.find(
          (workspace: any) => workspace.handle === handle
        );
        expect(recovered).toMatchObject({
          handle,
          format: 'docx',
          title: 'Field report',
          revision: HEADINGS.length + 1,
          persisted: true,
        });

        const read = (await callTool(session, 'jto_workspace_inspect', {
          handle,
        })) as any;
        expect(read.ok).toBe(true);
        expect(
          read.document.children.map((child: any) => child.props.text)
        ).toEqual(HEADINGS);

        // A recovered handle is an ordinary handle: every document-taking tool
        // reads it the same way, and it is still writable.
        const validated = (await callTool(session, 'jto_validate', {
          format: 'docx',
          handle,
        })) as any;
        expect(validated.source).toMatchObject({
          origin: 'workspace',
          handle,
          revision: HEADINGS.length + 1,
        });

        const patched = (await callTool(session, 'jto_workspace_patch', {
          handle,
          baseRevision: HEADINGS.length + 1,
          operations: [{ op: 'add', path: '/props/title', value: 'Recovered' }],
        })) as any;
        expect(patched.workspace.revision).toBe(HEADINGS.length + 2);
      } finally {
        await session.close();
      }
    },
    JOURNEY_TIMEOUT_MS
  );

  it(
    'forgets it for good once the agent closes it',
    async () => {
      const closing = await connect();
      try {
        const closed = (await callTool(closing, 'jto_workspace_close', {
          handle,
        })) as any;
        expect(closed.closed).toBe(true);
      } finally {
        await closing.close();
      }

      const session = await connect();
      try {
        const listed = (await callTool(
          session,
          'jto_workspace_list',
          {}
        )) as any;
        expect(
          listed.workspaces.map((workspace: any) => workspace.handle)
        ).not.toContain(handle);

        const read = (await callTool(session, 'jto_workspace_inspect', {
          handle,
        })) as any;
        expect(read.ok).toBe(false);
        expect(read.diagnostics[0].code).toBe('E_UNKNOWN_HANDLE');
      } finally {
        await session.close();
      }
    },
    JOURNEY_TIMEOUT_MS
  );
});

/**
 * #345's acceptance, over a real stdio transport.
 *
 * The critique loop as an agent meets it: a workspace, an inspection that
 * hands back evidence and a run id, a verdict recorded against the revision
 * that was inspected, a dropped response retried, a verdict about a revision
 * the workspace has moved past, and the way back from it. The state machine
 * is proved in process in `critique.test.ts`; what this adds is that the same
 * answers survive the wire, including the image blocks.
 *
 * The evidence half needs LibreOffice and poppler and says so; the refusals
 * do not, and run everywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { probePreviewDependencies } from '../preview/dependencies.js';
import {
  callTool,
  openSession,
  type StdioSession,
} from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 180_000;

let session: StdioSession;

const DOC = {
  name: 'docx',
  props: { theme: 'consulting' },
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { level: 1, text: 'Quarterly review' } },
        {
          name: 'paragraph',
          props: { text: 'Delivery stabilised and every account renewed.' },
        },
      ],
    },
  ],
};

async function open(): Promise<string> {
  const created = (await callTool(session, 'jto_workspace_create', {
    format: 'docx',
    document: DOC,
  })) as { workspace: { handle: string } };
  return created.workspace.handle;
}

const dependencies = await probePreviewDependencies();
const canRender =
  dependencies.libreoffice.available && dependencies.pdftoppm.available;

beforeAll(async () => {
  session = await openSession();
}, CONNECT_TIMEOUT_MS);

afterAll(async () => {
  await session?.close();
});

describe('critiquing a draft over stdio', () => {
  it(
    'publishes both actions with the rubric and the run contract',
    async () => {
      const tools = await session.client.listTools();
      const critique = tools.tools.find((tool) => tool.name === 'jto_critique');
      expect(critique).toBeDefined();
      const properties = (
        critique!.inputSchema as { properties: Record<string, unknown> }
      ).properties;
      expect(Object.keys(properties)).toEqual(
        expect.arrayContaining([
          'action',
          'handle',
          'runId',
          'verdict',
          'rationale',
        ])
      );
      expect((properties.action as { enum: string[] }).enum).toEqual([
        'inspect',
        'record',
      ]);
      expect(critique!.description).toContain('Only recording counts');
    },
    STEP_TIMEOUT_MS
  );

  it(
    'refuses a record for a run it never opened, without inventing a round',
    async () => {
      const handle = await open();
      const out = await callTool(session, 'jto_critique', {
        action: 'record',
        handle,
        runId: 'crit_neverissued',
        verdict: 'ship',
        rationale: 'Nothing was inspected.',
      });
      expect(out.ok).toBe(false);
      expect(out.diagnostics.map((d) => d.code)).toEqual([
        'E_CRITIQUE_RUN_UNKNOWN',
      ]);
    },
    STEP_TIMEOUT_MS
  );

  it.skipIf(!canRender)(
    'inspects, records once however many times it is sent, refuses a stale verdict and recovers',
    async () => {
      const handle = await open();

      const result = await session.client.callTool(
        {
          name: 'jto_critique',
          arguments: { action: 'inspect', handle, evidencePages: 1 },
        },
        { timeout: STEP_TIMEOUT_MS }
      );
      // The evidence rides in image blocks, the way a preview's pages do: the
      // sheet first, then the pages the run chose.
      const images = (result.content as Array<{ type: string }>).filter(
        (block) => block.type === 'image'
      );
      expect(images.length).toBeGreaterThanOrEqual(1);
      const inspected = result.structuredContent as unknown as {
        ok: boolean;
        run: { id: string; revision: number; round: number };
        rubric: { levels: unknown[]; shippingQuestion: string };
        evidence: unknown[];
        contactSheet?: { pageCount: number };
      };
      expect(inspected.ok).toBe(true);
      expect(inspected.run).toMatchObject({ revision: 1, round: 0 });
      expect(inspected.rubric.levels).toHaveLength(5);
      expect(inspected.rubric.shippingQuestion).toMatch(/\?$/);
      expect(inspected.evidence).toHaveLength(1);

      const args = {
        action: 'record',
        handle,
        runId: inspected.run.id,
        revision: 1,
        verdict: 'iterate',
        rationale: 'Page 1: the heading and the body share a baseline.',
      };
      const first = await callTool(session, 'jto_critique', args);
      expect(first).toMatchObject({ ok: true, rounds: 1, stop: false });

      // The same call again — a retried response, not a second opinion.
      const again = await callTool(session, 'jto_critique', args);
      expect(again).toMatchObject({ ok: true, rounds: 1 });
      expect(again.diagnostics.map((d) => d.code)).toContain(
        'W_CRITIQUE_DUPLICATE'
      );

      // Judge, then edit, then try to file the old verdict.
      const stale = (await callTool(session, 'jto_critique', {
        action: 'inspect',
        handle,
        evidencePages: 0,
      })) as { run: { id: string } };
      await callTool(session, 'jto_workspace_patch', {
        handle,
        baseRevision: 1,
        operations: [
          {
            op: 'replace',
            path: '/children/0/children/1/props/text',
            value: 'Delivery stabilised; every account renewed on time.',
          },
        ],
      });
      const refused = await callTool(session, 'jto_critique', {
        action: 'record',
        handle,
        runId: stale.run.id,
        verdict: 'ship',
        rationale: 'Judged before the edit.',
      });
      expect(refused.ok).toBe(false);
      expect(refused.diagnostics.map((d) => d.code)).toEqual([
        'E_STALE_REVISION',
      ]);

      // Recovery is the documented one: look again, judge what is there.
      const fresh = (await callTool(session, 'jto_critique', {
        action: 'inspect',
        handle,
        evidencePages: 0,
      })) as { run: { id: string; revision: number; round: number } };
      expect(fresh.run).toMatchObject({ revision: 2, round: 1 });
      const shipped = await callTool(session, 'jto_critique', {
        action: 'record',
        handle,
        runId: fresh.run.id,
        verdict: 'ship',
        rationale: 'Page 1 now reads as finished.',
      });
      expect(shipped).toMatchObject({ ok: true, rounds: 1, stop: true });
    },
    STEP_TIMEOUT_MS
  );
});

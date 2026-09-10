/**
 * `jto_critique`, which exists to make one number trustworthy.
 *
 * The evidence half needs LibreOffice and skips itself where it is absent.
 * The state machine does not: what counts as a round, what a retry counts as,
 * and what a verdict about a revision the workspace has moved past counts as,
 * are answered here on every host, because that is the part the three-round
 * limit rests on.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { RUBRIC, SHIPPING_QUESTION } from '@json-to-office/shared';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { MAX_CRITIQUE_ROUNDS, createCritiqueLog } from '../lib/critique-log.js';
import { choosePages, MAX_EVIDENCE_PAGES } from '../tools/critique.js';
import { designGuide } from '../lib/design-guide.js';
import { probePreviewDependencies } from '../preview/dependencies.js';

let scratch: string;
let client: Client;

interface Envelope {
  ok: boolean;
  diagnostics: Array<{
    severity: string;
    code: string;
    message: string;
    context?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent as unknown as Envelope;
}
const codes = (out: Envelope) => out.diagnostics.map((d) => d.code);

/** A one-page document, so a render is as cheap as a render gets. */
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
          props: {
            text: 'Delivery stabilised in April and every account renewed.',
          },
        },
      ],
    },
  ],
};

async function open(): Promise<string> {
  const created = await call('jto_workspace_create', {
    format: 'docx',
    document: DOC,
  });
  return (created.workspace as { handle: string }).handle;
}

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-critique-'));
  const server = createServer(
    createToolDeps({
      outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
      serverVersion: '9.9.9-test',
    })
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'critique-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('what a round is', () => {
  it('refuses a record for a run this connection never opened', async () => {
    const handle = await open();
    const out = await call('jto_critique', {
      action: 'record',
      handle,
      runId: 'crit_nothinghere',
      verdict: 'iterate',
      rationale: 'Made up.',
    });
    expect(out.ok).toBe(false);
    expect(codes(out)).toEqual(['E_CRITIQUE_RUN_UNKNOWN']);
  });

  it('refuses a record that names neither verdict nor rationale', async () => {
    const handle = await open();
    const out = await call('jto_critique', {
      action: 'record',
      handle,
      runId: 'crit_whatever',
    });
    expect(out.ok).toBe(false);
    expect(codes(out)).toEqual(['E_REQUIRED_PROPERTY']);
  });
});

describe('the log keeps a round once it is filed', () => {
  it('drops an unrecorded run at the cap but never a round it produced', () => {
    const log = createCritiqueLog();
    const spent = log.open({ handle: 'w1', format: 'docx', revision: 1 });
    log.record({
      runId: spent.id,
      handle: 'w1',
      revision: 1,
      verdict: 'iterate',
      rationale: 'Page 1 reads as a draft.',
    });
    // Enough inspections after it to push the run itself out of the cap.
    for (let i = 0; i < 200; i += 1)
      log.open({ handle: 'w1', format: 'docx', revision: 1 });
    expect(log.run(spent.id)).toBeUndefined();
    // The run is gone; the round it spent is not, so the count cannot reset.
    expect(log.rounds('w1')).toHaveLength(1);
    // And releasing the workspace still releases everything about it.
    log.forget('w1');
    expect(log.rounds('w1')).toEqual([]);
  });
});

describe('choosing what to look at', () => {
  it('puts the pages a rule named first, worst first, then the rest in order', () => {
    const chosen = choosePages(
      [1, 2, 3, 4],
      [
        { severity: 'warning', code: 'W', message: 'a', context: { page: 3 } },
        { severity: 'warning', code: 'W', message: 'b', context: { page: 3 } },
        { severity: 'warning', code: 'W', message: 'c', context: { page: 2 } },
      ] as never,
      3
    );
    expect(chosen.map((entry) => entry.page)).toEqual([3, 2, 1]);
    expect(chosen[0]).toMatchObject({ findings: 2 });
    expect(chosen[2].reason).toContain('No rendered finding');
  });

  it('returns nothing when nothing was asked for, and never more than it has', () => {
    expect(choosePages([1, 2], [], 0)).toEqual([]);
    expect(choosePages([1, 2], [], MAX_EVIDENCE_PAGES)).toHaveLength(2);
  });
});

describe('the rubric is one table', () => {
  it('is the same data in the guide, the tool and the judge', async () => {
    const guide = await designGuide('docx');
    expect(guide.rubric.levels).toEqual(RUBRIC.map((entry) => ({ ...entry })));
    expect(guide.rubric.shippingQuestion).toBe(SHIPPING_QUESTION);
    // The rendered guide states every level and the question, so guidance an
    // agent reads and the rubric it is judged by cannot drift apart.
    for (const level of RUBRIC) {
      expect(guide.markdown).toContain(level.name);
      expect(guide.markdown).toContain(level.bar);
    }
    expect(guide.markdown).toContain(SHIPPING_QUESTION);
    expect(guide.generatedFrom).toContain('the rubric');
  });
});

const dependencies = await probePreviewDependencies();
const canRender =
  dependencies.libreoffice.available && dependencies.pdftoppm.available;

describe.skipIf(!canRender)(
  'inspect and record (needs LibreOffice + poppler)',
  () => {
    it('returns evidence, the rubric and a run id, and counts only what is recorded', async () => {
      const handle = await open();
      const first = await call('jto_critique', { action: 'inspect', handle });
      expect(first.ok).toBe(true);
      expect(first.run).toMatchObject({
        handle,
        revision: 1,
        round: 0,
        roundsRemaining: MAX_CRITIQUE_ROUNDS,
      });
      expect(first.contactSheet).toMatchObject({ pageCount: 1 });
      expect((first.evidence as unknown[]).length).toBeGreaterThan(0);
      expect((first.rubric as { levels: unknown[] }).levels).toHaveLength(5);

      // Looking twice is not a round.
      const second = await call('jto_critique', { action: 'inspect', handle });
      expect(second.run).toMatchObject({ round: 0 });
      expect((second.run as { id: string }).id).not.toBe(
        (first.run as { id: string }).id
      );

      const recorded = await call('jto_critique', {
        action: 'record',
        handle,
        runId: (second.run as { id: string }).id,
        verdict: 'iterate',
        rationale: 'Page 1: the heading sits too close to the first paragraph.',
        level: 3,
      });
      expect(recorded.ok).toBe(true);
      expect(recorded.rounds).toBe(1);
      expect(recorded.stop).toBe(false);
      expect(recorded.record).toMatchObject({
        revision: 1,
        verdict: 'iterate',
        level: 3,
      });

      // A retry of the same record is the same round, not a second one.
      const retried = await call('jto_critique', {
        action: 'record',
        handle,
        runId: (second.run as { id: string }).id,
        verdict: 'iterate',
        rationale: 'Page 1: the heading sits too close to the first paragraph.',
      });
      expect(retried.ok).toBe(true);
      expect(retried.rounds).toBe(1);
      expect(codes(retried)).toContain('W_CRITIQUE_DUPLICATE');
    }, 180_000);

    it('refuses a verdict about a revision the workspace has moved past', async () => {
      const handle = await open();
      const inspected = await call('jto_critique', {
        action: 'inspect',
        handle,
      });
      await call('jto_workspace_patch', {
        handle,
        baseRevision: 1,
        operations: [
          {
            op: 'replace',
            path: '/children/0/children/0/props/text',
            value: 'Quarterly review, revised',
          },
        ],
      });
      const stale = await call('jto_critique', {
        action: 'record',
        handle,
        runId: (inspected.run as { id: string }).id,
        verdict: 'ship',
        rationale: 'Judged before the edit.',
      });
      expect(stale.ok).toBe(false);
      expect(codes(stale)).toEqual(['E_STALE_REVISION']);
      expect(stale.diagnostics[0].context).toMatchObject({
        runRevision: 1,
        currentRevision: 2,
      });
      // And the count is untouched: nothing was filed.
      const again = await call('jto_critique', { action: 'inspect', handle });
      expect(again.run).toMatchObject({ round: 0, revision: 2 });
    }, 180_000);

    it('recommends stopping on the third recorded iterate, and on a ship verdict', async () => {
      const handle = await open();
      let revision = 1;
      for (let round = 1; round <= MAX_CRITIQUE_ROUNDS; round += 1) {
        const inspected = await call('jto_critique', {
          action: 'inspect',
          handle,
        });
        const out = await call('jto_critique', {
          action: 'record',
          handle,
          runId: (inspected.run as { id: string }).id,
          revision,
          verdict: 'iterate',
          rationale: `Round ${round}: page 1 still reads as a draft.`,
        });
        expect(out.rounds).toBe(round);
        expect(out.stop).toBe(round === MAX_CRITIQUE_ROUNDS);
        const note = out.diagnostics.find((d) => d.code === 'W_CRITIQUE_STOP');
        expect(note?.severity).toBe(
          round === MAX_CRITIQUE_ROUNDS ? 'warning' : 'info'
        );
        if (round === MAX_CRITIQUE_ROUNDS) break;
        await call('jto_workspace_patch', {
          handle,
          baseRevision: revision,
          operations: [
            {
              op: 'replace',
              path: '/children/0/children/1/props/text',
              value: `Delivery stabilised in April, round ${round}.`,
            },
          ],
        });
        revision += 1;
      }

      // A ship verdict stops it whatever the count says.
      const shipped = await open();
      const inspected = await call('jto_critique', {
        action: 'inspect',
        handle: shipped,
      });
      const out = await call('jto_critique', {
        action: 'record',
        handle: shipped,
        runId: (inspected.run as { id: string }).id,
        verdict: 'ship',
        rationale: 'Page 1 reads as finished; nothing here needs another pass.',
      });
      expect(out.stop).toBe(true);
      expect(out.rounds).toBe(0);
      expect(
        out.diagnostics.find((d) => d.code === 'W_CRITIQUE_STOP')?.message
      ).toContain('sendable');
    }, 300_000);

    it('refuses a run that belongs to another workspace', async () => {
      const mine = await open();
      const theirs = await open();
      const inspected = await call('jto_critique', {
        action: 'inspect',
        handle: mine,
      });
      const out = await call('jto_critique', {
        action: 'record',
        handle: theirs,
        runId: (inspected.run as { id: string }).id,
        verdict: 'ship',
        rationale: 'Wrong document.',
      });
      expect(out.ok).toBe(false);
      expect(codes(out)).toEqual(['E_CRITIQUE_RUN_UNKNOWN']);
    }, 180_000);
  }
);

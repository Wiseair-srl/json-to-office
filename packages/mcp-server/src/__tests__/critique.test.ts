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
import {
  acceptFindings,
  choosePages,
  integrityFindings,
  MAX_EVIDENCE_PAGES,
} from '../tools/critique.js';
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

async function open(document: unknown = DOC): Promise<string> {
  const created = await call('jto_workspace_create', {
    format: 'docx',
    document,
  });
  return (created.workspace as { handle: string }).handle;
}

/**
 * A framed paragraph placed past the page foot: the rendered pass reports it
 * clipped at its pointer on every platform LibreOffice runs on.
 */
const CLIPPED = {
  name: 'docx',
  props: {},
  children: [
    {
      name: 'paragraph',
      props: {
        text: `Framed. ${Array.from(
          { length: 40 },
          (_, i) => `Sentence ${i} keeps going with several more words`
        ).join('. ')}`,
        font: { size: 12 },
        floating: {
          width: 4000,
          height: 800,
          horizontalPosition: { offset: 720 },
          verticalPosition: { offset: 14500 },
        },
      },
    },
  ],
};

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

describe('what a ship verdict has to answer for', () => {
  const rendered = (
    code: string,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    severity: 'warning',
    code,
    message: `${code} message`,
    source: 'quality',
    category: 'integrity',
    certainty: 'rendered',
    ...extra,
  });

  it('is every integrity finding at warning or worse, with its page and pointer', () => {
    const found = integrityFindings([
      rendered('W_QUALITY_RENDERED_CLIP', {
        ruleId: 'rendered/clip',
        path: '/children/3/children/0',
        context: { page: 4, mapping: 'mapped' },
      }),
      // Information is a note, not a defect the verdict must answer for.
      rendered('W_QUALITY_RENDERED_EMPTY_PAGE', {
        ruleId: 'rendered/empty-page',
        severity: 'info',
        context: { page: 2 },
      }),
      // Page fill is composition, not integrity.
      rendered('W_QUALITY_RENDERED_PAGE_UNDERFILLED', {
        ruleId: 'rendered/page-underfilled',
        category: 'composition',
        context: { page: 3 },
      }),
      { severity: 'info', code: 'W_CRITIQUE_STOP', message: 'Look first.' },
    ] as never);
    expect(found).toEqual([
      {
        code: 'W_QUALITY_RENDERED_CLIP',
        ruleId: 'rendered/clip',
        path: '/children/3/children/0',
        page: 4,
        message: 'W_QUALITY_RENDERED_CLIP message',
      },
    ]);
  });

  const open = [
    {
      code: 'W_QUALITY_RENDERED_CLIP',
      ruleId: 'rendered/clip',
      path: '/children/3/children/0',
      page: 4,
      message: 'cut off',
    },
    {
      code: 'W_QUALITY_RENDERED_SPILL',
      ruleId: 'rendered/spill',
      path: '/children/3/children/0',
      page: 4,
      message: 'drawn wider',
    },
    {
      code: 'W_QUALITY_RENDERED_TEXT_MISSING',
      ruleId: 'rendered/text-missing',
      page: 6,
      message: 'nowhere in the PDF',
    },
  ];

  it('accepts by code, rule or pointer, the way a quality policy suppresses, and keeps each reason', () => {
    const result = acceptFindings(open, [
      {
        code: 'W_QUALITY_RENDERED_CLIP',
        path: '/children/3/children/0',
        reason: 'The title wraps in PowerPoint; only the render clips it.',
      },
      {
        ruleId: 'rendered/text-missing',
        reason: 'The string is a speaker note, not slide text.',
      },
      { path: '/children/9', reason: 'Nothing is here.' },
    ]);
    expect(
      result.accepted.map((finding) => [finding.code, finding.reason])
    ).toEqual([
      [
        'W_QUALITY_RENDERED_CLIP',
        'The title wraps in PowerPoint; only the render clips it.',
      ],
      [
        'W_QUALITY_RENDERED_TEXT_MISSING',
        'The string is a speaker note, not slide text.',
      ],
    ]);
    expect(result.open.map((finding) => finding.code)).toEqual([
      'W_QUALITY_RENDERED_SPILL',
    ]);
    // An acceptance that covers nothing is reported, not silently kept.
    expect(result.unmatched).toEqual([
      { path: '/children/9', reason: 'Nothing is here.' },
    ]);
  });

  it('never lets an acceptance without a selector cover everything', () => {
    const result = acceptFindings(open, [{ reason: 'All fine.' }]);
    expect(result.accepted).toEqual([]);
    expect(result.open).toHaveLength(3);
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

    it('refuses a ship verdict that leaves an integrity finding unanswered, and files one that accepts it', async () => {
      const handle = await open(CLIPPED);
      const inspected = await call('jto_critique', {
        action: 'inspect',
        handle,
        evidencePages: 0,
      });
      expect(codes(inspected)).toContain('W_QUALITY_RENDERED_CLIP');
      // The inspection says up front what a ship will have to answer for.
      expect(
        inspected.diagnostics.find((d) => d.code === 'W_CRITIQUE_STOP')?.message
      ).toContain('W_QUALITY_RENDERED_CLIP');
      const runId = (inspected.run as { id: string }).id;

      const silent = await call('jto_critique', {
        action: 'record',
        handle,
        runId,
        verdict: 'ship',
        rationale: 'Page 1 reads as finished.',
        level: 5,
      });
      expect(silent.ok).toBe(false);
      expect(codes(silent)).toEqual(['E_CRITIQUE_OPEN_FINDINGS']);
      expect(silent.diagnostics[0].context).toMatchObject({
        runId,
        findings: expect.arrayContaining([
          expect.objectContaining({
            code: 'W_QUALITY_RENDERED_CLIP',
            page: 1,
            path: '/children/0/props/text',
          }),
        ]),
      });

      // Nothing was filed, so the same run still takes a verdict — one that
      // accepts the finding, with a reason, and is kept with it.
      const reason =
        'The frame is meant to run off the page foot; the clipped tail is decoration.';
      const accepted = await call('jto_critique', {
        action: 'record',
        handle,
        runId,
        verdict: 'ship',
        rationale: 'Page 1 reads as finished; the clip is the intended bleed.',
        accept: [{ ruleId: 'rendered/clip', reason }],
      });
      expect(accepted).toMatchObject({ ok: true, rounds: 0, stop: true });
      const record = accepted.record as {
        accepted: Array<{ code: string; page?: number; reason: string }>;
      };
      expect(record.accepted.length).toBeGreaterThan(0);
      for (const finding of record.accepted) {
        expect(finding).toMatchObject({
          code: 'W_QUALITY_RENDERED_CLIP',
          page: 1,
          reason,
        });
      }
      expect(
        accepted.diagnostics.find(
          (d) => d.code === 'W_CRITIQUE_FINDINGS_ACCEPTED'
        )?.severity
      ).toBe('warning');
    }, 180_000);

    it('files an iterate verdict whatever the findings, because it ships nothing', async () => {
      const handle = await open(CLIPPED);
      const inspected = await call('jto_critique', {
        action: 'inspect',
        handle,
        evidencePages: 0,
      });
      const out = await call('jto_critique', {
        action: 'record',
        handle,
        runId: (inspected.run as { id: string }).id,
        verdict: 'iterate',
        rationale: 'Page 1: the framed paragraph runs off the page foot.',
      });
      expect(out).toMatchObject({ ok: true, rounds: 1, stop: false });
    }, 180_000);

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

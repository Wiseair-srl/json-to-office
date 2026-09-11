import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JOURNAL_VERSION } from '@json-to-office/mcp-server';

import {
  checkDelivery,
  desktopAccounting,
  desktopEvents,
  parseJournal,
  READABLE_JOURNAL_VERSION,
  summarizeSessions,
} from './desktop.js';
import { countIterations } from './runner.js';

const line = (value: unknown) => JSON.stringify(value);

const session = (id: string, at: string) =>
  line({
    v: 1,
    type: 'session',
    at,
    session: id,
    server: { name: 'json-to-office', version: '6.4.0' },
    pid: 1,
    node: 'v24',
    platform: 'darwin-arm64',
    outputRoot: '/out',
    workspaceRoot: '/ws',
  });

const call = (
  id: string,
  seq: number,
  at: string,
  tool: string,
  extra: Record<string, unknown> = {}
) =>
  line({
    v: 1,
    type: 'call',
    at,
    session: id,
    seq,
    tool,
    durationMs: 1000,
    args: {},
    result: { ok: true, diagnostics: { total: 0, errors: [], warnings: [] } },
    ...extra,
  });

const JOURNAL = [
  session('s-aaaa1111', '2026-09-12T09:00:00.000Z'),
  call('s-aaaa1111', 1, '2026-09-12T09:00:05.000Z', 'jto_info'),
  call('s-aaaa1111', 2, '2026-09-12T09:00:20.000Z', 'jto_scaffold', {
    args: { blueprint: 'client-report', theme: 'consulting' },
    result: { ok: true, workspace: { handle: 'ws1', revision: 1 } },
  }),
  call('s-aaaa1111', 3, '2026-09-12T09:01:00.000Z', 'jto_workspace_patch'),
  call('s-aaaa1111', 4, '2026-09-12T09:02:00.000Z', 'jto_workspace_patch'),
  call('s-aaaa1111', 5, '2026-09-12T09:03:00.000Z', 'jto_validate'),
  call('s-aaaa1111', 6, '2026-09-12T09:04:00.000Z', 'jto_preview', {
    args: { contactSheet: true },
  }),
  call('s-aaaa1111', 7, '2026-09-12T09:05:00.000Z', 'jto_critique', {
    args: { action: 'inspect' },
  }),
  call('s-aaaa1111', 8, '2026-09-12T09:06:00.000Z', 'jto_workspace_patch'),
  call('s-aaaa1111', 9, '2026-09-12T09:07:00.000Z', 'jto_critique', {
    args: { action: 'record' },
  }),
  call('s-aaaa1111', 10, '2026-09-12T09:08:00.000Z', 'jto_generate', {
    args: { format: 'docx', handle: 'ws1' },
    result: {
      ok: true,
      diagnostics: { total: 0, errors: [], warnings: [] },
      source: { origin: 'workspace', handle: 'ws1', revision: 4 },
      artifact: { mode: 'path', path: '/out/report.docx', bytes: 5120 },
    },
    delivered: {
      sha256: 'a'.repeat(64),
      bytes: 900,
      file: '/j.documents/a.json',
      handle: 'ws1',
      revision: 4,
    },
  }),
  session('s-bbbb2222', '2026-09-12T10:00:00.000Z'),
  call('s-bbbb2222', 1, '2026-09-12T10:00:10.000Z', 'jto_generate', {
    args: { format: 'docx' },
    result: {
      ok: false,
      diagnostics: {
        total: 1,
        errors: [
          {
            code: 'E_CHART_EXPORT',
            message:
              'Highcharts export server returned 503 Service Unavailable',
          },
        ],
        warnings: [],
      },
    },
  }),
  // A connection the host opened and never used.
  session('s-cccc3333', '2026-09-12T11:00:00.000Z'),
].join('\n');

describe('parseJournal', () => {
  it('groups calls under the session that made them, in call order', () => {
    const journal = parseJournal(JOURNAL);
    expect(journal.sessions.map((entry) => entry.id)).toEqual([
      's-aaaa1111',
      's-bbbb2222',
      's-cccc3333',
    ]);
    expect(journal.sessions[0].calls.map((entry) => entry.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(journal.sessions[0].facts.server).toEqual({
      name: 'json-to-office',
      version: '6.4.0',
    });
  });

  it('reads the version the server writes, so a bump there forces a change here', () => {
    expect(READABLE_JOURNAL_VERSION).toBe(JOURNAL_VERSION);
  });

  it('refuses a journal line of a version it cannot read', () => {
    expect(() => parseJournal(line({ v: 2, type: 'call' }))).toThrow(/version/);
  });

  it('skips blank lines and a torn last line from a killed server', () => {
    const torn = `${JOURNAL}\n\n{"v":1,"type":"call","se`;
    expect(parseJournal(torn).sessions).toHaveLength(3);
  });
});

describe('a Desktop session, measured like a headless run', () => {
  const [used, failed, idle] = parseJournal(JOURNAL).sessions;

  it('replays as the tool calls the headless counters already read', () => {
    const events = desktopEvents(used);
    expect(events.filter((event) => event.type === 'tool_use')).toHaveLength(
      10
    );
    expect(events[0]).toMatchObject({
      type: 'tool_use',
      name: 'mcp__json-to-office__jto_info',
    });
    // Three patches, one generate: the same arithmetic as a headless run.
    expect(countIterations(events)).toBe(3);
  });

  it('accounts for the calls, the time, the delivery and what the loop used', () => {
    const accounting = desktopAccounting(used);
    expect(accounting).toMatchObject({
      toolCalls: 10,
      iterations: 3,
      environmentFailures: [],
      wallMs: 8 * 60 * 1000 - 5000 + 1000,
      delivered: {
        artifact: '/out/report.docx',
        bytes: 5120,
        handle: 'ws1',
        revision: 4,
        documentFile: '/j.documents/a.json',
        documentSha256: 'a'.repeat(64),
        format: 'docx',
      },
      loop: {
        scaffolded: true,
        validations: 1,
        previews: 1,
        contactSheets: 1,
        critiqueInspections: 1,
        critiqueRecords: 1,
        generations: 1,
      },
    });
  });

  it('reads a render-environment failure out of the diagnostics, as a headless run does', () => {
    const accounting = desktopAccounting(failed);
    expect(accounting.delivered).toBeUndefined();
    expect(accounting.environmentFailures).toEqual([
      'Highcharts export server returned 503 Service Unavailable',
    ]);
  });

  it('lists every session with what it did, so a run can be matched to its brief', () => {
    expect(summarizeSessions(parseJournal(JOURNAL))).toEqual([
      {
        id: 's-aaaa1111',
        startedAt: '2026-09-12T09:00:00.000Z',
        calls: 10,
        firstCallAt: '2026-09-12T09:00:05.000Z',
        lastCallAt: '2026-09-12T09:08:00.000Z',
        blueprint: 'client-report',
        theme: 'consulting',
        delivered: '/out/report.docx',
      },
      {
        id: 's-bbbb2222',
        startedAt: '2026-09-12T10:00:00.000Z',
        calls: 1,
        firstCallAt: '2026-09-12T10:00:10.000Z',
        lastCallAt: '2026-09-12T10:00:10.000Z',
      },
      {
        id: 's-cccc3333',
        startedAt: '2026-09-12T11:00:00.000Z',
        calls: 0,
      },
    ]);
    expect(desktopAccounting(idle).toolCalls).toBe(0);
  });
});

describe('checking what a Desktop session delivered', () => {
  const text = '{"name":"docx"}';
  const digest = createHash('sha256').update(text).digest('hex');

  it('passes a document that matches its digest and a file that matches its own', () => {
    expect(
      checkDelivery({
        documentText: text,
        documentSha256: digest,
        artifact: { exists: true, bytes: 10, sha256: 'f'.repeat(64) },
        expected: { bytes: 10, artifactSha256: 'f'.repeat(64) },
      })
    ).toEqual({
      documentVerified: true,
      artifactExists: true,
      artifactVerified: true,
    });
  });

  it('fails a run whose file is gone, or changed after it was generated', () => {
    expect(
      checkDelivery({
        documentText: text,
        documentSha256: digest,
        artifact: { exists: false },
        expected: { bytes: 10 },
      }).failure
    ).toMatch(/missing/);
    expect(
      checkDelivery({
        documentText: text,
        documentSha256: digest,
        artifact: { exists: true, bytes: 10, sha256: 'e'.repeat(64) },
        expected: { bytes: 10, artifactSha256: 'f'.repeat(64) },
      }).failure
    ).toMatch(/changed/);
  });

  it('fails a run whose kept document is not the one the server recorded', () => {
    expect(
      checkDelivery({
        documentText: `${text} `,
        documentSha256: digest,
        artifact: { exists: true, bytes: 10 },
        expected: { bytes: 10 },
      }).failure
    ).toMatch(/digest/);
  });
});

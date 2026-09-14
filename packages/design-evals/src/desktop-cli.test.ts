import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from './desktop-cli.js';

vi.mock('./analyze.js', async (original) => ({
  ...(await original<typeof import('./analyze.js')>()),
  analyzeDocument: vi.fn(async () => ({
    diagnostics: [],
    pages: 4,
    pageCountSource: 'rendered',
  })),
}));
vi.mock('./render.js', async (original) => ({
  ...(await original<typeof import('./render.js')>()),
  renderForJudging: vi.fn(async () => ({
    sheet: { png: Buffer.from('png') },
    totalPages: 4,
  })),
}));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

/**
 * A journal the way a Desktop launch leaves one when a brief ran beside
 * another conversation: one session, the brief's workspace, the reviewer's
 * own document interleaved with it, and a third chat that opened a workspace.
 */
async function sharedLaunch(options: { inline?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-cli-'));
  dirs.push(dir);
  const documentText = JSON.stringify({ name: 'docx', children: [] });
  const documentFile = path.join(dir, 'kept.json');
  await fs.writeFile(documentFile, documentText);
  const artifactBytes = Buffer.from('docx bytes');
  const artifactFile = path.join(dir, 'brief.docx');
  await fs.writeFile(artifactFile, artifactBytes);

  const at = (second: number) =>
    new Date(Date.UTC(2026, 8, 14, 13, 58, second)).toISOString();
  const call = (
    seq: number,
    tool: string,
    extra: Record<string, unknown> = {}
  ) => ({
    v: 1,
    type: 'call',
    at: at(seq),
    session: 's-mix00001',
    seq,
    tool,
    durationMs: 500,
    args: {},
    result: { ok: true, diagnostics: { total: 0, errors: [], warnings: [] } },
    ...extra,
  });
  const lines = [
    {
      v: 1,
      type: 'session',
      at: at(0),
      session: 's-mix00001',
      server: { name: 'json-to-office', version: '6.4.0' },
      serverBuild: 'a'.repeat(64),
    },
    call(1, 'jto_info'),
    call(2, 'jto_scaffold', {
      args: { blueprint: 'client-report', theme: 'consulting' },
      result: { ok: true, workspace: { handle: 'ws-brief', revision: 1 } },
    }),
    call(3, 'jto_workspace_patch', { args: { handle: 'ws-own' } }),
    call(4, 'jto_workspace_patch', { args: { handle: 'ws-brief' } }),
    call(5, 'jto_validate', { args: { handle: 'ws-brief' } }),
    call(6, 'jto_workspace_create', {
      result: { ok: true, workspace: { handle: 'ws-third', revision: 1 } },
    }),
    call(7, 'jto_generate', {
      args: {
        format: 'docx',
        handle: 'ws-brief',
        ...(options.inline && { outputMode: 'base64' }),
      },
      result: {
        ok: true,
        diagnostics: { total: 0, errors: [], warnings: [] },
        source: { origin: 'workspace', handle: 'ws-brief', revision: 3 },
        artifact: options.inline
          ? { mode: 'base64', bytes: artifactBytes.length }
          : {
              mode: 'path',
              path: artifactFile,
              bytes: artifactBytes.length,
            },
      },
      delivered: {
        sha256: sha256(documentText),
        bytes: documentText.length,
        file: documentFile,
        handle: 'ws-brief',
        revision: 3,
        artifactSha256: sha256(artifactBytes),
      },
    }),
  ];
  const journal = path.join(dir, 'journal.jsonl');
  await fs.writeFile(
    journal,
    `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  return { dir, journal, out: path.join(dir, 'desktop-pairs') };
}

async function run(argv: string[]) {
  const lines: string[] = [];
  const code = await main(argv, (text) => lines.push(text));
  return { code, output: lines.join('\n') };
}

describe('pnpm desktop import, from a launch several chats shared', () => {
  it('refuses while another workspace in the session is neither a run nor excluded', async () => {
    const { journal, out } = await sharedLaunch();
    const { code, output } = await run([
      'import',
      '--journal',
      journal,
      '--run',
      'cr-market-entry-nordics=s-mix00001@ws-brief',
      '--model',
      'claude-sonnet-5',
      '--out',
      out,
    ]);
    expect(code).toBe(1);
    expect(output).toContain('s-mix00001@ws-own');
    expect(output).toContain('s-mix00001@ws-third');
  });

  it('imports the brief from its own workspace and records what was left out', async () => {
    const { journal, out } = await sharedLaunch();
    const { code, output } = await run([
      'import',
      '--journal',
      journal,
      '--run',
      'cr-market-entry-nordics=s-mix00001@ws-brief',
      '--exclude',
      "s-mix00001@ws-own=the reviewer's own document, another chat",
      '--exclude',
      's-mix00001@ws-third=opened and never used',
      '--model',
      'claude-sonnet-5',
      '--out',
      out,
    ]);
    expect(code, output).toBe(0);

    const desktop = JSON.parse(
      await fs.readFile(
        path.join(out, 'runs', 'cr-market-entry-nordics', 'desktop.json'),
        'utf8'
      )
    );
    expect(desktop).toMatchObject({
      session: 's-mix00001',
      workspace: 'ws-brief',
      calls: { kept: 5, inSession: 7 },
    });
    const scorecard = JSON.parse(
      await fs.readFile(path.join(out, 'scorecard.json'), 'utf8')
    );
    expect(scorecard.runs[0]).toMatchObject({
      outcome: 'completed',
      toolCalls: 5,
    });
    expect(scorecard.manifest.host).toMatchObject({
      workspaces: { 'cr-market-entry-nordics': 's-mix00001@ws-brief' },
      excluded: {
        's-mix00001@ws-own': "the reviewer's own document, another chat",
        's-mix00001@ws-third': 'opened and never used',
      },
    });
  });

  it('counts a document handed back inline as delivered, not as a missing file', async () => {
    const { journal, out } = await sharedLaunch({ inline: true });
    const { code, output } = await run([
      'import',
      '--journal',
      journal,
      '--run',
      'cr-market-entry-nordics=s-mix00001@ws-brief',
      '--exclude',
      's-mix00001@ws-own=another chat',
      '--exclude',
      's-mix00001@ws-third=another chat',
      '--model',
      'claude-sonnet-5',
      '--out',
      out,
    ]);
    expect(code, output).toBe(0);
    const desktop = JSON.parse(
      await fs.readFile(
        path.join(out, 'runs', 'cr-market-entry-nordics', 'desktop.json'),
        'utf8'
      )
    );
    expect(desktop.delivery).toMatchObject({
      documentVerified: true,
      artifactInline: true,
    });
    expect(output).toContain('completed');
  });
});

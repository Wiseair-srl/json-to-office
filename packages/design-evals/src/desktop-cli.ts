#!/usr/bin/env tsx
/**
 * `pnpm desktop` — measure Claude Desktop sessions beside headless runs (#422).
 *
 *   pnpm desktop prompt <brief>
 *     Print the exact prompt the headless runner sends for a brief, to paste
 *     into a new Desktop conversation, so both hosts are asked the same thing.
 *
 *   pnpm desktop sessions --journal <file>
 *     List every session the server journalled: when it ran, how many calls,
 *     the blueprint and theme it scaffolded, what it delivered. This is how a
 *     session is matched to the brief it answered.
 *
 *   pnpm desktop import --journal <file> --run <brief>=<session>… --model <id>
 *                       [--app-version <v>] [--skill <dir>] --out <dir>
 *     Turn those sessions into a run set shaped exactly like `pnpm evals`
 *     output — runs/<brief>/{transcript,document,desktop}.json, a contact
 *     sheet, a scorecard — with the delivered document checked against the
 *     digest the server recorded and the artifact against its size.
 *
 *   pnpm desktop compare --desktop <dir> --headless <dir> --out <file.md>
 *     Brief by brief and format by format: delivery, integrity, iterations,
 *     loop use and — from `sitting-<question>.json` in each directory, when
 *     both were judged in one sitting — the frozen definition's verdict.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { AgentEvent } from './agent.js';
import { analyzeDocument } from './analyze.js';
import { assignments, runWithInkLines, type Line } from './cli-lines.js';
import { briefsById, developmentCorpusDir, loadCorpus } from './corpus.js';
import {
  desktopAccounting,
  desktopEvents,
  loopUsage,
  parseJournal,
  summarizeSessions,
} from './desktop.js';
import {
  compareHosts,
  hostComparisonMarkdown,
  type HostRun,
} from './host-compare.js';
import { buildManifest } from './manifest.js';
import { documentMetrics, failedRun, type RunMetrics } from './metrics.js';
import { comparableRuns, type RecordedRun } from './rejudge.js';
import { renderForJudging } from './render.js';
import { briefPrompt } from './runner.js';
import { buildScorecard } from './scorecard.js';
import { loadShippingSemantics, loadSitting } from './shipping-calibration.js';
import { hasIntegrityDefect, pageDefects, ships } from './shipping.js';
import { loadSkill } from './skill.js';

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

/** The exact prompt the headless runner sends for a brief. */
async function promptText(briefId: string): Promise<string> {
  const corpus = await loadCorpus(developmentCorpusDir(), 'development');
  const [brief] = briefsById(corpus, [briefId]);
  return briefPrompt(brief);
}

async function sessions(argv: readonly string[], line: Line): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { journal: { type: 'string' } },
  });
  const journalFile = values.journal;
  if (!journalFile) {
    line('usage: pnpm desktop sessions --journal <file>');
    return 1;
  }
  const journal = parseJournal(await fs.readFile(journalFile, 'utf8'));
  for (const entry of summarizeSessions(journal)) {
    line(
      `${entry.id}  ${entry.startedAt}  ${String(entry.calls).padStart(3)} call(s)` +
        (entry.blueprint ? `  ${entry.blueprint}/${entry.theme ?? '?'}` : '') +
        (entry.delivered ? `  -> ${entry.delivered}` : '')
    );
  }
  return 0;
}

async function importSessions(
  argv: readonly string[],
  repoRoot: string,
  line: Line
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      journal: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string' },
      run: { type: 'string', multiple: true },
      'app-version': { type: 'string' },
      skill: { type: 'string' },
    },
  });
  const journalFile = values.journal;
  const out = values.out;
  const model = values.model;
  const mappings = assignments(values.run, 'run').map(([briefId, session]) => ({
    briefId,
    session,
  }));
  if (!journalFile || !out || !model || mappings.length === 0) {
    line(
      'usage: pnpm desktop import --journal <file> --run <brief>=<session>… --model <id> [--app-version <v>] [--skill <dir>] --out <dir>'
    );
    return 1;
  }
  const appVersion = values['app-version'];
  const skillDir = values.skill;
  const skill = skillDir ? await loadSkill(skillDir) : undefined;
  const journal = parseJournal(await fs.readFile(journalFile, 'utf8'));
  const corpus = await loadCorpus(developmentCorpusDir(), 'development');
  const briefs = briefsById(
    corpus,
    mappings.map((mapping) => mapping.briefId)
  );
  const shipping = await loadShippingSemantics(
    path.join(repoRoot, 'packages/design-evals/baselines')
  );

  const runs: RunMetrics[] = [];
  for (const mapping of mappings) {
    const brief = briefs.find((entry) => entry.id === mapping.briefId)!;
    const session = journal.sessions.find(
      (entry) => entry.id === mapping.session
    );
    if (!session)
      throw new Error(`The journal has no session ${mapping.session}.`);
    const accounting = desktopAccounting(session);
    const runDir = path.join(out, 'runs', brief.id);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, 'transcript.json'),
      JSON.stringify(
        {
          briefId: brief.id,
          format: brief.format,
          briefHash: brief.hash,
          host: 'claude-desktop',
          session: session.id,
          facts: session.facts,
          events: desktopEvents(session),
        },
        null,
        2
      )
    );
    const partial = {
      iterations: accounting.iterations,
      toolCalls: accounting.toolCalls,
      environmentFailures: accounting.environmentFailures,
      wallMs: accounting.wallMs,
      cost: { inputTokens: 0, outputTokens: 0, usageComplete: false },
    };

    const delivery: Record<string, unknown> = { ...accounting.delivered };
    let run: RunMetrics;
    if (!accounting.delivered) {
      run = failedRun(
        brief.id,
        brief.format,
        accounting.loop.generations > 0
          ? 'the final jto_generate did not deliver'
          : 'the Desktop session ended without generating a document',
        partial
      );
    } else {
      const text = await fs.readFile(accounting.delivered.documentFile, 'utf8');
      const digest = createHash('sha256').update(text).digest('hex');
      delivery.documentVerified =
        digest === accounting.delivered.documentSha256;
      try {
        const stat = await fs.stat(accounting.delivered.artifact ?? '');
        delivery.artifactExists = true;
        delivery.artifactBytesMatch = stat.size === accounting.delivered.bytes;
      } catch {
        delivery.artifactExists = false;
      }
      if (!delivery.documentVerified) {
        run = failedRun(
          brief.id,
          brief.format,
          'the delivered document does not match the digest the server recorded',
          partial
        );
      } else {
        const document = JSON.parse(text) as unknown;
        await fs.writeFile(
          path.join(runDir, 'document.json'),
          JSON.stringify(document, null, 2)
        );
        const measured = await analyzeDocument(brief.format, document);
        const rendered = await renderForJudging(brief.format, document);
        await fs.writeFile(
          path.join(runDir, 'contact-sheet.png'),
          rendered.sheet.png
        );
        run = {
          briefId: brief.id,
          format: brief.format,
          outcome: 'completed',
          ...documentMetrics({
            diagnostics: measured.diagnostics,
            pages: measured.pages,
          }),
          pageCountSource: measured.pageCountSource,
          turns: 0,
          foreignTools: [],
          retries: 0,
          ...partial,
        };
      }
    }
    runs.push(run);
    await fs.writeFile(
      path.join(runDir, 'desktop.json'),
      JSON.stringify(
        {
          session: session.id,
          startedAt: session.startedAt,
          facts: session.facts,
          model,
          ...(appVersion && { appVersion }),
          delivery,
          loop: accounting.loop,
          // Desktop does not report these to anyone; recorded as unknown, not zero.
          unobservable: ['turns', 'tokens', 'foreignTools'],
        },
        null,
        2
      )
    );
    line(
      `  ${brief.id} <- ${session.id}: ${run.outcome}${run.failure ? ` (${run.failure})` : ''}, ` +
        `${run.iterations} iteration(s), ${run.toolCalls} call(s)`
    );
  }

  const { SERVER_INSTRUCTIONS } = await import('@json-to-office/mcp-server');
  const scorecard = buildScorecard({
    runs,
    manifest: {
      ...buildManifest({
        repoRoot,
        model,
        modelParameters: { host: 'claude-desktop' },
        serverInstructions: SERVER_INSTRUCTIONS,
        ...(skill !== undefined && { skill }),
        mode: skill ? 'assisted' : 'cold',
        maxRetries: 0,
        agentSdkVersion: `claude-desktop ${appVersion ?? 'unrecorded'}`,
      }),
      host: {
        kind: 'claude-desktop',
        ...(appVersion && { appVersion }),
        journal: path.resolve(journalFile),
        serverVersions: [
          ...new Set(
            mappings.map((mapping) => {
              const facts = journal.sessions.find(
                (entry) => entry.id === mapping.session
              )?.facts;
              return facts?.server?.version ?? 'unrecorded';
            })
          ),
        ],
      },
    },
    corpus: {
      kind: corpus.kind,
      hash: corpus.hash,
      stratification: corpus.stratification,
      briefIds: briefs.map((brief) => brief.id),
    },
    archetypes: Object.fromEntries(
      briefs.map((brief) => [brief.id, brief.archetype])
    ),
    shipping,
  });
  await fs.writeFile(
    path.join(out, 'scorecard.json'),
    JSON.stringify(scorecard, null, 2)
  );
  line(path.join(out, 'scorecard.json'));
  return 0;
}

/** A set's runs as the comparison reads them, with the shared sitting when there is one. */
async function hostRuns(dir: string, repoRoot: string): Promise<HostRun[]> {
  const scorecard = await readJson<{
    runs: Array<RecordedRun & RunMetrics>;
  }>(path.join(dir, 'scorecard.json'));
  const semantics = await loadShippingSemantics(
    path.join(repoRoot, 'packages/design-evals/baselines')
  );
  // One sitting over both sets is what makes their verdicts comparable; a set
  // without one falls back to the verdicts its own run recorded.
  const sitting =
    (
      await loadSitting(
        path.join(dir, `sitting-${semantics.definition.question}.json`),
        semantics.definition.question
      )
    )?.verdicts ?? {};
  const runs: HostRun[] = [];
  for (const run of comparableRuns(scorecard.runs)) {
    const { events } = await readJson<{ events: AgentEvent[] }>(
      path.join(dir, 'runs', run.label, 'transcript.json')
    );
    const verdict = sitting[run.label] ?? run.judge;
    const decision = ships(semantics.definition, {
      outcome: run.outcome,
      qualityByCode: run.qualityByCode,
      ...(verdict && { judge: verdict }),
    });
    runs.push({
      briefId: run.briefId,
      format: run.format,
      outcome: run.outcome,
      iterations: run.iterations,
      toolCalls: run.toolCalls,
      pages: run.pages,
      integrityDefect:
        run.outcome === 'failed' || hasIntegrityDefect(run.qualityByCode),
      pageDefects: pageDefects(run.qualityByCode),
      environmentFailures: (run.environmentFailures ?? []).length,
      loop: loopUsage(events),
      ...(verdict && { level: verdict.level }),
      ...(decision !== undefined && { ships: decision }),
    });
  }
  return runs;
}

async function compare(
  argv: readonly string[],
  repoRoot: string,
  line: Line
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      desktop: { type: 'string' },
      headless: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const desktopDir = values.desktop;
  const headlessDir = values.headless;
  const out = values.out;
  if (!desktopDir || !headlessDir || !out) {
    line(
      'usage: pnpm desktop compare --desktop <dir> --headless <dir> --out <file.md>'
    );
    return 1;
  }
  const comparison = compareHosts(
    await hostRuns(desktopDir, repoRoot),
    await hostRuns(headlessDir, repoRoot)
  );
  const markdown = out.endsWith('.md') ? out : `${out}.md`;
  await fs.writeFile(markdown, hostComparisonMarkdown(comparison));
  await fs.writeFile(
    `${markdown.slice(0, -'.md'.length)}.json`,
    JSON.stringify(comparison, null, 2)
  );
  line(hostComparisonMarkdown(comparison));
  line(markdown);
  return 0;
}

export async function main(
  argv: readonly string[],
  line: Line
): Promise<number> {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
  );
  const [command, ...rest] = argv;
  switch (command) {
    case 'prompt':
      if (!rest[0]) {
        line('usage: pnpm desktop prompt <brief>');
        return 1;
      }
      for (const text of (await promptText(rest[0])).split('\n')) line(text);
      return 0;
    case 'sessions':
      return sessions(rest, line);
    case 'import':
      return importSessions(rest, repoRoot, line);
    case 'compare':
      return compare(rest, repoRoot, line);
    default:
      line('usage: pnpm desktop <prompt|sessions|import|compare> …');
      return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('desktop-cli.ts')) {
  const argv = process.argv.slice(2).filter((arg) => arg !== '--');
  if (argv[0] === 'prompt' && argv[1]) {
    // Data, not a view: pasted into Desktop as is, so no terminal may rewrap it.
    process.stdout.write(`${await promptText(argv[1])}\n`);
  } else {
    process.exitCode = await runWithInkLines(main, argv);
  }
}

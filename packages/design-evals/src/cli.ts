#!/usr/bin/env tsx
/**
 * `pnpm evals` — one command, one scorecard.
 *
 * Manual on purpose. This spends money and takes real time, and the spec is
 * explicit that no PR is gated on it: a scorecard is an instrument you pick
 * up when you want to know something, not a check that runs behind you.
 *
 * The run is serial. Parallel runs would finish sooner and would share a
 * LibreOffice profile, a preview cache and a rate limit between them, which is
 * three ways for one brief's result to depend on another's.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OUTPUT_DIR_ENV, WORKSPACE_DIR_ENV } from '@json-to-office/mcp-server';

import { sdkAgentDriver } from './agent.js';
import { analyzeDocument } from './analyze.js';
import { anthropicVision, judgeDocument } from './judge.js';
import { renderForJudging } from './render.js';
import {
  developmentCorpusDir,
  loadCorpus,
  selectBriefs,
  type Brief,
  type Corpus,
} from './corpus.js';
import { buildManifest } from './manifest.js';
import type { RunMetrics } from './metrics.js';
import { runBrief } from './runner.js';
import { buildScorecard } from './scorecard.js';

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_JUDGE_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TURNS = 40;
const DEFAULT_MAX_RETRIES = 1;

export interface CliOptions {
  corpusDir: string;
  sealed: boolean;
  briefs?: string;
  model: string;
  maxTurns: number;
  maxRetries: number;
  outDir: string;
  mode: 'cold' | 'assisted';
  skillPath?: string;
  /** Vision model that scores the rubric; omitted means hard metrics only. */
  judgeModel?: string;
  /** Runs per brief. Three at final acceptance, so run variance is visible. */
  repeat: number;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }

  const sealedDir = values.get('sealed-corpus');
  return {
    corpusDir: sealedDir ?? values.get('corpus') ?? developmentCorpusDir(),
    sealed: sealedDir !== undefined,
    ...(values.get('briefs') !== undefined && {
      briefs: values.get('briefs') as string,
    }),
    model: values.get('model') ?? DEFAULT_MODEL,
    maxTurns: Number(values.get('max-turns') ?? DEFAULT_MAX_TURNS),
    maxRetries: Number(values.get('max-retries') ?? DEFAULT_MAX_RETRIES),
    outDir:
      values.get('out') ??
      path.join(process.cwd(), 'evals-out', new Date().toISOString()),
    mode: flags.has('assisted') || values.get('skill') ? 'assisted' : 'cold',
    ...(values.get('skill') !== undefined && {
      skillPath: values.get('skill') as string,
    }),
    ...((flags.has('judge') || values.get('judge') !== undefined) && {
      judgeModel: values.get('judge') ?? DEFAULT_JUDGE_MODEL,
    }),
    repeat: Math.max(1, Number(values.get('repeat') ?? 1)),
  };
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

/** The stdio command that serves json-to-office to the agent under test. */
export function serverCommand(
  root: string,
  workspaceRoot: string
): {
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  const env: Record<string, string> = {};
  for (const name of [
    'PATH',
    'HOME',
    'LIBREOFFICE_PATH',
    'PDFTOPPM_PATH',
    OUTPUT_DIR_ENV,
    'HIGHCHARTS_SERVER_URL',
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  // Not copied from the environment: the harness READS this directory to
  // recover what the agent generated, so the server has to be writing to the
  // same one. Leaving it unset let the server keep workspaces in memory while
  // the harness looked for them on disk, and every agent that authored through
  // a handle — the thing the server's own instructions tell it to do — was
  // scored as having generated nothing.
  //
  // Imported rather than spelled out: guessing this name is what broke it the
  // first time. `JTO_WORKSPACE_DIR` looks right and the server reads
  // `JTO_MCP_WORKSPACE_DIR`, so the variable was set, ignored, and silent.
  env[WORKSPACE_DIR_ENV] = workspaceRoot;
  return {
    command: process.execPath,
    args: [path.join(root, 'packages/mcp-server/dist/cli.js')],
    env,
  };
}

function line(text: string): void {
  process.stderr.write(`${text}\n`);
}

function duration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  const root = repoRoot();

  let corpus: Corpus;
  try {
    corpus = await loadCorpus(
      options.corpusDir,
      options.sealed ? 'sealed' : 'development'
    );
  } catch (error) {
    line(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const briefs = selectBriefs(corpus, options.briefs);
  const workspaceRoot =
    process.env[WORKSPACE_DIR_ENV] ??
    (await fs.mkdtemp(path.join(os.tmpdir(), 'jto-evals-ws-')));
  const skill = options.skillPath
    ? await fs.readFile(options.skillPath, 'utf8')
    : undefined;

  const { SERVER_INSTRUCTIONS } = await import('@json-to-office/mcp-server');

  await fs.mkdir(options.outDir, { recursive: true });
  line(
    `${briefs.length} brief(s), ${options.mode}, model ${options.model} -> ${options.outDir}`
  );

  // One judge for the whole set, so every document is scored by the same
  // model with the same rubric.
  const judge =
    options.judgeModel === undefined
      ? undefined
      : makeJudge(options.judgeModel);

  const runs: RunMetrics[] = [];
  const started = Date.now();
  const attempts = briefs.flatMap((brief) =>
    Array.from({ length: options.repeat }, (_, pass) => ({ brief, pass }))
  );
  for (const [index, { brief, pass }] of attempts.entries()) {
    const label = options.repeat > 1 ? `${brief.id}#${pass + 1}` : brief.id;
    line(`[${index + 1}/${attempts.length}] ${label}`);
    const run = await runBrief({
      brief,
      ...(judge !== undefined && { judge }),
      runDir: path.join(options.outDir, 'runs', label),
      model: options.model,
      maxTurns: options.maxTurns,
      maxRetries: options.maxRetries,
      driver: sdkAgentDriver,
      analyze: analyzeDocument,
      server: serverCommand(root, workspaceRoot),
      ...(skill !== undefined && { skill }),
      workspaceRoot,
      sealed: options.sealed,
    });
    runs.push(run);
    line(
      `    ${run.outcome}${run.failure ? `: ${run.failure}` : ''} — ` +
        `${run.pages} page(s), ${run.blockingFindings} blocking, ` +
        `${run.toolCalls} tool calls, ${duration(run.wallMs)}` +
        (run.judge
          ? `, judged level ${run.judge.level}${run.judge.wouldShip ? ', would ship' : ''}`
          : '')
    );
  }

  const scorecard = buildScorecard({
    runs,
    manifest: buildManifest({
      repoRoot: root,
      model: options.model,
      modelParameters: { maxTurns: options.maxTurns },
      serverInstructions: SERVER_INSTRUCTIONS,
      ...(skill !== undefined && { skill }),
      mode: options.mode,
      ...(process.env.LIBREOFFICE_PATH && {
        libreofficePath: process.env.LIBREOFFICE_PATH,
      }),
      ...(process.env.PDFTOPPM_PATH && {
        pdftoppmPath: process.env.PDFTOPPM_PATH,
      }),
      ...(process.env.HIGHCHARTS_SERVER_URL && {
        exportServerUrl: process.env.HIGHCHARTS_SERVER_URL,
      }),
      maxRetries: options.maxRetries,
      agentSdkVersion: await agentSdkVersion(root),
    }),
    corpus: {
      kind: corpus.kind,
      hash: corpus.hash,
      stratification: corpus.stratification,
      // A sealed corpus is identified by its hash and its shape, never by the
      // ids of the questions it asks.
      ...(corpus.kind === 'development' && {
        briefIds: briefs.map((brief) => brief.id),
      }),
    },
    archetypes: Object.fromEntries(
      briefs.map((brief) => [brief.id, brief.archetype])
    ),
  });

  const scorecardPath = path.join(options.outDir, 'scorecard.json');
  await fs.writeFile(scorecardPath, JSON.stringify(scorecard, null, 2));

  const { totals } = scorecard;
  line('');
  if (!scorecard.judge) {
    // "Builds clean" is a floor, and without this line a reader takes it for
    // the programme's shipping metric — which is the judge's, and unasked.
    line('no judge: nothing here says whether a document is worth sending');
  }
  if (scorecard.judge) {
    line(
      `judge: median level ${scorecard.judge.medianLevel}, ` +
        `${scorecard.judge.wouldShip}/${totals.runs} would ship ` +
        `(${(scorecard.judge.wouldShipRate * 100).toFixed(0)}%), ` +
        `median genericness ${scorecard.judge.medianGenericness}`
    );
  }
  line(
    `${totals.buildsClean}/${totals.runs} build clean ` +
      `(${(totals.buildsCleanRate * 100).toFixed(0)}%), ` +
      `${totals.failed} failed, ` +
      `${totals.withAnyIntegrityDefect} with an integrity defect, ` +
      `median ${totals.medianIterations} iterations ` +
      `(${totals.medianTurns} turns)`
  );
  line(
    `${totals.totalInputTokens + totals.totalOutputTokens} tokens` +
      (totals.totalUsd !== undefined
        ? `, $${totals.totalUsd.toFixed(2)}`
        : '') +
      `, ${duration(Date.now() - started)} wall`
  );
  line(scorecardPath);
  return 0;
}

async function agentSdkVersion(root: string): Promise<string> {
  try {
    const raw = await fs.readFile(
      path.join(
        root,
        'packages/design-evals/node_modules/@anthropic-ai/claude-agent-sdk/package.json'
      ),
      'utf8'
    );
    return (JSON.parse(raw) as { version?: string }).version ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      line(
        error instanceof Error ? error.stack ?? error.message : String(error)
      );
      process.exitCode = 1;
    });
}

/**
 * The judge, as the runner calls it.
 *
 * Renders the produced document the way an author would have looked at it —
 * one contact sheet, every page — and keeps the sheet next to the run, because
 * a verdict nobody can go back and check is not evidence of anything.
 */
function makeJudge(model: string) {
  const vision = anthropicVision({ model });
  return async (input: { brief: Brief; document: unknown; runDir: string }) => {
    const rendered = await renderForJudging(input.brief.format, input.document);
    // Into the run's own directory, which under `--repeat` is not the same as
    // the brief's: `runs/<id>#2` exists, `runs/<id>` does not, and writing to
    // the second lost every verdict after the first pass.
    await fs.writeFile(
      path.join(input.runDir, 'contact-sheet.png'),
      rendered.sheet.png
    );
    const judged = await judgeDocument({
      brief: input.brief,
      sheet: { png: rendered.sheet.png, label: input.brief.id },
      call: vision,
    });
    return judged.verdict;
  };
}

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

import { sdkAgentDriver } from './agent.js';
import { analyzeDocument } from './analyze.js';
import {
  developmentCorpusDir,
  loadCorpus,
  selectBriefs,
  type Corpus,
} from './corpus.js';
import { buildManifest } from './manifest.js';
import type { RunMetrics } from './metrics.js';
import { runBrief } from './runner.js';
import { buildScorecard } from './scorecard.js';

const DEFAULT_MODEL = 'claude-sonnet-5';
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
  };
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

/** The stdio command that serves json-to-office to the agent under test. */
function serverCommand(root: string): {
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
    'JTO_OUTPUT_DIR',
    'JTO_WORKSPACE_DIR',
    'HIGHCHARTS_EXPORT_SERVER_URL',
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
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
    process.env.JTO_WORKSPACE_DIR ??
    (await fs.mkdtemp(path.join(os.tmpdir(), 'jto-evals-ws-')));
  const skill = options.skillPath
    ? await fs.readFile(options.skillPath, 'utf8')
    : undefined;

  const { SERVER_INSTRUCTIONS } = await import('@json-to-office/mcp-server');

  await fs.mkdir(options.outDir, { recursive: true });
  line(
    `${briefs.length} brief(s), ${options.mode}, model ${options.model} -> ${options.outDir}`
  );

  const runs: RunMetrics[] = [];
  const started = Date.now();
  for (const [index, brief] of briefs.entries()) {
    line(`[${index + 1}/${briefs.length}] ${brief.id}`);
    const run = await runBrief({
      brief,
      runDir: path.join(options.outDir, 'runs', brief.id),
      model: options.model,
      maxTurns: options.maxTurns,
      maxRetries: options.maxRetries,
      driver: sdkAgentDriver,
      analyze: analyzeDocument,
      server: serverCommand(root),
      ...(skill !== undefined && { skill }),
      workspaceRoot,
      sealed: options.sealed,
    });
    runs.push(run);
    line(
      `    ${run.outcome}${run.failure ? `: ${run.failure}` : ''} — ` +
        `${run.pages} page(s), ${run.blockingFindings} blocking, ` +
        `${run.toolCalls} tool calls, ${duration(run.wallMs)}`
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
      ...(process.env.HIGHCHARTS_EXPORT_SERVER_URL && {
        exportServerUrl: process.env.HIGHCHARTS_EXPORT_SERVER_URL,
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
  line(
    `${totals.shippable}/${totals.runs} shippable ` +
      `(${(totals.shippableRate * 100).toFixed(0)}%), ` +
      `${totals.failed} failed, ` +
      `${totals.withAnyIntegrityDefect} with an integrity defect, ` +
      `median ${totals.medianIterations} iterations`
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

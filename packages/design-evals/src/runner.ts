/**
 * One brief, start to finish.
 *
 * The run itself is the agent's; the measurement is not. Everything scored
 * here is recomputed by the harness from the document the agent last handed to
 * `jto_generate` — never read out of what the agent said about its own work.
 * An author that declares itself finished with a broken document is exactly
 * the case the scorecard exists to catch, so its self-report is evidence of
 * nothing.
 *
 * Artifacts are kept because a number without the document behind it cannot be
 * argued with. A sealed corpus is the one exception, and only for the brief
 * text: the run is still fully recorded, but nothing it writes discloses the
 * question.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { AgentDriver, AgentEvent } from './agent.js';
import type { RunJudgement } from './metrics.js';
import { SERVER_ALIAS } from './agent.js';
import type { Brief } from './corpus.js';
import { documentMetrics, failedRun, type RunMetrics } from './metrics.js';

/** What the harness asks for, in the fewest words that still ask for it. */
export function briefPrompt(brief: Brief): string {
  return [
    brief.text,
    '',
    `Produce this as a .${brief.format} file using the json-to-office tools available to you.`,
    'Finish by generating the file. Reply with the path it was written to.',
  ].join('\n');
}

export interface AnalyzeDocument {
  (
    format: string,
    document: unknown
  ): Promise<{ diagnostics: readonly unknown[]; pages: number }>;
}

export interface RunBriefOptions {
  brief: Brief;
  /** Where this run's artifacts go. Created if absent. */
  runDir: string;
  model: string;
  maxTurns: number;
  maxRetries: number;
  driver: AgentDriver;
  analyze: AnalyzeDocument;
  server: { command: string; args: string[]; env?: Record<string, string> };
  skill?: string;
  /** Workspace root the server persists to, for a run that authored by handle. */
  workspaceRoot?: string;
  /** True when the brief text must not reach any artifact. */
  sealed: boolean;
  /**
   * Looks at the rendered document and answers the rubric. Optional: hard
   * metrics are the part that does not need an opinion, and a run without a
   * judge is a complete run with half a scorecard rather than a broken one.
   */
  judge?: (input: {
    brief: Brief;
    document: unknown;
    /** This run's directory, so evidence lands beside the run it judged. */
    runDir: string;
  }) => Promise<RunJudgement | undefined>;
  signal?: AbortSignal;
  now?: () => number;
}

const GENERATE_TOOL = `mcp__${SERVER_ALIAS}__jto_generate`;

/**
 * The document a run ended on.
 *
 * Read from the last `jto_generate` call rather than from anything the agent
 * reported, and passively — no instruction tells the author to leave the JSON
 * anywhere, because an instruction like that is guidance, and a cold run is
 * supposed to have none. When the call carried a workspace handle instead of a
 * document, the document is fetched from where the server persisted it.
 */
export async function finalDocument(
  events: readonly AgentEvent[],
  workspaceRoot: string | undefined
): Promise<unknown | undefined> {
  const generates = events.filter(
    (event): event is Extract<AgentEvent, { type: 'tool_use' }> =>
      event.type === 'tool_use' && event.name === GENERATE_TOOL
  );
  const last = generates[generates.length - 1];
  if (!last) return undefined;

  const inline = last.input.document;
  if (inline !== undefined && inline !== null) return inline;

  const handle = last.input.handle;
  if (typeof handle !== 'string' || workspaceRoot === undefined) {
    return undefined;
  }
  return readWorkspaceDocument(path.join(workspaceRoot, handle));
}

/** The head revision a workspace directory holds, or undefined. */
export async function readWorkspaceDocument(
  directory: string
): Promise<unknown | undefined> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return undefined;
  }
  const revisions = names
    .map((name) => /^(?:rev-)?(\d+)\.json$/.exec(name))
    .filter((found): found is RegExpExecArray => found !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const revision of revisions) {
    try {
      return JSON.parse(
        await fs.readFile(path.join(directory, revision[0]), 'utf8')
      );
    } catch {
      // A half-written revision is not the head; try the one before it.
    }
  }
  return undefined;
}

interface Attempt {
  events: AgentEvent[];
  result?: Extract<AgentEvent, { type: 'result' }>;
}

async function attempt(
  options: RunBriefOptions,
  prompt: string
): Promise<Attempt> {
  const events: AgentEvent[] = [];
  let result: Extract<AgentEvent, { type: 'result' }> | undefined;
  for await (const event of options.driver({
    prompt,
    model: options.model,
    maxTurns: options.maxTurns,
    server: options.server,
    ...(options.skill !== undefined && { skill: options.skill }),
    cwd: options.runDir,
    ...(options.signal && { signal: options.signal }),
  })) {
    events.push(event);
    if (event.type === 'result') result = event;
  }
  return { events, ...(result && { result }) };
}

/**
 * Run one brief and measure what came out.
 *
 * Retries are counted, not hidden: a transport error that cost a second
 * attempt is part of what the run cost, and a harness that quietly re-rolls
 * until something works is measuring its own persistence.
 */
export async function runBrief(options: RunBriefOptions): Promise<RunMetrics> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  await fs.mkdir(options.runDir, { recursive: true });

  const prompt = briefPrompt(options.brief);
  let attempts = 0;
  let last: Attempt | undefined;

  while (attempts <= options.maxRetries) {
    attempts += 1;
    try {
      last = await attempt(options, prompt);
      if (last.result?.ok === true) break;
    } catch (error) {
      last = {
        events: [],
        result: {
          type: 'result',
          ok: false,
          turns: 0,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  const retries = attempts - 1;
  const events = last?.events ?? [];
  const toolCalls = events.filter((event) => event.type === 'tool_use').length;
  const result = last?.result;
  const wallMs = now() - started;

  await writeArtifacts(options, { events, prompt });

  if (!result || !result.ok) {
    return failedRun(
      options.brief.id,
      options.brief.format,
      result?.error ?? 'the agent session produced no result',
      { toolCalls, retries, wallMs, iterations: result?.turns ?? 0 }
    );
  }

  const document = await finalDocument(events, options.workspaceRoot);
  if (document === undefined) {
    // Two very different failures, and telling them apart matters more than it
    // looks. A session that generated nothing is an authoring failure and a
    // real product result. A session that DID call `jto_generate` and whose
    // document the harness then could not recover is a measurement failure —
    // and one that lands hardest on agents authoring through a workspace
    // handle, which is exactly what the server's instructions tell them to do.
    // Reporting the second as the first would quietly penalise the recommended
    // path and read as a product regression.
    const generated = events.some(
      (event) => event.type === 'tool_use' && event.name === GENERATE_TOOL
    );
    return failedRun(
      options.brief.id,
      options.brief.format,
      generated
        ? 'HARNESS: jto_generate was called but the document could not be recovered — check that the server and the harness share a workspace directory'
        : 'the session ended without generating a document',
      {
        toolCalls,
        retries,
        wallMs,
        iterations: result.turns,
        cost: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          ...(result.usd !== undefined && { usd: result.usd }),
        },
      }
    );
  }

  await fs.writeFile(
    path.join(options.runDir, 'document.json'),
    JSON.stringify(document, null, 2)
  );

  let measured;
  try {
    measured = await options.analyze(options.brief.format, document);
  } catch (error) {
    return failedRun(
      options.brief.id,
      options.brief.format,
      `the produced document could not be analyzed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { toolCalls, retries, wallMs, iterations: result.turns }
    );
  }

  // After the measurement, never before: a judge that failed must not lose the
  // hard numbers, which are the half that does not depend on anyone's taste.
  let judgement: RunJudgement | undefined;
  if (options.judge) {
    try {
      judgement = await options.judge({
        brief: options.brief,
        document,
        runDir: options.runDir,
      });
    } catch {
      judgement = undefined;
    }
  }

  return {
    briefId: options.brief.id,
    format: options.brief.format,
    outcome: 'completed',
    ...documentMetrics({
      diagnostics: measured.diagnostics as readonly {
        code?: unknown;
        severity?: unknown;
        blocking?: unknown;
      }[],
      pages: measured.pages,
    }),
    iterations: result.turns,
    toolCalls,
    cost: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ...(result.usd !== undefined && { usd: result.usd }),
    },
    wallMs,
    retries,
    ...(judgement !== undefined && { judge: judgement }),
  };
}

/**
 * Everything the run did, on disk.
 *
 * The transcript is the tool calls, which is what a later argument about a
 * score is actually about. Under a sealed corpus the prompt is replaced by the
 * brief's hash — the run stays fully identified, and the question stays
 * unpublished.
 */
async function writeArtifacts(
  options: RunBriefOptions,
  run: { events: readonly AgentEvent[]; prompt: string }
): Promise<void> {
  await fs.writeFile(
    path.join(options.runDir, 'transcript.json'),
    JSON.stringify(
      {
        briefId: options.brief.id,
        format: options.brief.format,
        briefHash: options.brief.hash,
        prompt: options.sealed ? `[sealed:${options.brief.hash}]` : run.prompt,
        events: run.events,
      },
      null,
      2
    )
  );
}

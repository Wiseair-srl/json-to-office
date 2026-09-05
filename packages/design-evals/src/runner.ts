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
  ): Promise<{
    diagnostics: readonly unknown[];
    pages: number;
    pageCountSource?: 'rendered' | 'structural';
  }>;
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
const PATCH_TOOL = `mcp__${SERVER_ALIAS}__jto_workspace_patch`;
const CREATE_TOOL = `mcp__${SERVER_ALIAS}__jto_workspace_create`;

/**
 * Edit-and-recheck rounds after the first complete draft.
 *
 * The spec's "median author iterations to done", whose target is 2 and whose
 * estimated value today is 4-6. That is a count of repairs, not of turns: an
 * agent that drafts once, looks at a preview, fixes two slides and ships has
 * iterated twice, whatever number of messages it took to do it.
 *
 * So it counts document MUTATIONS past the first — every workspace patch, and
 * every re-draft or re-generate after the initial one. A run that got it right
 * first time scores 0, which is the number that deserves to be there.
 */
/**
 * Tool calls that did not go through the json-to-office server.
 *
 * A cold run is supposed to have none: the whole claim is "this is what the
 * product alone gets you". The first working smoke run had Bash, Write, Read,
 * Agent and ScheduleWakeup in it, and nothing in the scorecard said so — the
 * numbers looked clean and measured something else entirely. Counted now, so a
 * contaminated run cannot be quietly averaged into a baseline.
 */
export function countForeignTools(events: readonly AgentEvent[]): string[] {
  const prefix = `mcp__${SERVER_ALIAS}__`;
  return [
    ...new Set(
      events
        .filter(
          (event): event is Extract<AgentEvent, { type: 'tool_use' }> =>
            event.type === 'tool_use' && !event.name.startsWith(prefix)
        )
        .map((event) => event.name)
    ),
  ].sort();
}

export function countIterations(events: readonly AgentEvent[]): number {
  const tools = events.filter(
    (event): event is Extract<AgentEvent, { type: 'tool_use' }> =>
      event.type === 'tool_use'
  );
  const patches = tools.filter((event) => event.name === PATCH_TOOL).length;
  const drafts = tools.filter(
    (event) => event.name === CREATE_TOOL || event.name === GENERATE_TOOL
  ).length;
  // The first create and the first generate are the draft, not a repair.
  return patches + Math.max(0, drafts - 2);
}

/**
 * The document a run ended on.
 *
 * Read from the last `jto_generate` call rather than from anything the agent
 * reported, and passively — no instruction tells the author to leave the JSON
 * anywhere, because an instruction like that is guidance, and a cold run is
 * supposed to have none. When the call carried a workspace handle instead of a
 * document, the document is fetched from where the server persisted it.
 */
function lastGeneration(events: readonly AgentEvent[]) {
  const calls = events.filter(
    (event): event is Extract<AgentEvent, { type: 'tool_use' }> =>
      event.type === 'tool_use' && event.name === GENERATE_TOOL
  );
  return calls[calls.length - 1];
}

/** Only a matching tool response proves delivery; session success does not. */
function generationPayload(
  events: readonly AgentEvent[]
): Record<string, unknown> | undefined {
  const call = lastGeneration(events);
  if (!call?.id) return undefined;
  const response = events.find(
    (event): event is Extract<AgentEvent, { type: 'tool_result' }> =>
      event.type === 'tool_result' && event.toolUseId === call.id
  );
  if (!response || response.isError) return undefined;
  const texts =
    typeof response.content === 'string'
      ? [response.content]
      : Array.isArray(response.content)
        ? response.content.flatMap((block) =>
            block?.type === 'text' && typeof block.text === 'string'
              ? [block.text]
              : []
          )
        : [];
  for (const text of texts) {
    try {
      const payload = JSON.parse(text);
      const artifact = payload?.artifact;
      if (
        payload?.ok === true &&
        artifact?.bytes > 0 &&
        ((artifact.mode === 'path' &&
          typeof artifact.path === 'string' &&
          artifact.path.length > 0) ||
          (artifact.mode === 'base64' &&
            typeof artifact.base64 === 'string' &&
            artifact.base64.length > 0))
      ) {
        return payload;
      }
    } catch {
      // Non-JSON tool output is not evidence of a generated artifact.
    }
  }
  return undefined;
}

export async function finalDocument(
  events: readonly AgentEvent[],
  workspaceRoot: string | undefined
): Promise<unknown | undefined> {
  const last = lastGeneration(events);
  const payload = generationPayload(events);
  if (!last || !payload) return undefined;
  const inline = last.input.document;
  if (inline !== undefined && inline !== null) return inline;
  const source = payload.source as
    | { handle?: unknown; revision?: unknown }
    | undefined;
  const handle = last.input.handle;
  if (
    typeof handle !== 'string' ||
    workspaceRoot === undefined ||
    source?.handle !== handle ||
    !Number.isInteger(source.revision) ||
    (source.revision as number) < 1 ||
    path.basename(handle) !== handle
  ) {
    return undefined;
  }
  // Later patches must not change the document the scorecard measures.
  return readWorkspaceDocument(
    path.join(workspaceRoot, handle),
    source.revision as number
  );
}

/** Read an exact generated revision, or the head for callers without a pin. */
export async function readWorkspaceDocument(
  directory: string,
  revision?: number
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
    .filter((found) => revision === undefined || Number(found[1]) === revision)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const entry of revisions) {
    try {
      return JSON.parse(
        await fs.readFile(path.join(directory, entry[0]), 'utf8')
      );
    } catch {
      // Never substitute a different revision for a generated one.
    }
  }
  return undefined;
}

interface Attempt {
  usageComplete: boolean;
  events: AgentEvent[];
  result?: Extract<AgentEvent, { type: 'result' }>;
}

async function attempt(
  options: RunBriefOptions,
  prompt: string
): Promise<Attempt> {
  const events: AgentEvent[] = [];
  let usageComplete = false;
  let result: Extract<AgentEvent, { type: 'result' }> | undefined;
  try {
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
      if (event.type === 'result') {
        result = event;
        usageComplete = true;
      }
    }
  } catch (error) {
    result = {
      type: 'result',
      ok: false,
      turns: result?.turns ?? 0,
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      ...(result?.usd !== undefined && { usd: result.usd }),
      ...(result?.credential !== undefined && {
        credential: result.credential,
      }),
      durationMs: result?.durationMs ?? 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { events, usageComplete, ...(result && { result }) };
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
  const attempts: Attempt[] = [];
  let last: Attempt;
  do {
    last = await attempt(options, prompt);
    attempts.push(last);
  } while (
    !last.result?.ok &&
    attempts.length <= options.maxRetries &&
    !options.signal?.aborted
  );

  const events = attempts.flatMap((entry) => entry.events);
  const results = attempts.flatMap((entry) =>
    entry.result ? [entry.result] : []
  );
  const usd = results.flatMap((entry) =>
    entry.usd === undefined ? [] : [entry.usd]
  );
  const credentials = [
    ...new Set(
      results.flatMap((entry) => (entry.credential ? [entry.credential] : []))
    ),
  ];
  const accounting = {
    retries: attempts.length - 1,
    toolCalls: events.filter((event) => event.type === 'tool_use').length,
    foreignTools: countForeignTools(events),
    iterations: attempts.reduce(
      (sum, entry) => sum + countIterations(entry.events),
      0
    ),
    turns: results.reduce((sum, entry) => sum + entry.turns, 0),
    wallMs: now() - started,
    cost: {
      usageComplete: attempts.every((entry) => entry.usageComplete),
      inputTokens: results.reduce((sum, entry) => sum + entry.inputTokens, 0),
      outputTokens: results.reduce((sum, entry) => sum + entry.outputTokens, 0),
      ...(usd.length > 0 && {
        usd: usd.reduce((sum, value) => sum + value, 0),
      }),
      ...(credentials.length > 0 && { credential: credentials.join(',') }),
    },
  };
  await writeArtifacts(options, { events, prompt, attempts });
  if (!last.result?.ok) {
    return failedRun(
      options.brief.id,
      options.brief.format,
      last.result?.error ?? 'the agent session produced no result',
      accounting
    );
  }
  if (!generationPayload(last.events)) {
    return failedRun(
      options.brief.id,
      options.brief.format,
      lastGeneration(last.events)
        ? 'the final jto_generate did not confirm artifact delivery'
        : 'the session ended without generating a document',
      accounting
    );
  }

  const document = await finalDocument(last.events, options.workspaceRoot);
  if (document === undefined) {
    return failedRun(
      options.brief.id,
      options.brief.format,
      'HARNESS: generated document could not be recovered — check the workspace directory and generated revision',
      accounting
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
      accounting
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
    pageCountSource: measured.pageCountSource ?? 'structural',
    ...accounting,
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
  run: { events: readonly AgentEvent[]; prompt: string; attempts: Attempt[] }
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
        attempts: run.attempts,
      },
      null,
      2
    )
  );
}

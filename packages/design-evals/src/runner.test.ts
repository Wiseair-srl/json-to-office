/**
 * The runner, driven by a scripted agent.
 *
 * Every behaviour worth pinning here is about what the harness does with what
 * an agent did — measure the document rather than believe the summary, count a
 * silent non-delivery as a failure, keep failures in the record. None of that
 * needs a model, and a test that spent money to check its own arithmetic would
 * be a bad trade.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AgentDriver, AgentEvent } from './agent.js';
import type { Brief } from './corpus.js';
import { briefPrompt, finalDocument, runBrief } from './runner.js';

const BRIEF: Brief = {
  id: 'sample-brief',
  format: 'docx',
  archetype: 'client-report',
  language: 'en',
  density: 'medium',
  title: 'A sample brief',
  text: 'Write a short report about something measurable.',
  hash: 'a'.repeat(64),
};

const GENERATE = 'mcp__json-to-office__jto_generate';
const DOCUMENT = { name: 'docx', children: [] };

function driverOf(...events: AgentEvent[]): AgentDriver {
  return async function* () {
    for (const event of events) yield event;
  };
}

const OK_RESULT: AgentEvent = {
  type: 'result',
  ok: true,
  turns: 3,
  inputTokens: 1200,
  outputTokens: 800,
  usd: 0.042,
  durationMs: 9000,
};

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-evals-run-'));
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

function options(overrides: Partial<Parameters<typeof runBrief>[0]> = {}) {
  return {
    brief: BRIEF,
    runDir: path.join(scratch, 'run'),
    model: 'test-model',
    maxTurns: 20,
    maxRetries: 0,
    driver: driverOf(
      { type: 'tool_use', name: GENERATE, input: { document: DOCUMENT } },
      OK_RESULT
    ),
    analyze: async () => ({ diagnostics: [], pages: 4 }),
    server: { command: 'node', args: ['server.js'] },
    sealed: false,
    ...overrides,
  } as Parameters<typeof runBrief>[0];
}

describe('briefPrompt', () => {
  it('asks for the format and for the file, and nothing about design', () => {
    // A cold run measures what the product tells an agent. Anything the
    // harness adds about how the document should look is the harness scoring
    // its own advice.
    const prompt = briefPrompt(BRIEF);
    expect(prompt).toContain(BRIEF.text);
    expect(prompt).toContain('.docx');
    expect(prompt).not.toMatch(/theme|layout|chart|font|slide/i);
  });
});

describe('finalDocument', () => {
  it('takes the last generate, not the first', async () => {
    const first = { name: 'docx', children: [{ name: 'paragraph' }] };
    expect(
      await finalDocument(
        [
          { type: 'tool_use', name: GENERATE, input: { document: first } },
          { type: 'tool_use', name: GENERATE, input: { document: DOCUMENT } },
        ],
        undefined
      )
    ).toEqual(DOCUMENT);
  });

  it('reads the head revision when the run authored by handle', async () => {
    const root = path.join(scratch, 'workspaces');
    await fs.mkdir(path.join(root, 'ws_1'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'ws_1', 'rev-1.json'),
      JSON.stringify({ name: 'docx', children: ['old'] })
    );
    await fs.writeFile(
      path.join(root, 'ws_1', 'rev-2.json'),
      JSON.stringify(DOCUMENT)
    );
    expect(
      await finalDocument(
        [{ type: 'tool_use', name: GENERATE, input: { handle: 'ws_1' } }],
        root
      )
    ).toEqual(DOCUMENT);
  });

  it('answers nothing when no generate was ever called', async () => {
    expect(await finalDocument([OK_RESULT], undefined)).toBeUndefined();
  });
});

describe('runBrief', () => {
  it('measures the document the agent generated, not what it said', async () => {
    const run = await runBrief(
      options({
        analyze: async () => ({
          diagnostics: [
            { code: 'W_QUALITY_TEXT_OVERFLOW', severity: 'warning' },
            { code: 'W_QUALITY_SCAFFOLD_MARKER', severity: 'warning' },
            { code: 'E_INVALID_VALUE', severity: 'error' },
          ],
          pages: 7,
        }),
      })
    );

    expect(run).toMatchObject({
      briefId: 'sample-brief',
      outcome: 'completed',
      pages: 7,
      blockingFindings: 1,
      placeholderLeaks: 1,
      iterations: 3,
      toolCalls: 1,
      retries: 0,
    });
    expect(run.qualityByCode).toEqual({
      W_QUALITY_SCAFFOLD_MARKER: 1,
      W_QUALITY_TEXT_OVERFLOW: 1,
    });
    expect(run.cost).toMatchObject({ inputTokens: 1200, outputTokens: 800 });
  });

  it('counts a session that generated nothing as a failure', async () => {
    const run = await runBrief(options({ driver: driverOf(OK_RESULT) }));
    expect(run.outcome).toBe('failed');
    expect(run.failure).toMatch(/without generating/);
  });

  it('keeps a thrown driver in the record rather than losing the brief', async () => {
    const run = await runBrief(
      options({
        driver: () => {
          throw new Error('transport closed');
        },
      })
    );
    expect(run.outcome).toBe('failed');
    expect(run.failure).toContain('transport closed');
  });

  it('retries a failed session and reports how many times', async () => {
    let calls = 0;
    const driver: AgentDriver = async function* (input) {
      calls += 1;
      if (calls === 1) {
        yield {
          type: 'result',
          ok: false,
          turns: 0,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 10,
          error: 'overloaded',
        };
        return;
      }
      expect(input.prompt).toContain(BRIEF.text);
      yield { type: 'tool_use', name: GENERATE, input: { document: DOCUMENT } };
      yield OK_RESULT;
    };
    const run = await runBrief(options({ driver, maxRetries: 1 }));
    expect(calls).toBe(2);
    expect(run.outcome).toBe('completed');
    expect(run.retries).toBe(1);
  });

  it('reports an analyzer that could not read the document', async () => {
    const run = await runBrief(
      options({
        analyze: async () => {
          throw new Error('not a docx document');
        },
      })
    );
    expect(run.outcome).toBe('failed');
    expect(run.failure).toContain('not a docx document');
  });

  it('keeps the transcript and the document it measured', async () => {
    await runBrief(options());
    const runDir = path.join(scratch, 'run');
    expect(
      JSON.parse(await fs.readFile(path.join(runDir, 'document.json'), 'utf8'))
    ).toEqual(DOCUMENT);
    const transcript = JSON.parse(
      await fs.readFile(path.join(runDir, 'transcript.json'), 'utf8')
    );
    expect(transcript.prompt).toContain(BRIEF.text);
    expect(transcript.events).toHaveLength(2);
  });

  it('keeps a sealed brief out of the artifacts it writes', async () => {
    await runBrief(options({ sealed: true }));
    const written = await fs.readFile(
      path.join(scratch, 'run', 'transcript.json'),
      'utf8'
    );
    expect(written).not.toContain(BRIEF.text);
    // Still fully identified — the hash says which brief this was.
    expect(written).toContain(BRIEF.hash);
  });
});

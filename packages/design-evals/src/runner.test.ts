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

let nextCall = 0;
function generated(input: Record<string, unknown>): AgentEvent[] {
  const id = `generate-${nextCall++}`;
  return [
    { type: 'tool_use', id, name: GENERATE, input },
    {
      type: 'tool_result',
      toolUseId: id,
      isError: false,
      content: JSON.stringify({
        ok: true,
        artifact: { mode: 'path', path: '/tmp/result.docx', bytes: 100 },
        ...(typeof input.handle === 'string' && {
          source: { origin: 'workspace', handle: input.handle, revision: 2 },
        }),
      }),
    },
  ];
}

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
    driver: driverOf(...generated({ document: DOCUMENT }), OK_RESULT),
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
          ...generated({ document: first }),
          ...generated({ document: DOCUMENT }),
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
      await finalDocument([...generated({ handle: 'ws_1' })], root)
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
      // One generate and no patches is a first-time-right run: zero repairs,
      // whatever number of turns it took to get there.
      iterations: 0,
      turns: 3,
      toolCalls: 1,
      retries: 0,
    });
    expect(run.qualityByCode).toEqual({
      W_QUALITY_SCAFFOLD_MARKER: 1,
      W_QUALITY_TEXT_OVERFLOW: 1,
    });
    expect(run.cost).toMatchObject({ inputTokens: 1200, outputTokens: 800 });
  });

  it('flags a foreign MCP server, not just a built-in tool', async () => {
    // The first full baseline had a pricing brief reach the operator's company
    // finance MCP server and pull real contract and revenue data. The guard is
    // what made it visible; `strictMcpConfig` is what stops it.
    const run = await runBrief(
      options({
        driver: driverOf(
          {
            type: 'tool_use',
            name: 'mcp__company_finance__list-clients',
            input: {},
          },
          ...generated({ document: DOCUMENT }),
          OK_RESULT
        ),
      })
    );
    expect(run.foreignTools).toEqual(['mcp__company_finance__list-clients']);
  });

  it('records tools that did not come from the server', async () => {
    const run = await runBrief(
      options({
        driver: driverOf(
          { type: 'tool_use', name: 'Bash', input: {} },
          { type: 'tool_use', name: 'Write', input: {} },
          ...generated({ document: DOCUMENT }),
          OK_RESULT
        ),
      })
    );
    expect(run.foreignTools).toEqual(['Bash', 'Write']);
  });

  it('has no foreign tools on a clean run', async () => {
    expect((await runBrief(options())).foreignTools).toEqual([]);
  });

  it('counts repair rounds, not turns', async () => {
    // The spec's "author iterations to done" targets 2. Reporting the SDK's
    // turn count under that name put an 18 next to a target of 2 and compared
    // nothing to anything.
    const PATCH = 'mcp__json-to-office__jto_workspace_patch';
    const CREATE = 'mcp__json-to-office__jto_workspace_create';
    const run = await runBrief(
      options({
        driver: driverOf(
          { type: 'tool_use', name: CREATE, input: {} },
          { type: 'tool_use', name: PATCH, input: {} },
          { type: 'tool_use', name: PATCH, input: {} },
          ...generated({ document: DOCUMENT }),
          { ...OK_RESULT, turns: 21 }
        ),
      })
    );
    expect(run.iterations).toBe(2);
    expect(run.turns).toBe(21);
  });

  it('counts a session that generated nothing as a failure', async () => {
    const run = await runBrief(options({ driver: driverOf(OK_RESULT) }));
    expect(run.outcome).toBe('failed');
    expect(run.failure).toMatch(/without generating/);
    expect(run.failure).not.toMatch(/HARNESS/);
  });

  it('separates a document it could not recover from one never generated', async () => {
    // The agent authored through a workspace handle and generated — the
    // recommended path. If the harness cannot read that workspace back, the
    // failure is its own, and calling it "generated nothing" would penalise
    // exactly the behaviour the server's instructions ask for.
    const run = await runBrief(
      options({
        driver: driverOf(...generated({ handle: 'ws_gone' }), OK_RESULT),
        workspaceRoot: path.join(scratch, 'nowhere'),
      })
    );
    expect(run.outcome).toBe('failed');
    expect(run.failure).toMatch(/^HARNESS:/);
    expect(run.failure).toMatch(/workspace directory/);
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
    expect(run.cost.usageComplete).toBe(false);
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
      yield* generated({ document: DOCUMENT });
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
    expect(transcript.events).toHaveLength(3);
  });

  it("hands the judge this run's own directory", async () => {
    // Under `--repeat` the run directory is `runs/<id>#2`, not `runs/<id>`.
    // A judge that derived the path from the brief id wrote its evidence to a
    // directory that does not exist, and every verdict after the first pass
    // was silently lost to the catch.
    const seen: string[] = [];
    const run = await runBrief(
      options({
        runDir: path.join(scratch, 'runs', 'sample-brief#2'),
        judge: async ({ runDir, brief }) => {
          seen.push(runDir);
          await fs.writeFile(path.join(runDir, 'contact-sheet.png'), 'x');
          return {
            level: 4 as const,
            wouldShip: true,
            genericness: 1,
            rationale: brief.id,
          };
        },
      })
    );
    expect(seen).toEqual([path.join(scratch, 'runs', 'sample-brief#2')]);
    expect(run.judge).toMatchObject({ level: 4, wouldShip: true });
  });

  it('keeps the hard numbers when the judge fails', async () => {
    const run = await runBrief(
      options({
        judge: async () => {
          throw new Error('vision model unavailable');
        },
      })
    );
    expect(run.outcome).toBe('completed');
    expect(run.pages).toBe(4);
    expect(run.judge).toBeUndefined();
  });

  it.each([
    { isError: false, content: JSON.stringify({ ok: false, diagnostics: [] }) },
    { isError: true, content: 'renderer crashed' },
    { isError: false, content: JSON.stringify({ ok: true }) },
    { isError: false, content: 'not JSON' },
  ])(
    'refuses unsuccessful generation despite session success: %j',
    async (response) => {
      let measured = false;
      const run = await runBrief(
        options({
          driver: driverOf(
            {
              type: 'tool_use',
              id: 'bad',
              name: GENERATE,
              input: { document: DOCUMENT },
            },
            { type: 'tool_result', toolUseId: 'bad', ...response },
            OK_RESULT
          ),
          analyze: async () => {
            measured = true;
            return { diagnostics: [], pages: 1 };
          },
        })
      );
      expect(run.outcome).toBe('failed');
      expect(run.failure).toContain('artifact delivery');
      expect(measured).toBe(false);
      expect(run.cost.usd).toBe(0.042);
    }
  );

  it('does not substitute an earlier successful generation for a missing final reply', async () => {
    const run = await runBrief(
      options({
        driver: driverOf(
          ...generated({ document: DOCUMENT }),
          {
            type: 'tool_use',
            id: 'missing',
            name: GENERATE,
            input: { document: DOCUMENT },
          },
          OK_RESULT
        ),
      })
    );
    expect(run.outcome).toBe('failed');
  });

  it('accepts a matching base64 artifact in MCP text blocks', async () => {
    const run = await runBrief(
      options({
        driver: driverOf(
          {
            type: 'tool_use',
            id: 'inline',
            name: GENERATE,
            input: { document: DOCUMENT },
          },
          {
            type: 'tool_result',
            toolUseId: 'inline',
            isError: false,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  artifact: { mode: 'base64', base64: 'YQ==', bytes: 1 },
                }),
              },
            ],
          },
          OK_RESULT
        ),
      })
    );
    expect(run.outcome).toBe('completed');
  });

  it('sums retry costs and preserves earlier calls and contamination', async () => {
    let calls = 0;
    const run = await runBrief(
      options({
        maxRetries: 1,
        driver: async function* () {
          calls++;
          if (calls === 1) {
            yield { type: 'tool_use', name: 'Bash', input: {} };
            yield { ...OK_RESULT, ok: false, credential: 'none' };
          } else {
            yield* generated({ document: DOCUMENT });
            yield { ...OK_RESULT, credential: 'none' };
          }
        },
      })
    );
    expect(run).toMatchObject({
      outcome: 'completed',
      retries: 1,
      toolCalls: 2,
      turns: 6,
      foreignTools: ['Bash'],
      cost: {
        inputTokens: 2400,
        outputTokens: 1600,
        usd: 0.084,
        credential: 'none',
      },
    });
    const transcript = JSON.parse(
      await fs.readFile(path.join(scratch, 'run', 'transcript.json'), 'utf8')
    );
    expect(transcript.attempts).toHaveLength(2);
    expect(transcript.events).toHaveLength(5);
  });

  it('retains usage and contamination on an exhausted failed session', async () => {
    const run = await runBrief(
      options({
        driver: driverOf(
          { type: 'tool_use', name: 'Bash', input: {} },
          { ...OK_RESULT, ok: false, credential: 'none' }
        ),
      })
    );
    expect(run).toMatchObject({
      outcome: 'failed',
      foreignTools: ['Bash'],
      cost: {
        inputTokens: 1200,
        outputTokens: 800,
        usd: 0.042,
        credential: 'none',
      },
    });
  });

  it('preserves partial events if the driver throws', async () => {
    const run = await runBrief(
      options({
        driver: async function* () {
          yield { type: 'tool_use', name: 'Bash', input: {} };
          yield { ...OK_RESULT, ok: false };
          throw new Error('transport closed');
        },
      })
    );
    expect(run).toMatchObject({
      outcome: 'failed',
      toolCalls: 1,
      foreignTools: ['Bash'],
      cost: { inputTokens: 1200, usd: 0.042 },
    });
  });

  it('retains usage when analysis fails', async () => {
    const run = await runBrief(
      options({
        analyze: async () => {
          throw new Error('analysis failed');
        },
      })
    );
    expect(run.outcome).toBe('failed');
    expect(run.cost).toMatchObject({
      inputTokens: 1200,
      outputTokens: 800,
      usd: 0.042,
    });
  });

  it('measures the generated workspace revision despite subsequent patches', async () => {
    const root = path.join(scratch, 'workspaces');
    await fs.mkdir(path.join(root, 'ws_1'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'ws_1', 'rev-2.json'),
      JSON.stringify(DOCUMENT)
    );
    await fs.writeFile(
      path.join(root, 'ws_1', 'rev-3.json'),
      JSON.stringify({ name: 'later' })
    );
    expect(await finalDocument(generated({ handle: 'ws_1' }), root)).toEqual(
      DOCUMENT
    );
    await fs.rm(path.join(root, 'ws_1', 'rev-2.json'));
    expect(
      await finalDocument(generated({ handle: 'ws_1' }), root)
    ).toBeUndefined();
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkAgentDriver, type AgentEvent } from './agent.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }));

beforeEach(() => query.mockReset());

describe('sdkAgentDriver', () => {
  it('preserves tool IDs and responses independently of session success', async () => {
    query.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'generate-1',
              name: 'mcp__json-to-office__jto_generate',
              input: { document: {} },
            },
          ],
        },
      };
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'generate-1',
              is_error: false,
              content: [{ type: 'text', text: '{"ok":false}' }],
            },
            {
              type: 'tool_result',
              tool_use_id: 'generate-2',
              is_error: true,
              content: 'failed',
            },
          ],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 10, output_tokens: 2 },
      };
    });
    const events: AgentEvent[] = [];
    for await (const event of sdkAgentDriver({
      prompt: 'test',
      model: 'test',
      maxTurns: 2,
      cwd: '/tmp',
      server: { command: 'node', args: [] },
    }))
      events.push(event);
    expect(events).toMatchObject([
      { type: 'tool_use', id: 'generate-1' },
      {
        type: 'tool_result',
        toolUseId: 'generate-1',
        isError: false,
        content: [{ type: 'text', text: '{"ok":false}' }],
      },
      { type: 'tool_result', toolUseId: 'generate-2', isError: true },
      { type: 'result', ok: true, inputTokens: 10, outputTokens: 2 },
    ]);
  });
});

/**
 * The headless author.
 *
 * A thin, replaceable layer over the Claude Agent SDK, so everything the
 * harness actually reasons about — which tools were called, what the last
 * generate was handed, what the run cost — is an ordinary async iterable of
 * small events. Tests drive that iterable directly; only this file knows the
 * SDK exists, and only a live run needs a key.
 *
 * Cold mode is the default and means what it says: the server's own
 * instructions and nothing else. No skill, no project settings, no CLAUDE.md.
 * The whole point of the measurement is what an agent does with the product as
 * shipped, so anything that would quietly help it has to be absent by
 * construction rather than by intention.
 */

export interface AgentToolUse {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

export interface AgentResult {
  type: 'result';
  ok: boolean;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * The SDK's own words: an estimate, not a billing statement. It is what
   * these tokens WOULD cost at API rates, and it is reported the same way
   * whether or not anything was billed — so it must always be read next to
   * `credential`.
   */
  usd?: number;
  /**
   * Where the session's credential came from. `none` is a claude.ai
   * subscription login, where `usd` is notional and nothing is charged.
   */
  credential?: string;
  durationMs: number;
  /** Present when the session ended in an error rather than an answer. */
  error?: string;
}

export type AgentEvent = AgentToolUse | AgentResult;

export interface AgentRunOptions {
  prompt: string;
  model: string;
  maxTurns: number;
  /** The stdio command that serves json-to-office to the agent. */
  server: { command: string; args: string[]; env?: Record<string, string> };
  /** Appended to the system prompt in `assisted` mode; absent when cold. */
  skill?: string;
  cwd: string;
  signal?: AbortSignal;
}

export type AgentDriver = (
  options: AgentRunOptions
) => AsyncIterable<AgentEvent>;

/** Only the json-to-office tools. A cold run authors with nothing else. */
export const SERVER_ALIAS = 'json-to-office';

interface SdkUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function totalInput(usage: SdkUsage | undefined): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/**
 * The real driver, over the SDK.
 *
 * Imported lazily so the harness's pure modules — corpus, metrics, scorecard —
 * can be loaded, tested and typechecked on a machine with no SDK credentials
 * and no intention of spending any.
 */
export const sdkAgentDriver: AgentDriver = async function* (options) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const started = Date.now();

  const session = query({
    prompt: options.prompt,
    options: {
      model: options.model,
      maxTurns: options.maxTurns,
      cwd: options.cwd,
      // No project settings, no user settings, no CLAUDE.md: a cold run must
      // measure the product, not the machine it happens to run on.
      settingSources: [],
      mcpServers: {
        [SERVER_ALIAS]: {
          type: 'stdio',
          command: options.server.command,
          args: options.server.args,
          ...(options.server.env && { env: options.server.env }),
        },
      },
      // `tools: []` disables every built-in. This is the option that RESTRICTS;
      // `allowedTools` only waives the permission prompt, which is what the
      // first working smoke run proved the hard way — the "cold" agents used
      // Bash eight times, wrote the document to disk with Write, spawned a
      // subagent with Agent, and called ScheduleWakeup. A baseline taken that
      // way measures a full Claude Code session that happens to have the MCP
      // server attached, which is not the thing the targets are about.
      tools: [],
      // Still listed, so the MCP tools run without a permission prompt in a
      // session that has no human to answer one.
      allowedTools: [`mcp__${SERVER_ALIAS}`],
      ...(options.skill !== undefined && {
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: options.skill,
        },
      }),
      ...(options.signal && { abortController: toController(options.signal) }),
    },
  });

  let credential: string | undefined;
  for await (const message of session) {
    if (message.type === 'system' && message.subtype === 'init') {
      credential = message.apiKeySource;
      continue;
    }
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_use',
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          };
        }
      }
      continue;
    }
    if (message.type === 'result') {
      const failed = message.subtype !== 'success' || message.is_error;
      yield {
        type: 'result',
        ok: !failed,
        turns: message.num_turns ?? 0,
        inputTokens: totalInput(message.usage as SdkUsage | undefined),
        outputTokens:
          (message.usage as SdkUsage | undefined)?.output_tokens ?? 0,
        ...(typeof message.total_cost_usd === 'number' && {
          usd: message.total_cost_usd,
        }),
        ...(credential !== undefined && { credential }),
        durationMs: message.duration_ms ?? Date.now() - started,
        ...(failed && {
          error:
            'result' in message && typeof message.result === 'string'
              ? message.result
              : message.subtype,
        }),
      };
    }
  }
};

/** The SDK takes a controller; the harness passes signals around. */
function toController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else
    signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  return controller;
}

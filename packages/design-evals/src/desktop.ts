/**
 * A Claude Desktop session, measured the way the harness measures its own
 * headless runs (#422).
 *
 * The headless runner reads everything off the agent SDK: every tool call,
 * every answer, the revision the final `jto_generate` read. Desktop exposes
 * none of that — its MCP log names a `tools/call` by id and nothing else — so
 * the server keeps a journal when `JTO_MCP_JOURNAL` asks it to, and this
 * module turns one journalled session back into the events the runner's own
 * counters read. Iterations, environment failures and delivery are then
 * computed by the same code for both hosts, which is the only way a
 * difference between them means something about the host.
 *
 * What Desktop cannot tell anyone is said, not guessed: turns, tokens and any
 * tool the model reached outside this server are unobservable here, and the
 * import records them as such rather than as zero.
 */

import { createHash } from 'node:crypto';

import type {
  JournalCallLine,
  JournalSessionLine,
} from '@json-to-office/mcp-server';

import type { AgentEvent } from './agent.js';
import { SERVER_ALIAS } from './agent.js';
import { countEnvironmentFailures, countIterations } from './runner.js';

/** The journal line version this reader understands (mcp-server's `JOURNAL_VERSION`). */
export const READABLE_JOURNAL_VERSION = 1;

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A call line, as the server wrote it, without the fields grouping replaces. */
export type JournalCall = Omit<JournalCallLine, 'v' | 'type' | 'session'>;

/** A session line's facts: server version, output and workspace roots. */
export type JournalSessionFacts = Partial<
  Omit<JournalSessionLine, 'v' | 'type' | 'at' | 'session'>
>;

export interface JournalSessionRecord {
  id: string;
  startedAt: string;
  facts: JournalSessionFacts;
  calls: JournalCall[];
}

export interface ParsedJournal {
  sessions: JournalSessionRecord[];
}

/**
 * The journal, grouped by session.
 *
 * A blank line is nothing, and an unparseable line can only be the last one
 * — a server killed mid-append — so it is dropped; anything else that does
 * not parse is a corrupt journal and says so. A line of another version is
 * refused: reading a changed shape as this one would be measuring garbage.
 */
export function parseJournal(text: string): ParsedJournal {
  const lines = text.split('\n');
  const sessions = new Map<string, JournalSessionRecord>();
  const orphans: Array<{ session: string; call: JournalCall }> = [];
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    let entry: Rec;
    try {
      entry = JSON.parse(trimmed) as Rec;
    } catch {
      const isLast = lines.slice(index + 1).every((rest) => rest.trim() === '');
      if (isLast) return;
      throw new Error(`Journal line ${index + 1} is not JSON.`);
    }
    if (entry.v !== READABLE_JOURNAL_VERSION) {
      throw new Error(
        `Journal line ${index + 1} has version ${String(entry.v)}; this reader understands version ${READABLE_JOURNAL_VERSION}.`
      );
    }
    const id = String(entry.session);
    if (entry.type === 'session') {
      const facts = Object.fromEntries(
        Object.entries(entry).filter(
          ([key]) => !['v', 'type', 'at', 'session'].includes(key)
        )
      );
      sessions.set(id, { id, startedAt: String(entry.at), facts, calls: [] });
      return;
    }
    if (entry.type !== 'call') return;
    const call: JournalCall = {
      at: String(entry.at),
      seq: Number(entry.seq),
      tool: String(entry.tool),
      durationMs: Number(entry.durationMs) || 0,
      args: isRecord(entry.args) ? entry.args : {},
      result: isRecord(entry.result) ? entry.result : {},
      ...(isRecord(entry.delivered) && {
        delivered: entry.delivered as unknown as JournalCallLine['delivered'],
      }),
    };
    const owner = sessions.get(id);
    if (owner) owner.calls.push(call);
    else orphans.push({ session: id, call });
  });
  for (const { session, call } of orphans) {
    // A call whose session line was lost still belongs to a session.
    const owner = sessions.get(session) ?? {
      id: session,
      startedAt: call.at,
      facts: {},
      calls: [],
    };
    owner.calls.push(call);
    sessions.set(session, owner);
  }
  for (const entry of sessions.values()) {
    entry.calls.sort((a, b) => a.seq - b.seq);
  }
  return {
    sessions: [...sessions.values()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt)
    ),
  };
}

/**
 * The session as the agent-SDK events a headless run records: a `tool_use`
 * and its `tool_result` per call, named with the harness's server alias so
 * `countIterations` and `countEnvironmentFailures` read them unchanged.
 */
export function desktopEvents(session: JournalSessionRecord): AgentEvent[] {
  return session.calls.flatMap((call): AgentEvent[] => {
    const id = `${session.id}-${call.seq}`;
    return [
      {
        type: 'tool_use',
        id,
        name: `mcp__${SERVER_ALIAS}__${call.tool}`,
        input: call.args,
      },
      {
        type: 'tool_result',
        toolUseId: id,
        isError: call.result.ok === false,
        // The diagnostics' messages, where environment failures are named.
        content: JSON.stringify(call.result),
      },
    ];
  });
}

export interface DesktopAccounting {
  toolCalls: number;
  iterations: number;
  environmentFailures: string[];
  /** From the first call's start to the last call's end. */
  wallMs: number;
  /** The final `jto_generate`, when it delivered. */
  delivered?: {
    format?: string;
    artifact?: string;
    bytes?: number;
    handle?: string;
    revision?: number;
    documentFile: string;
    documentSha256: string;
    /** The file's digest when the server recorded one. */
    artifactSha256?: string;
  };
  /** How much of the authoring loop the session actually walked. */
  loop: {
    scaffolded: boolean;
    validations: number;
    previews: number;
    contactSheets: number;
    critiqueInspections: number;
    critiqueRecords: number;
    generations: number;
  };
}

export function desktopAccounting(
  session: JournalSessionRecord
): DesktopAccounting {
  const events = desktopEvents(session);
  const calls = session.calls;
  const first = calls[0];
  const last = calls[calls.length - 1];
  const wallMs =
    first && last
      ? Date.parse(last.at) - Date.parse(first.at) + first.durationMs
      : 0;

  const generations = calls.filter((call) => call.tool === 'jto_generate');
  const final = generations[generations.length - 1];
  const delivered =
    final && final.result.ok === true && final.delivered
      ? {
          ...(typeof final.args.format === 'string' && {
            format: final.args.format,
          }),
          ...(isRecord(final.result.artifact) &&
            typeof final.result.artifact.path === 'string' && {
              artifact: final.result.artifact.path,
            }),
          ...(isRecord(final.result.artifact) &&
            typeof final.result.artifact.bytes === 'number' && {
              bytes: final.result.artifact.bytes,
            }),
          ...(final.delivered.handle !== undefined && {
            handle: final.delivered.handle,
          }),
          ...(final.delivered.revision !== undefined && {
            revision: final.delivered.revision,
          }),
          documentFile: final.delivered.file,
          documentSha256: final.delivered.sha256,
          ...(final.delivered.artifactSha256 !== undefined && {
            artifactSha256: final.delivered.artifactSha256,
          }),
        }
      : undefined;

  return {
    toolCalls: calls.length,
    iterations: countIterations(events),
    environmentFailures: countEnvironmentFailures(events),
    wallMs,
    ...(delivered && { delivered }),
    loop: loopUsage(events),
  };
}

export type LoopUsage = DesktopAccounting['loop'];

/**
 * How much of the authoring loop a run walked, read off its tool calls.
 *
 * One function for both hosts: a headless transcript and a replayed journal
 * are the same events, so a difference in these counts is a difference in
 * what the agent did, not in how it was counted.
 */
export function loopUsage(events: readonly AgentEvent[]): LoopUsage {
  const prefix = `mcp__${SERVER_ALIAS}__`;
  const calls = events.filter(
    (event): event is Extract<AgentEvent, { type: 'tool_use' }> =>
      event.type === 'tool_use' && event.name.startsWith(prefix)
  );
  const named = (tool: string) =>
    calls.filter((call) => call.name === `${prefix}${tool}`);
  return {
    scaffolded: named('jto_scaffold').length > 0,
    validations: named('jto_validate').length,
    previews: named('jto_preview').length,
    contactSheets: named('jto_preview').filter(
      (call) => call.input.contactSheet === true
    ).length,
    critiqueInspections: named('jto_critique').filter(
      (call) => call.input.action === 'inspect'
    ).length,
    critiqueRecords: named('jto_critique').filter(
      (call) => call.input.action === 'record'
    ).length,
    generations: named('jto_generate').length,
  };
}

/** One line per session, so a person can match sessions to briefs. */
export function summarizeSessions(journal: ParsedJournal): Array<{
  id: string;
  startedAt: string;
  calls: number;
  firstCallAt?: string;
  lastCallAt?: string;
  blueprint?: string;
  theme?: string;
  delivered?: string;
}> {
  return journal.sessions.map((session) => {
    const scaffold = session.calls.find((call) => call.tool === 'jto_scaffold');
    const accounting = desktopAccounting(session);
    const first = session.calls[0];
    const last = session.calls[session.calls.length - 1];
    return {
      id: session.id,
      startedAt: session.startedAt,
      calls: session.calls.length,
      ...(first && { firstCallAt: first.at }),
      ...(last && { lastCallAt: last.at }),
      ...(typeof scaffold?.args.blueprint === 'string' && {
        blueprint: scaffold.args.blueprint,
      }),
      ...(typeof scaffold?.args.theme === 'string' && {
        theme: scaffold.args.theme,
      }),
      ...(accounting.delivered?.artifact && {
        delivered: accounting.delivered.artifact,
      }),
    };
  });
}

/**
 * Whether a Desktop session delivered what the server recorded delivering.
 *
 * The kept document must hash to the digest written when it was generated,
 * and the file must still be where the server put it — with the digest the
 * server recorded, when it recorded one, else the size. Any miss makes the
 * run a failed one: a file nobody can show is not a delivery.
 */
export function checkDelivery(input: {
  documentText: string;
  documentSha256: string;
  artifact: { exists: boolean; bytes?: number; sha256?: string };
  expected: { bytes?: number; artifactSha256?: string };
}): {
  documentVerified: boolean;
  artifactExists: boolean;
  artifactVerified?: boolean;
  failure?: string;
} {
  const documentVerified =
    createHash('sha256').update(input.documentText).digest('hex') ===
    input.documentSha256;
  const artifactExists = input.artifact.exists;
  const artifactVerified = !artifactExists
    ? false
    : input.expected.artifactSha256 !== undefined
      ? input.artifact.sha256 === input.expected.artifactSha256
      : input.expected.bytes !== undefined
        ? input.artifact.bytes === input.expected.bytes
        : undefined;
  const failure = !documentVerified
    ? 'the delivered document does not match the digest the server recorded'
    : !artifactExists
      ? 'the delivered file is missing'
      : artifactVerified === false
        ? 'the delivered file changed after it was generated'
        : undefined;
  return {
    documentVerified,
    artifactExists,
    ...(artifactVerified !== undefined && { artifactVerified }),
    ...(failure && { failure }),
  };
}

/**
 * The run journal: an opt-in record of every tool call, written by the server.
 *
 * #422 compares documents authored in Claude Desktop with the headless
 * runner's, and the headless side is easy — the agent SDK hands the harness
 * every tool call and every answer. Desktop hands over nothing measurable. Its
 * log names each `tools/call` by id and prints neither the tool nor its
 * arguments, so from the client's side a Desktop session cannot say how many
 * repairs it took, whether it previewed, or which revision the file it
 * delivered was built from. The server is the one party that sees all of it,
 * so when `JTO_MCP_JOURNAL` names a file the server writes it down: a session
 * line per connection, then one line per call, and beside the journal the
 * exact document each successful `jto_generate` delivered.
 *
 * Measurement, not telemetry, and shaped by that. It is off unless configured,
 * it goes only to the local file named, and it records the *shape* of the
 * work rather than its content: option values the agent chose (format,
 * handle, theme, blueprint), documents as a digest and a size, patches as the
 * operations and pointers they touched without the values they wrote. The one
 * exception is the delivered document itself, kept because verifying what was
 * delivered against the revision that generated it is the point of the
 * exercise — and it is the same file the user was just handed.
 *
 * Written like the workspace mirror: a new directory `0o700`, files `0o600`.
 *
 * A journal that cannot be written must never cost a tool call. Every failure
 * here is swallowed, and reported once on stderr, which is not the protocol.
 */

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** The environment variable that turns the journal on. */
export const JOURNAL_ENV = 'JTO_MCP_JOURNAL';

/** Bumped when a line changes shape, so an importer can refuse what it cannot read. */
export const JOURNAL_VERSION = 1;

/**
 * Arguments recorded by value. Everything here is an option the agent chose,
 * never something the user wrote: which format, which workspace, which theme.
 * Anything not listed is recorded by shape only.
 */
const OPTION_KEYS = new Set([
  'action',
  'baseRevision',
  'blueprint',
  'contactSheet',
  'deterministic',
  'dpi',
  'filename',
  'format',
  'handle',
  'includeBlocks',
  'includeCompiled',
  'includeDocument',
  'maxDiagnostics',
  'name',
  'outputMode',
  'pages',
  'renderedFindings',
  'renderer',
  'revision',
  'runId',
  'theme',
  'variant',
]);

/** Result fields recorded by value: ids, counts and verdict flags, never text. */
const RESULT_KEYS = new Set([
  'format',
  'generationReady',
  'handle',
  'ok',
  'renderer',
  'revision',
  'round',
  'rounds',
  'runId',
  'theme',
  'totalPages',
  'truncated',
]);

/** Nested result objects whose scalar fields are identity, not content. */
const IDENTITY_OBJECTS = new Set(['artifact', 'source', 'workspace']);

/** How much of a diagnostic's message survives: enough to classify, not to quote. */
const MESSAGE_CHARS = 160;
const MAX_LISTED_DIAGNOSTICS = 10;

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A document as the journal holds it: who it is, not what it says. */
export function digest(value: unknown): { sha256: string; bytes: number } {
  const text = JSON.stringify(value) ?? '';
  return { sha256: sha256(text), bytes: Buffer.byteLength(text) };
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return { items: value.length };
  if (isRecord(value)) return { keys: Object.keys(value).sort() };
  if (typeof value === 'string') return { chars: value.length };
  return value;
}

/** RFC 6902 operations without the values they carry. */
function operations(value: unknown): unknown {
  if (!Array.isArray(value)) return shape(value);
  return value.map((entry) => {
    if (!isRecord(entry)) return shape(entry);
    return {
      ...(typeof entry.op === 'string' && { op: entry.op }),
      ...(typeof entry.path === 'string' && { path: entry.path }),
      ...(typeof entry.from === 'string' && { from: entry.from }),
    };
  });
}

/** A tool call's arguments, as the journal records them. */
export function summarizeArgs(args: unknown): Rec {
  if (!isRecord(args)) return {};
  const out: Rec = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'document') out[key] = digest(value);
    else if (key === 'operations') out[key] = operations(value);
    else if (
      OPTION_KEYS.has(key) &&
      (typeof value === 'number' ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 200))
    ) {
      out[key] = value;
    } else out[key] = shape(value);
  }
  return out;
}

interface DiagnosticLike {
  code?: unknown;
  severity?: unknown;
  message?: unknown;
}

function summarizeDiagnostics(value: unknown): Rec {
  const list = Array.isArray(value) ? (value as DiagnosticLike[]) : [];
  const bySeverity: Record<string, number> = {};
  const codes = new Set<string>();
  const errors: Rec[] = [];
  const warnings: Rec[] = [];
  for (const entry of list) {
    const severity =
      typeof entry.severity === 'string' ? entry.severity : 'unknown';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    const code = typeof entry.code === 'string' ? entry.code : undefined;
    if (code) codes.add(code);
    const target =
      severity === 'error'
        ? errors
        : severity === 'warning'
          ? warnings
          : undefined;
    if (target && target.length < MAX_LISTED_DIAGNOSTICS) {
      target.push({
        ...(code && { code }),
        ...(typeof entry.message === 'string' && {
          message: entry.message.slice(0, MESSAGE_CHARS),
        }),
      });
    }
  }
  return {
    total: list.length,
    bySeverity,
    codes: [...codes].sort(),
    errors,
    warnings,
  };
}

/** What a tool answered, reduced to identity, counts and outcome. */
export function summarizeResult(payload: unknown): Rec {
  if (!isRecord(payload)) return { ok: false, unreadable: true };
  const out: Rec = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'diagnostics') out[key] = summarizeDiagnostics(value);
    else if (IDENTITY_OBJECTS.has(key) && isRecord(value)) {
      const kept: Rec = {};
      for (const [field, inner] of Object.entries(value)) {
        if (field === 'base64') continue;
        if (
          typeof inner === 'number' ||
          typeof inner === 'boolean' ||
          (typeof inner === 'string' && inner.length <= 400)
        ) {
          kept[field] = inner;
        }
      }
      out[key] = kept;
    } else if (
      RESULT_KEYS.has(key) &&
      (typeof value === 'number' ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 200))
    ) {
      out[key] = value;
    } else out[key] = shape(value);
  }
  return out;
}

/** The structured payload of a tool result, however the SDK carried it. */
function payloadOf(result: unknown): unknown {
  if (!isRecord(result)) return undefined;
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    if (isRecord(block) && typeof block.text === 'string') {
      try {
        return JSON.parse(block.text);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The first line of every connection: which server, where it writes. */
export interface JournalSessionLine {
  v: typeof JOURNAL_VERSION;
  type: 'session';
  at: string;
  session: string;
  server: { name: string; version: string };
  pid: number;
  node: string;
  platform: string;
  outputRoot: string;
  workspaceRoot?: string;
  exportServerHost?: string;
  /** The script the host started, and a digest of it: which build answered. */
  serverEntry?: string;
  serverBuild?: string;
  /** Preview binaries as configured, when they were. */
  previewPaths?: { libreoffice?: string; pdftoppm?: string };
}

/** The document a successful generation delivered, kept beside the journal. */
export interface JournalDelivered {
  sha256: string;
  bytes: number;
  /** The kept copy, named by its digest. */
  file: string;
  /** Present when the generation read a workspace revision. */
  handle?: string;
  revision?: number;
  /** The delivered file's digest, so it can be checked byte for byte later. */
  artifactSha256?: string;
}

/** One finished tool call. */
export interface JournalCallLine {
  v: typeof JOURNAL_VERSION;
  type: 'call';
  /** When the call finished. */
  at: string;
  session: string;
  /** Call order within the session, from 1. */
  seq: number;
  tool: string;
  durationMs: number;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  delivered?: JournalDelivered;
}

export type JournalLine = JournalSessionLine | JournalCallLine;

export interface DeliveredSource {
  /** Reads a workspace revision, as the store would for the tool itself. */
  readRevision(handle: string, revision: number): Promise<unknown | undefined>;
}

export interface CallRecord {
  tool: string;
  args: unknown;
  result?: unknown;
  error?: unknown;
  durationMs: number;
}

export interface JournalSession {
  readonly id: string;
  /** Record one finished call. Never rejects. */
  call(record: CallRecord, source: DeliveredSource): Promise<void>;
}

export interface Journal {
  /** The JSONL file every line is appended to. */
  readonly path: string;
  /** Delivered documents land here, named by digest. */
  readonly documentsDir: string;
  /** Start a connection: writes the session line and numbers its calls. */
  openSession(
    facts: Omit<JournalSessionLine, 'v' | 'type' | 'at' | 'session'>
  ): JournalSession;
  /** Resolves once every line queued so far has been written. */
  flush(): Promise<void>;
}

/**
 * The journal `JTO_MCP_JOURNAL` names, or undefined when it names none.
 *
 * `path` wins over the environment, for a host that builds its own deps.
 */
export function createJournal(options: {
  path?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): Journal | undefined {
  const configured =
    options.path?.trim() || (options.env ?? process.env)[JOURNAL_ENV]?.trim();
  if (!configured) return undefined;
  const file = path.resolve(configured);
  const documentsDir = `${file}.documents`;
  const now = options.now ?? (() => new Date());

  // One queue for the whole process: lines land whole and in call order even
  // when two connections, or two overlapping calls, finish at once.
  let tail: Promise<void> = Promise.resolve();
  let complained = false;
  const complain = (error: unknown): void => {
    if (complained) return;
    complained = true;
    process.stderr.write(
      `jto-mcp: the run journal at ${file} could not be written (${
        error instanceof Error ? error.message : String(error)
      }); tool calls continue unrecorded.\n`
    );
  };
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    tail = tail.then(work).catch(complain);
    return tail;
  };
  // `mode` only shapes a file or directory the call creates, so one that
  // already existed is brought down to owner-only before anything is written
  // into it.
  let fileSecured = false;
  let documentsSecured = false;
  const write = async (line: JournalLine): Promise<void> => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!fileSecured) {
      await ownerOnly(file, 0o600);
      fileSecured = true;
    }
    await fs.appendFile(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  };
  const append = (line: JournalLine): Promise<void> =>
    enqueue(() => write(line));

  const keep = async (
    document: unknown
  ): Promise<JournalDelivered | undefined> => {
    const text = JSON.stringify(document);
    if (text === undefined) return undefined;
    const hash = sha256(text);
    const target = path.join(documentsDir, `${hash}.json`);
    try {
      await fs.mkdir(documentsDir, { recursive: true, mode: 0o700 });
      if (!documentsSecured) {
        await ownerOnly(documentsDir, 0o700);
        documentsSecured = true;
      }
      await ownerOnly(target, 0o600);
      await fs.writeFile(target, text, { mode: 0o600 });
    } catch (error) {
      complain(error);
      return undefined;
    }
    return { sha256: hash, bytes: Buffer.byteLength(text), file: target };
  };

  return {
    path: file,
    documentsDir,
    flush: () => tail,
    openSession(facts) {
      const id = `s-${randomBytes(4).toString('hex')}`;
      let seq = 0;
      void append({
        v: JOURNAL_VERSION,
        type: 'session',
        at: now().toISOString(),
        session: id,
        ...facts,
      });
      return {
        id,
        call(record, source) {
          seq += 1;
          const position = seq;
          const at = now().toISOString();
          let line: Omit<JournalCallLine, 'delivered'>;
          let reading: Promise<JournalDelivered | undefined>;
          try {
            const payload = payloadOf(record.result);
            const summary =
              record.error !== undefined
                ? {
                    ok: false,
                    thrown:
                      record.error instanceof Error
                        ? record.error.message.slice(0, MESSAGE_CHARS)
                        : String(record.error).slice(0, MESSAGE_CHARS),
                  }
                : summarizeResult(payload);
            line = {
              v: JOURNAL_VERSION,
              type: 'call',
              at,
              session: id,
              seq: position,
              tool: record.tool,
              durationMs: record.durationMs,
              args: summarizeArgs(record.args),
              result: summary,
            };
            // Read at once, while the generating revision is still the
            // current one, and never rejecting: a failed read is a line
            // without a delivered document, not a lost line.
            reading =
              record.tool === 'jto_generate' &&
              isRecord(payload) &&
              payload.ok === true
                ? deliveredDocument(record.args, payload, source, keep).catch(
                    (error: unknown) => {
                      complain(error);
                      return undefined;
                    }
                  )
                : Promise.resolve(undefined);
          } catch (error) {
            complain(error);
            return Promise.resolve();
          }
          // The line takes its place in the file now, in call order, and is
          // written when the read it carries is done — so a generation whose
          // document is slow to read never lands after the call that followed.
          return enqueue(async () => {
            const delivered = await reading;
            await write({ ...line, ...(delivered && { delivered }) });
          });
        },
      };
    },
  };
}

/** Narrow an existing path's permissions; a path not there yet is created with them. */
async function ownerOnly(target: string, mode: number): Promise<void> {
  try {
    await fs.chmod(target, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * The document a successful generation was built from, kept by digest.
 *
 * Inline, it is the argument. By handle, it is the revision the tool reported
 * reading — read back immediately, while it is still the current one, because
 * a later patch would otherwise make it a stale revision nobody pinned.
 */
async function deliveredDocument(
  args: unknown,
  payload: Rec,
  source: DeliveredSource,
  keep: (document: unknown) => Promise<JournalDelivered | undefined>
): Promise<JournalDelivered | undefined> {
  const summary = isRecord(payload.source) ? payload.source : undefined;
  let kept: JournalDelivered | undefined;
  if (
    summary?.origin === 'inline' &&
    isRecord(args) &&
    args.document !== undefined
  ) {
    kept = await keep(args.document);
  } else if (
    summary?.origin === 'workspace' &&
    typeof summary.handle === 'string' &&
    typeof summary.revision === 'number'
  ) {
    const document = await source.readRevision(
      summary.handle,
      summary.revision
    );
    if (document === undefined) return undefined;
    const stored = await keep(document);
    kept = stored && {
      ...stored,
      handle: summary.handle,
      revision: summary.revision,
    };
  }
  if (!kept) return undefined;
  const artifactSha256 = await artifactDigest(payload.artifact);
  return { ...kept, ...(artifactSha256 && { artifactSha256 }) };
}

/** The delivered file's bytes, hashed: read from its path, or decoded inline. */
async function artifactDigest(artifact: unknown): Promise<string | undefined> {
  if (!isRecord(artifact)) return undefined;
  try {
    if (artifact.mode === 'path' && typeof artifact.path === 'string') {
      return sha256Bytes(await fs.readFile(artifact.path));
    }
    if (artifact.mode === 'base64' && typeof artifact.base64 === 'string') {
      return sha256Bytes(Buffer.from(artifact.base64, 'base64'));
    }
  } catch {
    // A file that cannot be read now is one the importer will find missing.
  }
  return undefined;
}

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

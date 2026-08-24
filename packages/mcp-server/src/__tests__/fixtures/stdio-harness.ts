/**
 * Shared plumbing for the end-to-end stdio suites.
 *
 * Everything in `stdio-*.test.ts` talks to `dist/cli.js` as a child process,
 * because that is the only arrangement in which the things those suites check
 * are real: an in-process `InMemoryTransport` has no stdout to keep clean, no
 * 10 MB frame ceiling, no separate stderr, and no era negotiation — all four of
 * which turned out to matter.
 *
 * Two clients live here on purpose. `openSession` is the stock SDK client, and
 * is what an agent actually uses. `RawStdioServer` speaks JSON-RPC by hand over
 * pipes it owns, which is the only way to read the child's raw stdout bytes and
 * to weigh a request as it goes on the wire.
 */

import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const run = promisify(execFile);

export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
export const cliPath = path.join(packageRoot, 'dist', 'cli.js');

// ---------------------------------------------------------------------------
// Building the thing under test
// ---------------------------------------------------------------------------

/**
 * The newest mtime among the sources tsup would bundle.
 *
 * Tests are excluded because editing this file must not make the binary look
 * stale — these suites would then rebuild on every run for no reason.
 */
async function newestSourceMtime(dir: string): Promise<number> {
  let newest = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      newest = Math.max(newest, await newestSourceMtime(full));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts'))
      continue;
    newest = Math.max(newest, (await fs.stat(full)).mtimeMs);
  }
  return newest;
}

async function distIsFresh(): Promise<boolean> {
  try {
    const built = (await fs.stat(cliPath)).mtimeMs;
    return built >= (await newestSourceMtime(path.join(packageRoot, 'src')));
  } catch {
    return false;
  }
}

/**
 * Build `dist/cli.js` if it is missing or behind `src/`.
 *
 * turbo's `test` task depends on `^build` — upstream packages only — so a clean
 * checkout runs these suites with no binary to spawn. Rather than skip (which
 * is how an integration suite quietly stops integrating), they build it.
 *
 * The lock is a directory because `mkdir` is atomic and vitest runs each test
 * FILE in its own worker: without it, four workers would run tsup into the same
 * `dist` at once, and tsup starts by emptying it.
 */
export async function ensureCliBuilt(): Promise<void> {
  if (await distIsFresh()) return;

  const lock = path.join(
    packageRoot,
    'node_modules',
    '.cache',
    'jto-mcp-build'
  );
  await fs.mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch {
      if (await distIsFresh()) return;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for another worker's build (${lock})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  try {
    if (await distIsFresh()) return;
    await run(path.join(packageRoot, 'node_modules', '.bin', 'tsup'), [], {
      cwd: packageRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

export async function makeScratch(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

// ---------------------------------------------------------------------------
// The stock client
// ---------------------------------------------------------------------------

export interface StdioSession {
  client: Client;
  /** The `--output-dir` the server was started with. */
  outputRoot: string;
  /** Everything the child has written to stderr so far. */
  stderr(): string;
  close(): Promise<void>;
}

export interface SessionOptions {
  /**
   * Which era to open in. Omitted is the SDK client's own default, which is
   * the 2025-era `initialize` handshake — see `stdio-protocol.test.ts`.
   */
  versionNegotiation?: { mode: 'legacy' | 'auto' | { pin: string } };
  /** Reuse an existing output root instead of making one. */
  outputRoot?: string;
}

/**
 * Spawn the built binary and connect a stock client to it.
 *
 * `stderr: 'pipe'` rather than the default `'inherit'`: these suites assert on
 * what the server sends there, and inheriting would scatter it through vitest's
 * own output instead.
 */
export async function openSession(
  options: SessionOptions = {}
): Promise<StdioSession> {
  await ensureCliBuilt();
  const outputRoot = options.outputRoot ?? (await makeScratch('jto-mcp-e2e'));
  const owned = options.outputRoot === undefined;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, '--output-dir', outputRoot],
    stderr: 'pipe',
  });

  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk);
  });

  const client = new Client(
    { name: 'jto-e2e-client', version: '1.0.0' },
    options.versionNegotiation !== undefined
      ? { versionNegotiation: options.versionNegotiation }
      : {}
  );
  await client.connect(transport);

  return {
    client,
    outputRoot,
    stderr: () => stderr,
    close: async () => {
      await client.close();
      if (owned) await fs.rm(outputRoot, { recursive: true, force: true });
    },
  };
}

/** The shape every tool in this server answers with. */
export interface ToolEnvelope {
  ok: boolean;
  diagnostics: Array<{
    severity: string;
    code: string;
    message: string;
    path?: string;
    suggestion?: string;
    context?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

/**
 * Call a tool and read its structured output.
 *
 * Fails loudly on `isError`, because every suite here that calls this is
 * asserting on a document or a workspace — and a tool that could not even parse
 * its arguments has not answered that question. The tests that WANT `isError`
 * call `client.callTool` directly.
 */
export async function callTool(
  session: StdioSession,
  name: string,
  args: Record<string, unknown>
): Promise<ToolEnvelope> {
  const result = await session.client.callTool({ name, arguments: args });
  if (result.isError === true) {
    throw new Error(
      `${name} returned isError: ${JSON.stringify(result.content)}`
    );
  }
  return result.structuredContent as unknown as ToolEnvelope;
}

// ---------------------------------------------------------------------------
// The hand-rolled client
// ---------------------------------------------------------------------------

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * A JSON-RPC peer that owns its pipes.
 *
 * The SDK client hides the wire, which is exactly what two of the requirements
 * are about: that stdout carries nothing but frames, and that a handle-based
 * edit is genuinely small when measured in bytes rather than in intent. Both
 * need the bytes, so this keeps them.
 */
export class RawStdioServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private stdout = '';
  private stderrText = '';
  private nextId = 1;

  /**
   * How far into `stdout` the line splitter has already looked.
   *
   * Rescanning the whole buffer on every poll would be quadratic, and one of
   * these frames is 3 MB of JSON Schema arriving in a few hundred chunks.
   */
  private parsed = 0;
  private readonly received = new Map<number | string, JsonRpcMessage>();

  /** Every frame written to the child, in order, as it went out. */
  readonly sent: string[] = [];

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.stdout += chunk;
      this.drain();
    });
    child.stderr.on('data', (chunk: string) => {
      this.stderrText += chunk;
    });
  }

  /** Parse whatever whole lines have arrived since the last call. */
  private drain(): void {
    for (;;) {
      const end = this.stdout.indexOf('\n', this.parsed);
      if (end < 0) return;
      const line = this.stdout.slice(this.parsed, end);
      this.parsed = end + 1;
      if (line.trim() === '') continue;
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (message.id !== undefined) this.received.set(message.id, message);
      } catch {
        /* not a frame: `stdoutLines` is what reports on those */
      }
    }
  }

  static async start(outputRoot: string): Promise<RawStdioServer> {
    await ensureCliBuilt();
    return new RawStdioServer(
      spawn(process.execPath, [cliPath, '--output-dir', outputRoot], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );
  }

  /** Raw stdout, exactly as the child wrote it. */
  rawStdout(): string {
    return this.stdout;
  }

  rawStderr(): string {
    return this.stderrText;
  }

  /**
   * Wait until stderr carries `needle`.
   *
   * Polled rather than slept: how long the child takes to write a diagnostic
   * depends on how loaded the machine is, and a fixed sleep long enough for a
   * busy CI box is a fixed cost on every other run.
   */
  async waitForStderr(needle: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.stderrText.includes(needle)) {
      if (Date.now() > deadline) {
        throw new Error(
          `stderr never mentioned "${needle}" within ${timeoutMs}ms; saw: ${
            this.stderrText || '(nothing)'
          }`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Non-empty stdout lines. Every one of them must be a JSON-RPC frame. */
  stdoutLines(): string[] {
    return this.stdout.split('\n').filter((line) => line.trim() !== '');
  }

  /** Write a frame verbatim — including deliberately malformed ones. */
  writeRaw(line: string): void {
    this.sent.push(line);
    this.child.stdin.write(`${line}\n`);
  }

  send(message: Omit<JsonRpcMessage, 'jsonrpc'>): void {
    this.writeRaw(JSON.stringify({ jsonrpc: '2.0', ...message }));
  }

  /** Send a request and resolve with its response. Returns the id it used. */
  request(method: string, params?: unknown): { id: number } {
    const id = this.nextId++;
    this.send({ id, method, ...(params !== undefined && { params }) });
    return { id };
  }

  /** Wait for the response to `id`. */
  async waitFor(id: number, timeoutMs = 60_000): Promise<JsonRpcMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const message = this.received.get(id);
      if (message !== undefined) return message;
      if (Date.now() > deadline) {
        throw new Error(
          `No response to request ${id} within ${timeoutMs}ms. stderr: ${this.stderrText}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async call(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<JsonRpcMessage> {
    const { id } = this.request(method, params);
    return this.waitFor(id, timeoutMs);
  }

  /** The 2025-era opening: a bare `initialize`, with no modern envelope claim. */
  async openLegacy(protocolVersion = '2025-06-18'): Promise<JsonRpcMessage> {
    const opened = await this.call('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'jto-raw-client', version: '1.0.0' },
    });
    this.send({ method: 'notifications/initialized' });
    return opened;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<JsonRpcMessage> {
    return this.call('tools/call', { name, arguments: args }, timeoutMs);
  }

  /** Bytes this peer has written to the child's stdin so far. */
  bytesSent(): number {
    return this.sent.reduce((total, line) => total + line.length + 1, 0);
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) return resolve();
      this.child.once('exit', () => resolve());
      setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 5_000).unref();
    });
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * RFC 6901 read/write, written here rather than imported from `src/workspace/`.
 *
 * The journey suite repairs a document by following the pointer a diagnostic
 * handed it. Resolving that pointer with the server's own module would make the
 * test agree with the implementation by construction, which is the one thing it
 * is trying to prove.
 */
function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function pointerGet(document: unknown, pointer: string): unknown {
  let node: any = document;
  for (const segment of pointerSegments(pointer)) {
    if (node === undefined || node === null) return undefined;
    node = node[segment];
  }
  return node;
}

export function pointerSet(
  document: unknown,
  pointer: string,
  value: unknown
): void {
  const segments = pointerSegments(pointer);
  const last = segments.pop();
  if (last === undefined) throw new Error('Cannot set the whole document');
  let node: any = document;
  for (const segment of segments) node = node[segment];
  node[last] = value;
}

/**
 * The first string-valued prop in a document, as a JSON Pointer.
 *
 * Used to break a document the server itself supplied, without the test
 * knowing anything about which component or prop it is picking on.
 */
export function firstStringProp(
  document: unknown
): { pointer: string; value: string } | undefined {
  const walk = (
    node: any,
    base: string
  ): { pointer: string; value: string } | undefined => {
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const found = walk(node[index], `${base}/${index}`);
        if (found) return found;
      }
      return undefined;
    }
    if (node === null || typeof node !== 'object') return undefined;
    if (node.props !== null && typeof node.props === 'object') {
      for (const [key, value] of Object.entries(node.props)) {
        if (typeof value === 'string')
          return { pointer: `${base}/props/${key}`, value };
      }
    }
    if (Array.isArray(node.children))
      return walk(node.children, `${base}/children`);
    return undefined;
  };
  return walk(document, '');
}

/** A `.docx`/`.pptx` is a zip; anything else on disk is not the file we asked for. */
export const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Is `file` a direct child of `root`, on the filesystem rather than in string
 * form? macOS hands out `/var/folders/...` temp dirs that are really
 * `/private/var/folders/...`, so comparing the paths as written fails on the
 * one platform where the output-root contract is easiest to get wrong.
 */
export async function parentDirOf(file: string): Promise<string> {
  return path.dirname(await fs.realpath(file));
}

export async function realRoot(root: string): Promise<string> {
  return fs.realpath(root);
}

/**
 * A document big enough that generating it takes seconds rather than
 * milliseconds, so a cancellation can land mid-render, and big enough that
 * "resend the whole thing" and "send a patch" are visibly different sizes.
 */
export function bulkyDocx(paragraphs: number): Record<string, unknown> {
  return {
    name: 'docx',
    props: { metadata: { title: 'Bulk report' } },
    children: [
      {
        name: 'section',
        children: [
          { name: 'heading', props: { text: 'Bulk report', level: 1 } },
          ...Array.from({ length: paragraphs }, (_, index) => ({
            name: 'paragraph',
            props: {
              text: `Paragraph ${index}: enough words here to weigh something on the wire.`,
            },
          })),
        ],
      },
    ],
  };
}

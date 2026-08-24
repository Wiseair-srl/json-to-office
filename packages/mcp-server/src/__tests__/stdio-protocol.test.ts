/**
 * #203 and #204's protocol guarantees, checked where they can actually break.
 *
 * Three things here are invisible to an in-process transport and so cannot be
 * covered anywhere else: that the child's stdout is nothing but JSON-RPC frames,
 * that its diagnostics come out of the other pipe, and that both the 2025-era
 * and the modern opening reach the same server through one factory.
 *
 * The fourth — "a broken document is a result, not an error" — is checked from
 * the raw wire on purpose. `isError` and a JSON-RPC `error` are the same thing
 * to a client that only looks at whether the promise rejected; the difference
 * is in the frame, so the frame is what gets asserted.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs/promises';

import {
  bulkyDocx,
  makeScratch,
  openSession,
  RawStdioServer,
  type JsonRpcMessage,
  type StdioSession,
} from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_TIMEOUT_MS = 180_000;

const VALID_DOCX = {
  name: 'docx',
  props: { metadata: { title: 'Protocol' } },
  children: [
    {
      name: 'section',
      children: [{ name: 'paragraph', props: { text: 'One paragraph.' } }],
    },
  ],
};

/** A `text` where the schema wants a string is a defect with a known location. */
const BROKEN_DOCX = {
  name: 'docx',
  props: { metadata: { title: 'Protocol' } },
  children: [
    {
      name: 'section',
      children: [{ name: 'paragraph', props: { text: { not: 'a string' } } }],
    },
  ],
};

const scratches: string[] = [];
const sessions: StdioSession[] = [];
const servers: RawStdioServer[] = [];

async function rawServer(): Promise<RawStdioServer> {
  const root = await makeScratch('jto-mcp-proto');
  scratches.push(root);
  const server = await RawStdioServer.start(root);
  servers.push(server);
  return server;
}

async function session(
  options: Parameters<typeof openSession>[0] = {}
): Promise<StdioSession> {
  const opened = await openSession(options);
  sessions.push(opened);
  return opened;
}

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(sessions.map((entry) => entry.close()));
  await Promise.all(
    scratches.map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

function isJsonRpcFrame(line: string): boolean {
  let parsed: JsonRpcMessage;
  try {
    parsed = JSON.parse(line) as JsonRpcMessage;
  } catch {
    return false;
  }
  if (parsed.jsonrpc !== '2.0') return false;
  return (
    typeof parsed.method === 'string' ||
    parsed.result !== undefined ||
    parsed.error !== undefined
  );
}

describe('stdout carries protocol frames and nothing else', () => {
  it(
    'stays parseable through a full session, large frames included',
    async () => {
      const server = await rawServer();
      await server.openLegacy();

      await server.call('tools/list');
      await server.call('resources/list');
      // The 3 MB schema: many chunks, one frame. This is where a stray write
      // would be least likely to survive review and most likely to be fatal.
      await server.call('resources/read', {
        uri: 'jto://schema/docx/document',
      });
      await server.callTool('jto_generate', {
        format: 'docx',
        document: VALID_DOCX,
        filename: 'hygiene.docx',
      });
      await server.callTool('jto_validate', {
        format: 'docx',
        document: BROKEN_DOCX,
      });
      await server.call('tools/call', { name: 'jto_nope', arguments: {} });

      const lines = server.stdoutLines();
      expect(lines.length).toBeGreaterThan(5);
      const strays = lines.filter((line) => !isJsonRpcFrame(line));
      expect(
        strays,
        `non-protocol output on stdout:\n${strays.slice(0, 3).join('\n')}`
      ).toEqual([]);

      // Nothing outside a frame either: concatenating the frames back with the
      // separators has to reproduce the stream byte for byte.
      expect(server.rawStdout()).toBe(`${lines.join('\n')}\n`);
    },
    SLOW_TIMEOUT_MS
  );

  it(
    'sends its own diagnostics to stderr while stdout stays empty',
    async () => {
      const server = await rawServer();

      // A JSON-RPC response before any era is negotiated: nothing to answer, but
      // something the operator should be told about.
      server.send({ id: 999, result: {} });
      await server.waitForStderr('jto-mcp:');

      expect(server.rawStdout()).toBe('');

      // And it was a diagnostic, not a failure: the connection still opens.
      const opened = await server.openLegacy();
      expect((opened.result as any).serverInfo.name).toBe('json-to-office');
      const info = await server.callTool('jto_info', {});
      expect((info.result as any).structuredContent.ok).toBe(true);
      expect(server.stdoutLines().every(isJsonRpcFrame)).toBe(true);
    },
    CONNECT_TIMEOUT_MS
  );
});

describe('document defects are results, not errors', () => {
  it(
    'answers a broken document with a plain result carrying diagnostics',
    async () => {
      const server = await rawServer();
      await server.openLegacy();

      const response = await server.callTool('jto_validate', {
        format: 'docx',
        document: BROKEN_DOCX,
      });

      // The three ways this could have gone wrong, in the order they matter.
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(response.result?.isError).toBeFalsy();

      const structured = response.result?.structuredContent as Record<
        string,
        any
      >;
      expect(structured.ok).toBe(false);
      expect(structured.valid).toBe(false);
      expect(structured.diagnostics.length).toBeGreaterThan(0);
      expect(structured.diagnostics[0].path).toMatch(/^\/children\//);

      // The text block is the same object, for clients with no structured output.
      const [content] = response.result?.content as [
        { type: string; text: string },
      ];
      expect(content.type).toBe('text');
      expect(JSON.parse(content.text)).toEqual(structured);
    },
    CONNECT_TIMEOUT_MS
  );

  const requestDefects: Array<{
    label: string;
    tool: string;
    args: Record<string, unknown>;
    code: string;
  }> = [
    {
      label: 'an unknown workspace handle',
      tool: 'jto_validate',
      args: { format: 'docx', handle: 'ws_not_a_real_handle' },
      code: 'E_UNKNOWN_HANDLE',
    },
    {
      label: 'no document at all',
      tool: 'jto_validate',
      args: { format: 'docx' },
      code: 'E_DOC_SOURCE_MISSING',
    },
    {
      label: 'both a document and a handle',
      tool: 'jto_validate',
      args: { format: 'docx', document: VALID_DOCX, handle: 'ws_x' },
      code: 'E_DOC_SOURCE_AMBIGUOUS',
    },
    {
      label: 'a filename that escapes the output root',
      tool: 'jto_generate',
      args: {
        format: 'docx',
        document: VALID_DOCX,
        filename: '../escaped.docx',
      },
      code: 'E_OUTPUT_ROOT_ESCAPE',
    },
    {
      label: 'a renderer that does not exist',
      tool: 'jto_validate',
      args: { format: 'docx', document: VALID_DOCX, renderer: 'no-such' },
      code: 'E_UNKNOWN_RENDERER',
    },
  ];

  it(
    'answers every request-level defect with a coded diagnostic, not a failure',
    async () => {
      const server = await rawServer();
      await server.openLegacy();

      for (const defect of requestDefects) {
        const response = await server.callTool(defect.tool, defect.args);
        expect(response.error, defect.label).toBeUndefined();
        expect(response.result?.isError, defect.label).toBeFalsy();

        const structured = response.result?.structuredContent as Record<
          string,
          any
        >;
        expect(structured.ok, defect.label).toBe(false);
        expect(
          structured.diagnostics.map((entry: any) => entry.code),
          defect.label
        ).toContain(defect.code);
      }
    },
    CONNECT_TIMEOUT_MS
  );

  it(
    'answers malformed ARGUMENTS with isError, still not a protocol error',
    async () => {
      const server = await rawServer();
      await server.openLegacy();

      // A defect in the request, not in a document — the SDK's input validation
      // catches it, and #204 requires it to stay inside a result all the same.
      const response = await server.callTool('jto_validate', {
        format: 'xlsx',
      });
      expect(response.error).toBeUndefined();
      expect(response.result?.isError).toBe(true);
      expect(JSON.stringify(response.result?.content)).toContain('format');
    },
    CONNECT_TIMEOUT_MS
  );

  it(
    'reserves the JSON-RPC error channel for calls it cannot route',
    async () => {
      const server = await rawServer();
      await server.openLegacy();

      // The counterexample that gives the rule its meaning: no tool, no result.
      const response = await server.call('tools/call', {
        name: 'jto_definitely_not_a_tool',
        arguments: {},
      });
      expect(response.result).toBeUndefined();
      expect(response.error?.code).toBe(-32602);
    },
    CONNECT_TIMEOUT_MS
  );
});

describe('protocol eras', () => {
  /**
   * `serveStdio` is configured with `legacy: 'serve'`, so one factory has to
   * answer both openings. The installed client can drive either — its default
   * IS the 2025-era `initialize` handshake, and `{ pin }` selects the modern
   * one — so both are genuinely exercised here rather than described.
   */
  it(
    'serves the SDK client on its default 2025-era opening',
    async () => {
      const opened = await session();
      expect(opened.client.getProtocolEra()).toBe('legacy');
      expect(opened.client.getNegotiatedProtocolVersion()).toMatch(/^2025-/);

      const { tools } = await opened.client.listTools();
      expect(tools.map((tool) => tool.name)).toContain('jto_generate');
      const info = await opened.client.callTool({
        name: 'jto_info',
        arguments: {},
      });
      expect((info.structuredContent as any).ok).toBe(true);
    },
    CONNECT_TIMEOUT_MS
  );

  it(
    'serves a modern opening from the same factory, with the same surface',
    async () => {
      const legacy = await session();
      const modern = await session({
        versionNegotiation: { mode: { pin: '2026-07-28' } },
      });

      expect(modern.client.getProtocolEra()).toBe('modern');
      expect(modern.client.getNegotiatedProtocolVersion()).toBe('2026-07-28');

      const legacyTools = (await legacy.client.listTools()).tools
        .map((tool) => tool.name)
        .sort();
      const modernTools = (await modern.client.listTools()).tools
        .map((tool) => tool.name)
        .sort();
      expect(modernTools).toEqual(legacyTools);

      const validated = await modern.client.callTool({
        name: 'jto_validate',
        arguments: { format: 'docx', document: BROKEN_DOCX },
      });
      expect(validated.isError).toBeFalsy();
      expect((validated.structuredContent as any).ok).toBe(false);
    },
    CONNECT_TIMEOUT_MS
  );

  it(
    'probes its way to the modern era when asked to negotiate',
    async () => {
      const auto = await session({ versionNegotiation: { mode: 'auto' } });
      expect(auto.client.getProtocolEra()).toBe('modern');
    },
    CONNECT_TIMEOUT_MS
  );

  it(
    'echoes a hand-written 2025 initialize back at the version it asked for',
    async () => {
      const server = await rawServer();
      const opened = await server.openLegacy('2025-06-18');

      const result = opened.result as any;
      expect(result.protocolVersion).toBe('2025-06-18');
      expect(result.serverInfo).toMatchObject({ name: 'json-to-office' });
      expect(result.capabilities.tools).toBeDefined();
      expect(result.capabilities.resources).toBeDefined();
      // The server's own prompt, which is how a client learns the working rules.
      expect(result.instructions).toContain('jto_validate');

      const listed = await server.call('tools/list');
      expect((listed.result as any).tools.length).toBeGreaterThan(5);
    },
    CONNECT_TIMEOUT_MS
  );
});

describe('cancellation', () => {
  it(
    'abandons a running generate without writing a file or losing the connection',
    async () => {
      const opened = await session();

      // Big enough that the render is still going a tenth of a second in: the
      // same document takes seconds, so the abort lands mid-flight with room to
      // spare even on a slow runner.
      const pending = opened.client.callTool(
        {
          name: 'jto_generate',
          arguments: {
            format: 'docx',
            document: bulkyDocx(20_000),
            filename: 'cancelled.docx',
          },
        },
        { signal: AbortSignal.timeout(100) }
      );

      await expect(pending).rejects.toThrow();

      // The connection is the thing that must survive.
      const info = await opened.client.callTool({
        name: 'jto_info',
        arguments: {},
      });
      expect((info.structuredContent as any).ok).toBe(true);

      // And the abort reached the handler: `jto_generate` re-checks the signal
      // before delivering, so a cancelled render leaves nothing behind. Polled
      // rather than slept on, so a late write would still be caught.
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        expect(await fs.readdir(opened.outputRoot)).not.toContain(
          'cancelled.docx'
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
    SLOW_TIMEOUT_MS
  );
});

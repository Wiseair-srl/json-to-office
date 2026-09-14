/**
 * `jto_generate` — both formats, both delivery modes, and the two behaviours
 * that only exist between the server and the transport: cancellation and
 * progress.
 *
 * Those last two are driven through the registered callback with a stand-in
 * context rather than a real client, because what matters is what the SERVER
 * does with `signal` and `progressToken` — a client's handling of the
 * resulting notification is its own business, and asserting it here would be
 * testing the SDK.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import * as fs from 'fs/promises';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createToolDeps, type ToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { register } from '../tools/generate.js';

const GENERATION_TIMEOUT_MS = 60_000;

const DOCX = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'Quarterly Review', level: 1 } },
    { name: 'paragraph', props: { text: 'Revenue grew 12% year on year.' } },
  ],
};

const PPTX = {
  name: 'pptx',
  props: {},
  children: [
    {
      name: 'slide',
      props: {},
      children: [{ name: 'text', props: { text: 'Q3 results' } }],
    },
  ],
};

/** Office files are ZIP containers; anything else is not one. */
function isOfficePackage(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

let scratch: string;
let deps: ToolDeps;
let client: Client;

function makeDeps(): ToolDeps {
  return createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
  });
}

async function connect(): Promise<Client> {
  const server = new McpServer(
    { name: 'json-to-office', version: '9.9.9-test' },
    { capabilities: { tools: {} } }
  );
  register(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    connected.connect(clientTransport),
  ]);
  return connected;
}

async function generate(
  args: Record<string, unknown>
): Promise<Record<string, any>> {
  const called = await client.callTool({
    name: 'jto_generate',
    arguments: args,
  });
  expect(called.isError).toBeFalsy();
  return called.structuredContent as Record<string, any>;
}

type Handler = (
  args: Record<string, unknown>,
  ctx: unknown
) => Promise<{ structuredContent: Record<string, any> }>;

/** The registered callback, without a transport in the way. */
function captureHandler(): Handler {
  let handler: Handler | undefined;
  const recorder = {
    registerTool: (_name: string, _config: unknown, cb: Handler) => {
      handler = cb;
    },
  } as unknown as McpServer;
  register(recorder, deps);
  if (!handler) throw new Error('jto_generate did not register a handler');
  return handler;
}

interface FakeContext {
  mcpReq: {
    signal: AbortSignal;
    _meta?: { progressToken?: string };
    notify: (notification: unknown) => Promise<void>;
  };
}

function fakeContext(options: {
  signal?: AbortSignal;
  progressToken?: string;
  notified?: unknown[];
}): FakeContext {
  return {
    mcpReq: {
      signal: options.signal ?? new AbortController().signal,
      ...(options.progressToken !== undefined && {
        _meta: { progressToken: options.progressToken },
      }),
      notify: async (notification: unknown) => {
        options.notified?.push(notification);
      },
    },
  };
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-generate-'));
  deps = makeDeps();
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('jto_generate', () => {
  it(
    'writes a real .docx under the output root',
    async () => {
      const result = await generate({ format: 'docx', document: DOCX });

      expect(result.ok).toBe(true);
      expect(result.format).toBe('docx');
      expect(result.artifact.mode).toBe('path');
      expect(result.artifact.filename).toBe('document.docx');
      expect(result.artifact.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      // The root is compared after realpath: the temp dir this test made is
      // reached through a symlink on macOS, and the server resolves it before
      // deciding a write is inside the root.
      const root = await fs.realpath(path.join(scratch, 'out'));
      expect(result.artifact.path).toBe(path.join(root, 'document.docx'));
      expect(result.artifact.relative).toBe('document.docx');

      const bytes = await fs.readFile(result.artifact.path);
      expect(bytes.byteLength).toBe(result.artifact.bytes);
      expect(isOfficePackage(bytes)).toBe(true);
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'writes a real .pptx under the output root',
    async () => {
      const result = await generate({
        format: 'pptx',
        document: PPTX,
        filename: 'deck.pptx',
      });

      expect(result.ok).toBe(true);
      expect(result.artifact.filename).toBe('deck.pptx');
      expect(result.artifact.relative).toBe('deck.pptx');

      const bytes = await fs.readFile(result.artifact.path);
      expect(isOfficePackage(bytes)).toBe(true);
      expect(result.artifact.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      );
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'inlines the bytes on request',
    async () => {
      const result = await generate({
        format: 'docx',
        document: DOCX,
        outputMode: 'base64',
      });

      expect(result.artifact.mode).toBe('base64');
      expect(result.artifact.path).toBeUndefined();
      const bytes = Buffer.from(result.artifact.base64, 'base64');
      expect(bytes.byteLength).toBe(result.artifact.bytes);
      expect(isOfficePackage(bytes)).toBe(true);
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'refuses to inline past the size limit rather than quietly writing a file',
    async () => {
      deps = createToolDeps({
        outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'tiny') }),
        maxInlineArtifactBytes: 64,
      });
      await client.close();
      client = await connect();

      const result = await generate({
        format: 'docx',
        document: DOCX,
        outputMode: 'base64',
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0].code).toBe('E_ARTIFACT_TOO_LARGE');
      expect(result.artifact).toBeUndefined();
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'reports a rejected document as diagnostics, not as a thrown error',
    async () => {
      const called = await client.callTool({
        name: 'jto_generate',
        arguments: {
          format: 'docx',
          document: {
            name: 'docx',
            props: {},
            children: [{ name: 'paragraph', props: { text: 42 } }],
          },
        },
      });
      const result = called.structuredContent as Record<string, any>;

      expect(called.isError).toBeFalsy();
      expect(result.ok).toBe(false);
      expect(result.artifact).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].path).toBe('/children/0/props/text');
      expect(result.diagnostics[0].code).not.toBe('E_INTERNAL');
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'tolerates unknown fields when asked to',
    async () => {
      const document = {
        name: 'docx',
        props: {},
        children: [
          { name: 'paragraph', props: { text: 'Hello', notAProp: true } },
        ],
      };

      const refused = await generate({ format: 'docx', document });
      expect(refused.ok).toBe(false);

      const allowed = await generate({
        format: 'docx',
        document,
        validation: { allowUnknownFields: true },
        filename: 'lenient.docx',
      });
      expect(allowed.ok).toBe(true);
      expect(isOfficePackage(await fs.readFile(allowed.artifact.path))).toBe(
        true
      );
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'never writes outside the output root',
    async () => {
      const result = await generate({
        format: 'docx',
        document: DOCX,
        filename: '../escaped.docx',
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0].code).toBe('E_OUTPUT_ROOT_ESCAPE');
      await expect(
        fs.access(path.join(scratch, 'escaped.docx'))
      ).rejects.toThrow();
    },
    GENERATION_TIMEOUT_MS
  );

  // The cores raise a plain Error over an unparseable stamp, which `guarded`
  // could only report as E_INTERNAL plus a stack trace — the code documented as
  // "always a bug here, never the caller's", handed back for the caller's own
  // one-character typo.
  it('refuses a generatedAt it cannot parse, as a repairable option error', async () => {
    const result = await generate({
      format: 'pptx',
      document: PPTX,
      generatedAt: 'not-a-date',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'E_INVALID_DATE',
      context: { option: 'generatedAt', value: 'not-a-date' },
    });
    expect(result.diagnostics[0].context.stack).toBeUndefined();
    expect(result.artifact).toBeUndefined();
  });

  it('refuses a generatedAt the ZIP container cannot express', async () => {
    const result = await generate({
      format: 'docx',
      document: DOCX,
      generatedAt: '1970-01-01T00:00:00Z',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_INVALID_DATE');
  });

  // The tool description promises unknown themes arrive as warnings. They used
  // to arrive as nothing at all: the render fell back and returned a file
  // byte-identical to one nobody asked for.
  it.each([
    [
      'pptx',
      PPTX,
      ['consulting', 'dark', 'default', 'devportal', 'minimal', 'vermilion'],
    ],
    ['docx', DOCX, ['consulting', 'devportal', 'minimal', 'vermilion']],
  ] as const)(
    'warns that a %s theme option matched nothing, and names the ones that would',
    async (format, document, themes) => {
      const result = await generate({
        format,
        document,
        theme: 'nope-theme',
        filename: `themed.${format}`,
      });

      expect(result.ok).toBe(true);
      const unknown = result.diagnostics.find(
        (entry: any) => entry.code === 'W_UNKNOWN_THEME'
      );
      expect(unknown).toBeDefined();
      expect(unknown.severity).toBe('warning');
      expect(unknown.message).toContain('nope-theme');
      expect(unknown.context.themes).toEqual(themes);
      for (const name of themes) expect(unknown.suggestion).toContain(name);
      // The theme did not happen, so nothing may claim it did.
      expect(result.theme).toBeUndefined();
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'says nothing about a theme that resolved',
    async () => {
      const result = await generate({
        format: 'docx',
        document: DOCX,
        theme: 'vermilion',
      });
      expect(result.theme).toBe('vermilion');
      expect(
        result.diagnostics.some((d: any) => d.code === 'W_UNKNOWN_THEME')
      ).toBe(false);
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    "warns about the document's own props.theme without repeating the core",
    async () => {
      const pptx = await generate({
        format: 'pptx',
        document: { ...PPTX, props: { theme: 'nope-theme' } },
        filename: 'doc-theme.pptx',
      });
      expect(pptx.ok).toBe(true);
      const warned = pptx.diagnostics.filter(
        (entry: any) => entry.code === 'W_UNKNOWN_THEME'
      );
      expect(warned).toHaveLength(1);
      expect(warned[0].context.source).toBe('props.theme');

      // The DOCX core reports this one itself — as `theme_not_found`, which
      // reaches the wire normalized to `W_THEME_NOT_FOUND` — so the tool stays
      // quiet; a second diagnostic saying the same thing would just cost the
      // agent tokens.
      const docx = await generate({
        format: 'docx',
        document: { ...DOCX, props: { theme: 'nope-theme' } },
        filename: 'doc-theme.docx',
      });
      expect(docx.diagnostics.map((entry: any) => entry.code).sort()).toEqual([
        'W_THEME_NOT_FOUND',
      ]);
      expect(docx.diagnostics[0].context.code).toBe('theme_not_found');
    },
    GENERATION_TIMEOUT_MS
  );

  // One wrong prop repeated down a long document used to come back once per
  // occurrence, all identical but for the path.
  it('collapses a repeated defect and caps what survives', async () => {
    const paragraphs = Array.from({ length: 40 }, () => ({
      name: 'paragraph',
      props: { text: 'Hello.', pageBreakBefore: true, bogusProp: 1 },
    }));
    const broken = { name: 'docx', props: {}, children: paragraphs };

    const result = await generate({ format: 'docx', document: broken });
    expect(result.ok).toBe(false);
    // Two defects, eighty occurrences: the agent learns both facts once each.
    expect(result.diagnostics).toHaveLength(2);
    expect(result.truncated).toBe(false);
    for (const entry of result.diagnostics) {
      expect(entry.context.occurrences).toBe(paragraphs.length);
      expect(entry.path).toMatch(/^\/children\/0\/props\//);
      // Collapsed, not lost: every place the defect sat is still addressable.
      expect(entry.context.paths).toHaveLength(paragraphs.length);
      expect(entry.context.paths[0]).toBe(entry.path);
      expect(entry.context.paths[39]).toMatch(/^\/children\/39\/props\//);
    }

    const capped = await generate({
      format: 'docx',
      document: broken,
      maxDiagnostics: 1,
    });
    expect(capped.diagnostics).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it('refuses an unknown renderer before doing any work', async () => {
    const result = await generate({
      format: 'pptx',
      document: PPTX,
      renderer: 'nope',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_UNKNOWN_RENDERER');
    expect(result.diagnostics[0].context.rendererIds).toEqual(
      expect.arrayContaining(['pptxgenjs', 'office-open'])
    );
  });

  it('rejects an executable theme module without importing it', async () => {
    const marker = path.join(scratch, 'executed');
    const themeModule = path.join(scratch, 'theme.mjs');
    await fs.writeFile(
      themeModule,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(
        marker
      )}, 'executed'); export default {};`
    );

    const result = await generate({
      format: 'docx',
      document: DOCX,
      themePath: themeModule,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_INVALID_THEME_PATH');
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it('bails out cleanly when the client has already cancelled', async () => {
    const handler = captureHandler();
    const result = await handler(
      { format: 'docx', document: DOCX },
      fakeContext({ signal: AbortSignal.abort() })
    );

    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.diagnostics[0].code).toBe('E_CANCELLED');
    expect(result.structuredContent.artifact).toBeUndefined();
    await expect(fs.readdir(path.join(scratch, 'out'))).rejects.toThrow();
  });

  it(
    'emits progress only when the client sent a token',
    async () => {
      const handler = captureHandler();

      const notified: unknown[] = [];
      const withToken = await handler(
        { format: 'docx', document: DOCX, filename: 'progress.docx' },
        fakeContext({ progressToken: 'tok-1', notified })
      );
      expect(withToken.structuredContent.ok).toBe(true);
      expect(notified.length).toBeGreaterThan(1);
      expect(notified[0]).toMatchObject({
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', total: 3 },
      });
      expect(notified.at(-1)).toMatchObject({
        params: { progress: 3, total: 3 },
      });

      const silent: unknown[] = [];
      await handler(
        { format: 'docx', document: DOCX, filename: 'silent.docx' },
        fakeContext({ notified: silent })
      );
      expect(silent).toEqual([]);
    },
    GENERATION_TIMEOUT_MS
  );
});

/**
 * An image file that is not there is the document's defect.
 *
 * The render used to fail with `E_INTERNAL` "Failed to load image from …" —
 * the code this server reserves for its own bugs — so an agent was sent to
 * report one when the repair was a path in its JSON.
 */
describe('image files', () => {
  /** 1×1 transparent PNG. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  const codesOf = (result: Record<string, any>): string[] =>
    result.diagnostics.map((entry: { code: string }) => entry.code);

  it(
    'blames the missing docx image, at its path, not the server',
    async () => {
      const result = await generate({
        format: 'docx',
        document: {
          ...DOCX,
          children: [
            ...DOCX.children,
            {
              name: 'image',
              props: { path: '/nonexistent/chart.png', width: 200 },
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      expect(result.artifact).toBeUndefined();
      expect(codesOf(result)).not.toContain('E_INTERNAL');
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'E_ASSET_UNREADABLE',
          path: '/children/2/props/path',
          context: expect.objectContaining({
            value: '/nonexistent/chart.png',
            reason: 'missing',
          }),
        })
      );
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'blames the missing pptx image the same way',
    async () => {
      // Inside baseDir, so the pptx pipeline really does go looking for it —
      // and it is pptxgenjs, at write time, that finds it absent.
      const result = await generate({
        format: 'pptx',
        document: {
          ...PPTX,
          children: [
            {
              name: 'slide',
              props: {},
              children: [
                { name: 'text', props: { text: 'Q3 results' } },
                {
                  name: 'image',
                  props: { path: 'missing/chart.png', x: 1, y: 1, w: 2, h: 2 },
                },
              ],
            },
          ],
        },
        baseDir: scratch,
        filename: 'missing-image.pptx',
      });

      expect(result.ok).toBe(false);
      expect(codesOf(result)).not.toContain('E_INTERNAL');
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'E_ASSET_UNREADABLE',
          path: '/children/0/children/1/props/path',
          context: expect.objectContaining({
            resolved: path.join(scratch, 'missing', 'chart.png'),
          }),
        })
      );
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'renders once the file is where baseDir says',
    async () => {
      await fs.mkdir(path.join(scratch, 'assets'));
      await fs.writeFile(path.join(scratch, 'assets', 'chart.png'), PNG);
      const result = await generate({
        format: 'docx',
        document: {
          ...DOCX,
          children: [
            ...DOCX.children,
            { name: 'image', props: { path: 'assets/chart.png', width: 20 } },
          ],
        },
        baseDir: scratch,
        filename: 'with-image.docx',
      });
      expect(result.ok).toBe(true);
      expect(result.artifact).toBeDefined();
    },
    GENERATION_TIMEOUT_MS
  );
});

/**
 * Images the document check cannot see, which only the render finds.
 *
 * The check reads local paths straight out of the document. A URL that does
 * not answer, or a path that reaches an image through a block's string slot,
 * is invisible to it, so the render's failure still escaped as `E_INTERNAL`.
 * What classifies it now is the name the cores give the error.
 */
describe('image sources only the render reads', () => {
  /** A remote host whose every image is gone. */
  let host: Server;
  let origin: string;

  beforeAll(async () => {
    host = createServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    });
    await new Promise<void>((resolve) =>
      host.listen(0, '127.0.0.1', () => resolve())
    );
    origin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    host.closeAllConnections();
    await new Promise((resolve) => host.close(resolve));
  });

  /** The one diagnostic that blames `source`, after checking nothing blames the server. */
  function unreadable(result: Record<string, any>, source: string) {
    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
    expect(
      result.diagnostics.map((entry: { code: string }) => entry.code)
    ).not.toContain('E_INTERNAL');
    const blamed = result.diagnostics.filter(
      (entry: { code: string; context?: { source?: string } }) =>
        entry.code === 'E_ASSET_UNREADABLE' && entry.context?.source === source
    );
    expect(blamed).toHaveLength(1);
    expect(blamed[0].severity).toBe('error');
    return blamed[0];
  }

  /** A block whose image path is a string slot, and one invocation filling it. */
  function slotted(format: 'docx' | 'pptx', src: string) {
    const size = format === 'pptx' ? { x: 1, y: 1, w: 2, h: 2 } : { width: 40 };
    const invocation = {
      name: 'block',
      props: { ref: 'logo', slots: { src } },
    };
    return {
      name: format,
      props: {
        blocks: {
          logo: {
            slots: { src: { type: 'string', required: true } },
            body: [
              { name: 'image', props: { path: { $slot: '/src' }, ...size } },
            ],
          },
        },
      },
      children: [
        format === 'pptx'
          ? { name: 'slide', props: {}, children: [invocation] }
          : { name: 'section', children: [invocation] },
      ],
    };
  }

  it(
    'blames a docx image URL that does not answer, with the status',
    async () => {
      const url = `${origin}/chart.png`;
      const result = await generate({
        format: 'docx',
        document: {
          ...DOCX,
          children: [
            ...DOCX.children,
            { name: 'image', props: { path: url, width: 200 } },
          ],
        },
      });

      const blamed = unreadable(result, url);
      // The loader used to swallow why; the status is the half an agent needs.
      expect(blamed.message).toContain('404');
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'blames a docx image path that arrives through a block slot',
    async () => {
      const result = await generate({
        format: 'docx',
        document: slotted('docx', '/nonexistent/logo.png'),
      });

      unreadable(result, '/nonexistent/logo.png');
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'blames a pptx image URL that does not answer, on office-open',
    async () => {
      const url = `${origin}/chart.png`;
      const result = await generate({
        format: 'pptx',
        renderer: 'office-open',
        document: {
          ...PPTX,
          children: [
            {
              name: 'slide',
              props: {},
              children: [
                { name: 'text', props: { text: 'Q3 results' } },
                {
                  name: 'image',
                  props: { path: url, x: 1, y: 1, w: 2, h: 2 },
                },
              ],
            },
          ],
        },
        filename: 'remote-image.pptx',
      });

      const blamed = unreadable(result, url);
      expect(blamed.message).toContain('404');
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'blames a pptx image file office-open cannot read, reached through a block slot',
    async () => {
      // Inside baseDir, so office-open really does go to read it.
      const result = await generate({
        format: 'pptx',
        renderer: 'office-open',
        document: slotted('pptx', 'missing/logo.png'),
        baseDir: scratch,
        filename: 'slot-image.pptx',
      });

      unreadable(result, path.join(scratch, 'missing', 'logo.png'));
    },
    GENERATION_TIMEOUT_MS
  );
});

describe('scaffold markers', () => {
  const SCAFFOLDED = {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      { name: 'heading', props: { text: '{{report title}}', level: 1 } },
      { name: 'paragraph', props: { text: 'Revenue grew 12% year on year.' } },
      { name: 'paragraph', props: { text: 'Outlook: {{outlook}}' } },
    ],
  };

  it(
    'refuses a document that still carries one, path-addressed',
    async () => {
      const result = await generate({ format: 'docx', document: SCAFFOLDED });
      expect(result.ok).toBe(false);
      expect(result.artifact).toBeUndefined();
      const markers = result.diagnostics.filter(
        (entry: { code: string }) => entry.code === 'E_SCAFFOLD_MARKER'
      );
      expect(markers.map((entry: { path: string }) => entry.path)).toEqual([
        '/children/0/props/text',
        '/children/2/props/text',
      ]);
      expect(markers[0]).toMatchObject({ severity: 'error' });
      expect(markers[0].message).toContain('{{report title}}');
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'renders once the markers are gone',
    async () => {
      const filled = {
        ...SCAFFOLDED,
        children: [
          { name: 'heading', props: { text: 'Quarterly Review', level: 1 } },
          SCAFFOLDED.children[1],
          { name: 'paragraph', props: { text: 'Outlook: steady.' } },
        ],
      };
      const result = await generate({ format: 'docx', document: filled });
      expect(result.ok).toBe(true);
      expect(result.artifact).toBeDefined();
    },
    GENERATION_TIMEOUT_MS
  );

  it(
    'lets filler through — only a marker is a refusal',
    async () => {
      const result = await generate({
        format: 'pptx',
        document: {
          name: 'pptx',
          props: { slideWidth: 13.333, slideHeight: 7.5 },
          children: [
            {
              name: 'slide',
              props: {},
              children: [
                { name: 'text', props: { text: 'Lorem ipsum dolor sit.' } },
              ],
            },
          ],
        },
      });
      expect(result.ok).toBe(true);
      expect(
        result.diagnostics.filter(
          (entry: { code: string }) => entry.code === 'E_SCAFFOLD_MARKER'
        )
      ).toEqual([]);
    },
    GENERATION_TIMEOUT_MS
  );
});

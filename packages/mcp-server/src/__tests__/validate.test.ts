/**
 * `jto_validate`, over a real protocol round trip.
 *
 * The tool is registered on its own server rather than through
 * `createServer`, so this suite depends on nothing but the module under test —
 * a sibling tool that fails to compile cannot make these go red for the wrong
 * reason.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { toJsonPointer } from '../lib/errors.js';
import { register } from '../tools/validate.js';

const VALID_DOCX = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'Service Agreement', level: 1 } },
    { name: 'paragraph', props: { text: 'Payment is due within 30 days.' } },
  ],
};

const VALID_PPTX = {
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

let scratch: string;
let client: Client;

async function connect(): Promise<Client> {
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
  });
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

async function validate(
  args: Record<string, unknown>
): Promise<{ result: Record<string, any>; isError: unknown }> {
  const called = await client.callTool({
    name: 'jto_validate',
    arguments: args,
  });
  return {
    result: called.structuredContent as Record<string, any>,
    isError: called.isError,
  };
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-validate-'));
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('toJsonPointer', () => {
  it('maps every dialect the validators emit onto RFC 6901', () => {
    // Root sentinels the two validators disagree on.
    expect(toJsonPointer('root')).toBe('');
    expect(toJsonPointer('/')).toBe('');
    expect(toJsonPointer('')).toBe('');

    // Already pointer-shaped: passed through.
    expect(toJsonPointer('/children/0/props/text')).toBe(
      '/children/0/props/text'
    );

    // The older component validators' JavaScript-ish spelling.
    expect(toJsonPointer('children[0].props.text')).toBe(
      '/children/0/props/text'
    );
    expect(toJsonPointer('name')).toBe('/name');

    // Characters RFC 6901 reserves, which no validator escapes itself.
    expect(toJsonPointer('props.a~b')).toBe('/props/a~0b');
    expect(toJsonPointer('props.a/b')).toBe('/props/a~1b');

    expect(toJsonPointer(undefined)).toBeUndefined();
  });
});

describe('jto_validate', () => {
  it('advertises input and output schemas the SDK enforces', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === 'jto_validate');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['format']);
    expect(
      (tool?.outputSchema as { required?: string[] } | undefined)?.required
    ).toEqual(expect.arrayContaining(['ok', 'diagnostics']));
  });

  it('accepts a valid document of either format', async () => {
    const docx = await validate({ format: 'docx', document: VALID_DOCX });
    expect(docx.result).toMatchObject({
      ok: true,
      valid: true,
      format: 'docx',
      diagnostics: [],
      counts: { error: 0, warning: 0, info: 0 },
      truncated: false,
      source: { origin: 'inline' },
    });

    const pptx = await validate({ format: 'pptx', document: VALID_PPTX });
    expect(pptx.result).toMatchObject({
      ok: true,
      valid: true,
      format: 'pptx',
    });
  });

  it('reports a broken document as a result, not a protocol error', async () => {
    const { result, isError } = await validate({
      format: 'docx',
      document: {
        name: 'docx',
        props: {},
        children: [
          { name: 'paragraph', props: { text: 42, bogusProp: true } },
          { name: 'not-a-component', props: {} },
        ],
      },
    });

    expect(isError).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.counts.error).toBeGreaterThan(0);

    // Every located diagnostic is a usable JSON Patch target.
    const paths = result.diagnostics.map((entry: any) => entry.path);
    expect(paths).toContain('/children/0/props/text');
    expect(paths).toContain('/children/1/name');
    for (const entry of result.diagnostics) {
      expect(entry.severity).toBe('error');
      expect(typeof entry.code).toBe('string');
      if (entry.path !== undefined) {
        expect(entry.path).toMatch(/^(\/[^/]*)*$/);
      }
    }
  });

  it('reports every defect in the published code vocabulary', async () => {
    // The four defects an agent actually makes. Each used to arrive as a
    // stringified TypeBox ValueErrorType ordinal — "42", "54", "45" — which
    // appears in no table we publish and renumbers on a TypeBox upgrade, so an
    // agent branching on `code` matched nothing.
    const { result } = await validate({
      format: 'docx',
      document: {
        name: 'docx',
        props: {},
        children: [
          { name: 'paragraph', props: { text: 42 } },
          { name: 'paragraph', props: { text: 'ok', bogusProp: true } },
          { name: 'paragraph', props: {} },
          { name: 'not-a-component', props: {} },
        ],
      },
    });

    const byPath = new Map<string, string>(
      result.diagnostics.map((entry: any) => [entry.path, entry.code])
    );
    expect(byPath.get('/children/0/props/text')).toBe('E_TYPE_MISMATCH');
    expect(byPath.get('/children/1/props/bogusProp')).toBe(
      'E_UNEXPECTED_PROPERTY'
    );
    expect(byPath.get('/children/2/props/text')).toBe('E_REQUIRED_PROPERTY');

    for (const entry of result.diagnostics) {
      expect(entry.code).toMatch(/^[EW]_[A-Z_]+$/);
    }

    // One missing property is one repair, not two: the type complaint TypeBox
    // adds about the same absent value is dropped.
    const missing = result.diagnostics.filter(
      (entry: any) => entry.path === '/children/2/props/text'
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].context.validatorCode).toBe('45');
  });

  it('keeps renderer-profile findings out of the generation verdict', async () => {
    const deck = {
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: { transition: { type: 'fade' } },
          children: [],
        },
      ],
    };

    // pptxgenjs (the default) cannot draw transitions. The compiler, not the
    // schema, decides — so this is a warning and the document still passes.
    const { result } = await validate({ format: 'pptx', document: deck });
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ error: 0, warning: 1 });
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'W_UNSUPPORTED_RENDERER_FEATURE',
      path: '/children/0/props/transition',
      context: { validatorCode: 'unsupported_renderer_feature' },
    });

    // The other profile supports them outright.
    const officeOpen = await validate({
      format: 'pptx',
      document: deck,
      renderer: 'office-open',
    });
    expect(officeOpen.result).toMatchObject({
      ok: true,
      renderer: 'office-open',
      diagnostics: [],
    });
  });

  it('validates against the requested profile without touching the document', async () => {
    const deck = {
      name: 'pptx',
      renderer: 'office-open',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [{ name: 'image', props: { svg: '<svg />' } }],
        },
      ],
    };

    // office-open cannot rasterize inline SVG; the document says so itself.
    const own = await validate({ format: 'pptx', document: deck });
    expect(own.result.counts.warning).toBeGreaterThan(0);

    // Overriding the profile answers "would this render under pptxgenjs?"
    const overridden = await validate({
      format: 'pptx',
      document: deck,
      renderer: 'pptxgenjs',
    });
    expect(overridden.result).toMatchObject({ ok: true, diagnostics: [] });
    expect(deck.renderer).toBe('office-open');
  });

  it('refuses an unknown renderer and names the real ones', async () => {
    const { result, isError } = await validate({
      format: 'docx',
      document: VALID_DOCX,
      renderer: 'not-a-renderer',
    });
    expect(isError).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_UNKNOWN_RENDERER');
    expect(result.diagnostics[0].context.rendererIds).toContain('docxjs');
  });

  it('rejects an ambiguous or absent document source structurally', async () => {
    const missing = await validate({ format: 'docx' });
    expect(missing.result.diagnostics[0].code).toBe('E_DOC_SOURCE_MISSING');

    const both = await validate({
      format: 'docx',
      document: VALID_DOCX,
      handle: 'ws_1',
    });
    expect(both.result.diagnostics[0].code).toBe('E_DOC_SOURCE_AMBIGUOUS');
  });

  it('caps diagnostics without dropping the errors', async () => {
    const children = Array.from({ length: 12 }, () => ({
      name: 'paragraph',
      props: { text: 7 },
    }));
    const { result } = await validate({
      format: 'docx',
      document: { name: 'docx', props: {}, children },
      maxDiagnostics: 3,
    });

    expect(result.truncated).toBe(true);
    expect(result.diagnostics).toHaveLength(3);
    expect(result.counts.error).toBeGreaterThan(3);
    for (const entry of result.diagnostics) {
      expect(entry.severity).toBe('error');
    }
  });

  it('answers a handle with a structured failure when no store is installed', async () => {
    const { result, isError } = await validate({
      format: 'docx',
      handle: 'ws_nope',
    });
    expect(isError).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_WORKSPACES_UNAVAILABLE');
  });
});

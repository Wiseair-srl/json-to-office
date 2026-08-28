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
import {
  QualityEngine,
  type QualityAnalysis,
  type QualityRule,
} from '@json-to-office/quality';

import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import {
  getAdapter,
  type FormatAdapter,
  type FormatName,
} from '../lib/adapters.js';
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
  props: { slideWidth: 13.333, slideHeight: 7.5 },
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

async function connect(
  getAdapterFor?: (format: FormatName) => FormatAdapter
): Promise<Client> {
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
    ...(getAdapterFor && { getAdapter: getAdapterFor }),
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
  args: Record<string, unknown>,
  on: Client = client
): Promise<{ result: Record<string, any>; isError: unknown }> {
  const called = await on.callTool({
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
      props: { slideWidth: 13.333, slideHeight: 7.5 },
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
      props: { slideWidth: 13.333, slideHeight: 7.5 },
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

  it('keeps blocking diagnostics ahead of advisory peers when capped', async () => {
    const stubbed = await connect((format) => {
      const real = getAdapter(format);
      return {
        ...real,
        validateDocument: real.validateDocument.bind(real),
        rendererIds: real.rendererIds.bind(real),
        rendererStatuses: real.rendererStatuses.bind(real),
        async analyzeQuality(): Promise<QualityAnalysis> {
          return {
            diagnostics: [
              {
                source: 'quality',
                ruleId: 'pptx/advisory',
                code: 'W_QUALITY_ADVISORY',
                category: 'composition',
                certainty: 'deterministic',
                severity: 'warning',
                message: 'Advisory warning.',
                path: '/children/0',
                blocking: false,
              },
              {
                source: 'quality',
                ruleId: 'pptx/blocking',
                code: 'W_QUALITY_BLOCKING',
                category: 'composition',
                certainty: 'deterministic',
                severity: 'warning',
                message: 'Blocking warning.',
                path: '/children/0/props',
                blocking: true,
              },
            ],
            counts: { error: 0, warning: 2, info: 0 },
            blocked: true,
            truncated: false,
            suppressedCount: 0,
            evaluatedRuleIds: ['pptx/advisory', 'pptx/blocking'],
            ruleErrors: [],
          };
        },
      };
    });

    try {
      const { result } = await validate(
        { format: 'pptx', document: VALID_PPTX, maxDiagnostics: 1 },
        stubbed
      );
      expect(result).toMatchObject({
        ok: false,
        valid: false,
        truncated: true,
      });
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'W_QUALITY_BLOCKING',
          blocking: true,
        }),
      ]);
    } finally {
      await stubbed.close();
    }
  });

  it('reports design-quality findings without moving the gate', async () => {
    // No canvas, a box that cannot hold its text, an unreadable font size:
    // all schema-valid, all wrong, all repairable from the diagnostics alone.
    const { result } = await validate({
      format: 'pptx',
      document: {
        name: 'pptx',
        props: {},
        children: [
          {
            name: 'slide',
            children: [
              {
                name: 'text',
                props: {
                  text: 'word '.repeat(120).trim(),
                  fontSize: 18,
                  x: 1,
                  y: 1,
                  w: 2,
                  h: 0.5,
                },
              },
              { name: 'text', props: { text: 'fine print', fontSize: 5 } },
            ],
          },
        ],
      },
    });

    // Quality never blocks: the document still validates and still generates.
    expect(result.ok).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.counts.error).toBe(0);

    const byCode = new Map<string, any>(
      result.diagnostics.map((entry: any) => [entry.code, entry])
    );
    expect(byCode.get('W_QUALITY_CANVAS_UNSPECIFIED')).toMatchObject({
      severity: 'warning',
      path: '/props',
    });
    expect(byCode.get('W_QUALITY_TEXT_OVERFLOW')).toMatchObject({
      severity: 'warning',
      path: '/children/0/children/0',
    });
    expect(byCode.get('W_QUALITY_FONT_SIZE_MIN')).toMatchObject({
      severity: 'warning',
      path: '/children/0/children/1/props',
    });
    for (const entry of result.diagnostics) {
      expect(entry.code).toMatch(/^W_QUALITY_/);
      expect(['warning', 'info']).toContain(entry.severity);
      expect(typeof entry.suggestion).toBe('string');
    }
  });

  it('moves the gate when the run policy requests it', async () => {
    const { result, isError } = await validate({
      format: 'pptx',
      document: {
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [
          {
            name: 'slide',
            children: [
              { name: 'text', props: { text: 'Too small', fontSize: 5 } },
            ],
          },
        ],
      },
      quality: { policy: { gate: 'warning' } },
    });

    expect(isError).toBeFalsy();
    expect(result).toMatchObject({ ok: false, valid: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_QUALITY_FONT_SIZE_MIN',
        blocking: true,
        source: 'quality',
        certainty: 'measured',
      })
    );
  });

  it('follows the gate rather than the severity a policy chose', async () => {
    // A policy that raises one rule to `error` and asks for no gate. The
    // finding is severe and the document still generates, so `ok` has to
    // answer for the gate — reading it off the error tally instead called a
    // renderable document invalid, which is the one verdict a caller acts on.
    const { result } = await validate({
      format: 'pptx',
      document: {
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [
          {
            name: 'slide',
            children: [
              { name: 'text', props: { text: 'Too small', fontSize: 5 } },
            ],
          },
        ],
      },
      quality: {
        policy: { rules: { 'pptx/minimum-font-size': { severity: 'error' } } },
      },
    });

    expect(result).toMatchObject({ ok: true, valid: true });
    expect(result.counts.error).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_QUALITY_FONT_SIZE_MIN',
        severity: 'error',
        blocking: false,
      })
    );
  });

  it('reports the analysis budget as a truncation of its own', async () => {
    // `truncated` used to answer only for this tool's own cap, so a report the
    // policy budget had already shortened came back reading complete.
    const { result } = await validate({
      format: 'pptx',
      document: {
        name: 'pptx',
        props: {},
        children: [
          {
            name: 'slide',
            children: [
              { name: 'text', props: { text: 'fine print', fontSize: 5 } },
            ],
          },
        ],
      },
      quality: { policy: { maxDiagnostics: 1 } },
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('names the profile the analysis ran under', async () => {
    const { result } = await validate({
      format: 'pptx',
      document: VALID_PPTX,
      quality: { profile: { id: 'executive-presentation', formats: ['pptx'] } },
    });
    expect(result).toMatchObject({
      ok: true,
      profileId: 'executive-presentation',
    });
  });

  it('blames the caller for a profile that does not fit the run', async () => {
    // A profile scoped to another format is a defect in the REQUEST. It used
    // to escape as `E_INTERNAL`, which this server documents as always a bug
    // here and never the caller's — so the agent was sent to file an issue
    // about the one argument it could have fixed itself.
    const { result, isError } = await validate({
      format: 'pptx',
      document: VALID_PPTX,
      quality: { profile: { id: 'executive-report', formats: ['docx'] } },
    });

    expect(isError).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('E_INVALID_QUALITY_PROFILE');
    expect(result.diagnostics[0].message).toContain('executive-report');
  });

  it('answers a malformed document with its schema errors, not an option error', async () => {
    // Two defects at once — a broken document AND a profile scoped to the
    // other format. Quality used to run first, so the profile threw and the
    // schema errors, the only thing the agent can act on here, never shipped.
    const { result, isError } = await validate({
      format: 'pptx',
      document: {
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [{ name: 'not-a-component', props: {} }],
      },
      quality: { profile: { id: 'executive-report', formats: ['docx'] } },
    });

    expect(isError).toBeFalsy();
    expect(result.ok).toBe(false);
    // Both defects, in one answer: the schema errors are the half the agent
    // can repair, and the profile is the half it chose.
    expect(result.diagnostics.map((entry: any) => entry.path)).toContain(
      '/children/0/name'
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'E_INVALID_QUALITY_PROFILE',
        message: expect.stringContaining('executive-report'),
      })
    );
  });

  it('blames the caller for a policy value that is not a legal one', async () => {
    // The policy schema is `additionalProperties: true` — the tool declares
    // `gate` and takes the rest as written — so a typo in any other field
    // arrives at the engine intact. Before the engine checked, an unknown
    // severity counted into no bucket and the report came back with NaN
    // totals; once it checked, the throw reached the agent as `E_INTERNAL`,
    // the code reserved for bugs in this server.
    const severity = await validate({
      format: 'pptx',
      document: VALID_PPTX,
      quality: {
        policy: { rules: { 'pptx/minimum-font-size': { severity: 'fatal' } } },
      },
    });
    expect(severity.isError).toBeFalsy();
    expect(severity.result.ok).toBe(false);
    expect(severity.result.diagnostics[0].code).toBe(
      'E_INVALID_QUALITY_POLICY'
    );
    expect(severity.result.diagnostics[0].code).not.toBe('E_INTERNAL');
    // The offending value, so the agent knows which of its rules to fix.
    expect(severity.result.diagnostics[0].message).toContain('fatal');

    const budget = await validate({
      format: 'pptx',
      document: VALID_PPTX,
      quality: { policy: { maxDiagnostics: -1 } },
    });
    expect(budget.result.diagnostics[0].code).toBe('E_INVALID_QUALITY_POLICY');
  });

  it('refuses a typo’d gate at the schema, before the engine sees it', async () => {
    // `gate` is the one policy field the tool enumerates, so the SDK rejects
    // `"warn"` as invalid arguments and the body never runs — a protocol
    // error, which is the one shape this tool otherwise never returns.
    // Asserted because that enum is all that stands between a misspelled gate
    // and a gate that silently never fires: narrow it away and the engine's
    // own check becomes the only line, exactly as for every other field.
    const { result, isError } = await validate({
      format: 'pptx',
      document: VALID_PPTX,
      quality: { policy: { gate: 'warn' } },
    });
    expect(isError).toBe(true);
    expect(result).toBeUndefined();
  });

  it('reports a rule that threw rather than an empty clean bill', async () => {
    // The engine's default `onRuleError: "continue"` records the failure and
    // carries on, so the entire class of findings that rule owns vanishes from
    // the answer — and an agent handed `ok: true` with an empty list reads
    // that as "nothing to fix" rather than "nobody looked".
    const exploding: QualityRule = {
      id: 'pptx/explodes',
      code: 'W_QUALITY_TEXT_OVERFLOW',
      category: 'layout',
      defaultSeverity: 'warning',
      defaultCertainty: 'measured',
      evaluate() {
        throw new Error('slide facts were missing');
      },
    };
    // A real engine run: recording the failure is the engine's behaviour and
    // surfacing it is this tool's, so only the analyzer is stood in for.
    const stubbed = await connect((format) => {
      const real = getAdapter(format);
      return {
        ...real,
        validateDocument: real.validateDocument.bind(real),
        rendererIds: real.rendererIds.bind(real),
        rendererStatuses: real.rendererStatuses.bind(real),
        async analyzeQuality() {
          return new QualityEngine([exploding]).analyzeSync({
            format,
            model: {},
            facts: [],
            provenance: {},
          });
        },
      };
    });

    try {
      const { result } = await validate(
        { format: 'pptx', document: VALID_PPTX },
        stubbed
      );
      // A hole in the report, not a defect in the document: still `ok`.
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          code: 'W_QUALITY_RULE_ERROR',
          source: 'quality',
          // The rule id is the whole point: it names what went unchecked.
          ruleId: 'pptx/explodes',
          message: expect.stringContaining('slide facts were missing'),
        })
      );
      expect(result.counts).toMatchObject({ error: 0, warning: 1 });
    } finally {
      await stubbed.close();
    }
  });

  it('keeps the two halves of the verdict apart', async () => {
    // `ok` was `counts.error === 0 && !blocked`, and `counts` includes the
    // quality findings — so a policy that raised one to `error` without asking
    // for a gate reported a renderable document invalid. Same document, same
    // policy, twice: the quality error alone never blocks, and a schema error
    // beside it always does.
    const policy = {
      policy: {
        gate: 'none',
        rules: { 'pptx/minimum-font-size': { severity: 'error' } },
      },
    };
    const slide = (extra: unknown[]) => ({
      name: 'pptx',
      props: { slideWidth: 13.333, slideHeight: 7.5 },
      children: [
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'Too small', fontSize: 5 } },
            ...extra,
          ],
        },
      ],
    });

    const advisory = await validate({
      format: 'pptx',
      document: slide([]),
      quality: policy,
    });
    expect(advisory.result).toMatchObject({ ok: true, valid: true });
    expect(advisory.result.counts.error).toBe(1);

    const broken = await validate({
      format: 'pptx',
      document: slide([{ name: 'text', props: { text: 'ok', bogus: true } }]),
      quality: policy,
    });
    expect(broken.result).toMatchObject({ ok: false, valid: false });
    // Both errors counted; only the schema one moved the verdict.
    expect(broken.result.counts.error).toBe(2);
    expect(broken.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_QUALITY_FONT_SIZE_MIN',
        severity: 'error',
        blocking: false,
      })
    );
  });

  it('reports DOCX quality findings the same way', async () => {
    const { result } = await validate({
      format: 'docx',
      document: {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'section',
            children: [
              { name: 'heading', props: { text: 'One', level: 1 } },
              { name: 'heading', props: { text: 'Deep', level: 3 } },
            ],
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_QUALITY_HEADING_SKIP',
        severity: 'info',
        path: '/children/0/children/1/props/level',
      })
    );
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

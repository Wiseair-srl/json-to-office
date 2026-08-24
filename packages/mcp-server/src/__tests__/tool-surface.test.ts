/**
 * Invariants that hold across the WHOLE tool surface, not inside any one tool.
 *
 * These are the defects that appear when tools are written independently: a
 * second spelling of an option that already exists, an envelope one tool
 * forgot, a description pointing at a field of another tool that was renamed.
 * None of them is visible from within the module that caused it, which is
 * exactly why they belong in a suite of their own.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { ERROR_CODES } from '../lib/errors.js';
import { probePreviewDependencies } from '../preview/dependencies.js';
import {
  artifactOutputProperties,
  documentSourceProperties,
  renderOptionProperties,
} from '../lib/schema.js';

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

let scratch: string;
let client: Client;
let tools: ToolInfo[];

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-surface-'));
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
  });
  const server = createServer(deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'surface-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  tools = (await client.listTools()).tools as unknown as ToolInfo[];
});

afterAll(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('naming', () => {
  it('namespaces every tool and spells them all the same way', () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^jto_[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });

  it('gives every tool a description an agent can choose from', () => {
    for (const tool of tools) {
      expect(tool.description ?? '').not.toBe('');
    }
  });
});

describe('result envelope', () => {
  // `ok` is the single field a caller branches on and `diagnostics` is always
  // present; a tool that required more would make its own failures — which
  // carry diagnostics and nothing else — fail output validation and reach the
  // agent as an unreadable blob instead of a repairable result.
  it('requires exactly ok and diagnostics on every tool', () => {
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.outputSchema?.required, tool.name).toEqual([
        'ok',
        'diagnostics',
      ]);
      expect(tool.outputSchema?.properties?.ok?.type).toBe('boolean');
      expect(tool.outputSchema?.properties?.diagnostics?.type).toBe('array');
    }
  });
});

/**
 * Collect every advertised spelling of one option name.
 *
 * Nested one level as well as flat, because `jto_docx_diff` carries its two
 * document sources as bags rather than as top-level keys.
 */
function spellings(option: string): { tool: string; schema: JsonSchema }[] {
  const found: { tool: string; schema: JsonSchema }[] = [];
  for (const tool of tools) {
    for (const [key, value] of Object.entries(
      tool.inputSchema.properties ?? {}
    )) {
      if (key === option) found.push({ tool: tool.name, schema: value });
      const nested = value.properties?.[option];
      if (nested) found.push({ tool: `${tool.name}.${key}`, schema: nested });
    }
  }
  return found;
}

describe('shared options', () => {
  const shared = {
    ...documentSourceProperties,
    ...renderOptionProperties,
    ...artifactOutputProperties,
  } as Record<string, JsonSchema>;

  /**
   * The one option whose values legitimately differ, recorded as a decision.
   *
   * `jto_preview` returns N page images rather than one file, so it answers a
   * question the single-artifact tools do not have: negotiate (`auto`) or
   * refuse. Its inline delivery is MCP image content blocks, not a base64
   * string in `structuredContent`, so borrowing the name `base64` would
   * misdescribe where the bytes actually land. `path` — the half that means
   * "write it under the output root and hand me the path" — is identical in
   * both, which is the half an agent has to get right.
   *
   * Pinned rather than skipped: if either vocabulary shifts again, this fails.
   */
  it('lets outputMode differ only between one-file and many-image delivery', () => {
    const byTool = Object.fromEntries(
      spellings('outputMode').map((use) => [use.tool, use.schema.enum])
    );
    expect(byTool).toEqual({
      jto_generate: ['path', 'base64'],
      jto_docx_diff: ['path', 'base64'],
      jto_preview: ['auto', 'images', 'path'],
    });
  });

  // Descriptions are allowed to be sharpened per tool — `jto_validate` says
  // what `renderer` means for a check rather than for a render — but the type
  // and the accepted values are the contract, and a tool that quietly narrowed
  // either would be a second option wearing the first one's name.
  it.each(Object.keys(shared).filter((option) => option !== 'outputMode'))(
    '`%s` means the same thing everywhere it appears',
    (option) => {
      const uses = spellings(option);
      expect(uses.length).toBeGreaterThan(0);
      for (const use of uses) {
        expect(use.schema.type, use.tool).toBe(shared[option].type);
        expect(use.schema.enum, use.tool).toEqual(shared[option].enum);
      }
    }
  );

  it('never spells a document source any way but document/handle/revision', () => {
    const aliases = ['doc', 'json', 'documentJson', 'ref', 'workspace', 'id'];
    for (const tool of tools) {
      for (const alias of aliases) {
        expect(
          Object.keys(tool.inputSchema.properties ?? {}),
          `${tool.name} advertises "${alias}"`
        ).not.toContain(alias);
      }
    }
  });

  it('does not expose a caller-controlled font cache directory', () => {
    const generate = tools.find((tool) => tool.name === 'jto_generate');
    const googleFonts =
      generate?.inputSchema.properties?.fonts?.properties?.googleFonts;
    expect(googleFonts?.properties?.cacheDir).toBeUndefined();
  });
});

describe('annotations', () => {
  it('describes render-side filesystem and network effects', () => {
    for (const name of ['jto_generate', 'jto_docx_diff', 'jto_preview']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations?.readOnlyHint, name).toBe(false);
      expect(tool?.annotations?.openWorldHint, name).toBe(true);
    }
  });
});

describe('cross-references', () => {
  /** Walk a dotted path like `output.maxInlineArtifactBytes` into a schema. */
  function resolve(schema: JsonSchema, dotted: string): JsonSchema | undefined {
    let node: JsonSchema | undefined = schema;
    for (const raw of dotted.split('.')) {
      // `formats[].rendererIds` — step through the array to its items.
      const key = raw.replace(/\[\]$/, '');
      node = node?.properties?.[key];
      if (raw.endsWith('[]')) node = node?.items;
      if (!node) return undefined;
    }
    return node;
  }

  // Tool descriptions send agents to other tools' fields by name. A renamed
  // field leaves the prose pointing at nothing, and nothing else would notice.
  it('resolves every jto_info field a description names', () => {
    const info = tools.find((tool) => tool.name === 'jto_info');
    expect(info?.outputSchema).toBeDefined();

    const referenced = new Set<string>();
    for (const tool of tools) {
      for (const match of (tool.description ?? '').matchAll(
        /jto_info\.([A-Za-z0-9_.[\]]*[A-Za-z0-9_])/g
      )) {
        referenced.add(match[1] as string);
      }
      for (const property of Object.values(tool.inputSchema.properties ?? {})) {
        const text = (property as { description?: string }).description ?? '';
        for (const match of text.matchAll(
          /jto_info\.([A-Za-z0-9_.[\]]*[A-Za-z0-9_])/g
        )) {
          referenced.add(match[1] as string);
        }
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    for (const reference of referenced) {
      expect(
        resolve(info?.outputSchema as JsonSchema, reference),
        `jto_info.${reference} is referenced but not advertised`
      ).toBeDefined();
    }
  });
});

/**
 * #204's output-root contract, exercised through the tools rather than the
 * helper.
 *
 * `lib/output-root.ts` has its own unit suite; what that cannot show is that
 * every tool which lets a caller name a file actually routes through it. A
 * tool that wrote with `fs.writeFile` directly would pass every test in this
 * repo except this one.
 */
describe('output root', () => {
  const DOCX = {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'paragraph', props: { text: 'Hello.' } }],
  };

  async function structured(
    name: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const result = await client.callTool({ name, arguments: args });
    return (result as any).structuredContent;
  }

  const escapes = ['../escaped.docx', '/tmp/escaped.docx', 'a/../../escaped'];

  it.each(escapes)(
    'jto_generate refuses "%s"',
    async (filename) => {
      const out = await structured('jto_generate', {
        format: 'docx',
        document: DOCX,
        filename,
      });
      expect(out.ok).toBe(false);
      expect(out.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    },
    120_000
  );

  it('jto_docx_diff refuses an escaping redline name', async () => {
    const out = await structured('jto_docx_diff', {
      before: { document: DOCX },
      after: {
        document: {
          ...DOCX,
          children: [{ name: 'paragraph', props: { text: 'Goodbye.' } }],
        },
      },
      filename: '../redline.docx',
    });
    expect(out.ok).toBe(false);
    expect(out.diagnostics.map((d: any) => d.code)).toContain(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE
    );
  }, 120_000);

  it('jto_workspace_snapshot refuses an escaping snapshot name', async () => {
    const created = await structured('jto_workspace_create', {
      format: 'docx',
      document: DOCX,
    });
    const out = await structured('jto_workspace_snapshot', {
      handle: created.workspace.handle,
      filename: '../snapshot.json',
    });
    expect(out.ok).toBe(false);
    expect(out.diagnostics.map((d: any) => d.code)).toContain(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE
    );
  });

  it('leaves nothing outside the root after all of that', async () => {
    const stray = await fs
      .readdir(path.join(scratch), { recursive: true })
      .then((entries) => entries.filter((e) => !String(e).startsWith('out')));
    expect(stray).toEqual([]);
  });
});

const previewDeps = await probePreviewDependencies();

describe.skipIf(
  !previewDeps.libreoffice.available || !previewDeps.pdftoppm.available
)('output root (preview, needs LibreOffice + poppler)', () => {
  it('jto_preview refuses an escaping page prefix', async () => {
    const result = await client.callTool({
      name: 'jto_preview',
      arguments: {
        format: 'docx',
        document: {
          name: 'docx',
          props: { theme: 'minimal' },
          children: [{ name: 'paragraph', props: { text: 'Hello.' } }],
        },
        pages: '1',
        outputMode: 'path',
        filenamePrefix: '../escaped',
      },
    });
    const out = (result as any).structuredContent;
    expect(out.ok).toBe(false);
    expect(out.diagnostics.map((d: any) => d.code)).toContain(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE
    );
  }, 120_000);
});

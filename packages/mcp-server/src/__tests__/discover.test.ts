/**
 * `jto_discover` over a real client, because the contract that matters is what
 * a client sees: the schema the SDK enforces, and a payload small enough to be
 * worth reading first.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps, type ToolDeps } from '../lib/deps.js';

let client: Client;
let deps: ToolDeps;

interface DiscoverResult {
  ok: boolean;
  diagnostics: Array<{ severity: string; code: string; message: string }>;
  formats: Array<{
    name: string;
    extension: string;
    label: string;
    rootComponent: string;
    defaultRenderer: string;
    renderers: Array<{
      id: string;
      default: boolean;
      components: string[];
      unsupported: string[];
    }>;
    components: Array<{
      name: string;
      category: string;
      description: string;
      hasChildren: boolean;
      root: boolean;
      renderers: string[];
      allowedChildren?: string[];
      allowedParents: string[];
    }>;
    themes: string[];
    starters: Array<{ id: string; title: string; document?: unknown }>;
  }>;
}

async function discover(args: Record<string, unknown> = {}) {
  const result = await client.callTool({
    name: 'jto_discover',
    arguments: args,
  });
  return result.structuredContent as unknown as DiscoverResult;
}

beforeAll(async () => {
  deps = createToolDeps({ serverVersion: '9.9.9-test' });
  const server = createServer(deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('jto_discover', () => {
  it('is advertised with an enforced input and output schema', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === 'jto_discover');
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(
      (tool?.outputSchema as { required?: string[] } | undefined)?.required
    ).toEqual(['ok', 'diagnostics']);
  });

  it('describes both formats, their roots and their renderer profiles', async () => {
    const result = await discover();
    expect(result.ok).toBe(true);
    expect(result.formats.map((format) => format.name)).toEqual([
      'docx',
      'pptx',
    ]);

    const docx = result.formats[0]!;
    expect(docx).toMatchObject({
      extension: '.docx',
      rootComponent: 'docx',
      defaultRenderer: 'docxjs',
    });
    expect(docx.renderers.map((renderer) => renderer.id)).toEqual([
      'docxjs',
      'office-open',
    ]);
    expect(docx.renderers[0]?.default).toBe(true);

    const pptx = result.formats[1]!;
    expect(pptx).toMatchObject({
      extension: '.pptx',
      rootComponent: 'pptx',
      defaultRenderer: 'pptxgenjs',
    });
  });

  it('reports the components a renderer cannot draw', async () => {
    // The docx `chart`, not the pptx one: pptx office-open used to decline
    // charts and does not any more, so docx.js — which has no chart primitive
    // at all — is where a renderer-scoped component still lives. A profile
    // that silently dropped one would let an agent author a document that
    // validates and then renders without the figure.
    const { formats } = await discover({ format: 'docx' });
    const docxjs = formats[0]!.renderers.find(
      (renderer) => renderer.id === 'docxjs'
    );
    expect(docxjs?.unsupported).toContain('chart');
    expect(docxjs?.components).not.toContain('chart');

    const chart = formats[0]!.components.find(
      (component) => component.name === 'chart'
    );
    expect(chart?.renderers).toEqual(['office-open']);
  });

  it('reports both pptx renderers drawing the same components', async () => {
    const { formats } = await discover({ format: 'pptx' });
    const [pptxgenjs, officeOpen] = ['pptxgenjs', 'office-open'].map((id) =>
      formats[0]!.renderers.find((renderer) => renderer.id === id)
    );
    // They diverged on `chart` until office-open learned to ship the workbook.
    expect(officeOpen?.components).toEqual(pptxgenjs?.components);
    expect(officeOpen?.unsupported).toEqual([]);
  });

  it('carries the containment rules in both directions', async () => {
    const { formats } = await discover({ format: 'docx' });
    const components = formats[0]!.components;

    const section = components.find((entry) => entry.name === 'section')!;
    expect(section.hasChildren).toBe(true);
    expect(section.allowedChildren).toEqual(
      expect.arrayContaining(['heading', 'paragraph', 'table'])
    );

    const paragraph = components.find((entry) => entry.name === 'paragraph')!;
    expect(paragraph.hasChildren).toBe(false);
    expect(paragraph.allowedChildren).toBeUndefined();
    expect(paragraph.allowedParents).toEqual(
      expect.arrayContaining(['section', 'columns'])
    );

    const root = components.find((entry) => entry.root)!;
    expect(root.name).toBe('docx');
    expect(root.allowedParents).toEqual([]);
  });

  it('lists built-in themes and starters that actually build', async () => {
    const { formats } = await discover();
    for (const format of formats) {
      expect(format.themes.length).toBeGreaterThan(0);
      expect(format.starters.length).toBeGreaterThan(0);
      for (const starter of format.starters) {
        const outcome = deps
          .getAdapter(format.name as 'docx' | 'pptx')
          .validateDocument(starter.document);
        expect(
          outcome.valid,
          `starter ${starter.id}: ${JSON.stringify(outcome.errors)}`
        ).toBe(true);
      }
    }
  });

  it('lists the bundled DOCX blueprints as summaries, variants included', async () => {
    const { formats } = await discover();
    const docx = formats.find((format) => format.name === 'docx')!;
    const blueprints = (docx as { blueprints?: Array<Record<string, unknown>> })
      .blueprints;
    expect(blueprints?.map((blueprint) => blueprint.id)).toEqual([
      'client-report',
    ]);
    expect(blueprints?.[0]).toMatchObject({
      theme: 'consulting',
      profile: 'client-report',
      definitions: 'client-report-blocks.docx.json',
    });
    expect(
      (blueprints?.[0].variants as Array<{ id: string }>).map((v) => v.id)
    ).toEqual(['data-heavy', 'narrative']);
    // A summary, never the plan: the children are the scaffold's to hand out.
    expect(JSON.stringify(blueprints)).not.toContain('"children"');
  });

  it('stays small enough to be the first call', async () => {
    const result = await discover();
    // The DOCX document schema is over 3 MB. Whatever else changes here, this
    // tool must never start shipping schemas. The ceiling grew from 32 KB to
    // 36 KB when the blueprint summaries joined the gallery and block
    // references; a full blueprint plan would blow it, and belongs to the
    // scaffold, never to discovery.
    expect(JSON.stringify(result).length).toBeLessThan(36 * 1024);
    expect(JSON.stringify(result)).not.toContain('"$schema"');
  });

  it('filters by format and can drop the starter bodies', async () => {
    const filtered = await discover({ format: 'pptx' });
    expect(filtered.formats.map((format) => format.name)).toEqual(['pptx']);

    const lean = await discover({ includeStarters: false });
    for (const format of lean.formats) {
      expect(format.starters.length).toBeGreaterThan(0);
      for (const starter of format.starters) {
        expect(starter.document).toBeUndefined();
        expect(starter.id).toBeTruthy();
      }
    }
  });

  it('rejects an unknown format through the SDK rather than the handler', async () => {
    const result = await client.callTool({
      name: 'jto_discover',
      arguments: { format: 'pdf' },
    });
    expect(result.isError).toBe(true);
  });
});

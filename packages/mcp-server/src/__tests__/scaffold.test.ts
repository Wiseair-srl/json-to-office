/**
 * `jto_scaffold` in process: a blueprint becomes a draft workspace whose fill
 * map resolves at the returned revision, the brief and the outline fill what
 * the documented mapping says and nothing else, validation calls the draft a
 * draft, generation refuses it by pointer, and patching every pointer makes
 * it generation-ready. The stdio suite proves the same lifecycle on the wire.
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
import { applyFacts, parseOutline } from '../tools/scaffold.js';
import { contentFor } from './fixtures/scaffold.js';
import type { BlueprintFillEntry } from '@json-to-office/shared';

let scratch: string;
let client: Client;

interface Envelope {
  ok: boolean;
  diagnostics: Array<{
    severity: string;
    code: string;
    message: string;
    path?: string;
    context?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as unknown as Envelope;
}

async function scaffold(args: Record<string, unknown>) {
  const out = await call('jto_scaffold', {
    blueprint: 'client-report',
    ...args,
  });
  return out as Envelope & {
    workspace: {
      handle: string;
      revision: number;
      format: string;
      title?: string;
    };
    blueprint: {
      id: string;
      variant: string;
      theme: string;
      profile: string;
      definitions: string;
      blocks: string[];
    };
    fillMap: BlueprintFillEntry[];
    filled: number;
  };
}

const codes = (out: Envelope) => out.diagnostics.map((d) => d.code);

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-scaffold-'));
  const server = createServer(
    createToolDeps({
      outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
      serverVersion: '9.9.9-test',
    })
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'scaffold-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('what a scaffold is', () => {
  it.each(['data-heavy', 'narrative'])(
    'opens the %s variant as a workspace at revision 1 whose fill map resolves there',
    async (variant) => {
      const out = await scaffold({ variant });
      expect(out.ok).toBe(true);
      expect(out.workspace).toMatchObject({ revision: 1, format: 'docx' });
      expect(out.blueprint).toMatchObject({
        id: 'client-report',
        variant,
        theme: 'consulting',
        profile: 'client-report',
        definitions: 'client-report-blocks.docx.json',
      });
      expect(out.blueprint.blocks).toEqual(
        expect.arrayContaining(['cover', 'running-head', 'source-line'])
      );
      expect(out.filled).toBe(0);
      expect(out.fillMap.length).toBeGreaterThan(20);
      expect(codes(out)).toEqual(['W_SCAFFOLD_DRAFT']);

      const inspected = await call('jto_workspace_inspect', {
        handle: out.workspace.handle,
        paths: out.fillMap.map((entry) => entry.path),
      });
      expect(inspected.missingPaths).toEqual([]);
      const projection = inspected.projection as Record<string, unknown>;
      for (const entry of out.fillMap) {
        expect(projection[entry.path], entry.path).toBe(entry.marker);
        expect(entry.guidance).not.toBe('');
      }
      const title = out.fillMap.find(
        (entry) => entry.block === 'cover' && entry.slot === 'title'
      );
      expect(title).toMatchObject({
        kind: 'slot',
        type: 'string',
        maxWords: 16,
        required: true,
      });
      expect(
        out.fillMap.find((entry) => entry.path === '/props/metadata/title')
      ).toMatchObject({ kind: 'metadata' });
      // A repeated, nested slot is addressed at the authored invocation.
      const nested = out.fillMap.filter(
        (entry) => entry.slot === 'items.label'
      );
      expect(nested.length).toBeGreaterThanOrEqual(2);
      expect(nested[0]).toMatchObject({ block: 'kpi-row', kind: 'slot' });
      expect(nested[0].path).toMatch(/\/props\/slots\/items\/\d+\/label$/);
      expect(projection[nested[1].path]).toBe(nested[1].marker);
      // The document carries what it invokes: nothing is looked up later.
      const doc = (
        await call('jto_workspace_inspect', {
          handle: out.workspace.handle,
          paths: ['/props/blocks', '/props/qualityProfile', '/props/theme'],
        })
      ).projection as Record<string, unknown>;
      expect(Object.keys(doc['/props/blocks'] as object)).toEqual(
        out.blueprint.blocks
      );
      expect(doc['/props/qualityProfile']).toBe('client-report');
      expect(doc['/props/theme']).toBe('consulting');
    }
  );

  it('takes a theme without touching what is asked, and refuses one that does not exist', async () => {
    const out = await scaffold({ theme: 'vermilion' });
    expect(out.blueprint.theme).toBe('vermilion');
    expect(out.blueprint.profile).toBe('client-report');
    const validated = await call('jto_validate', {
      format: 'docx',
      handle: out.workspace.handle,
    });
    expect(validated.profileId).toBe('client-report');

    const refused = await call('jto_scaffold', {
      blueprint: 'client-report',
      theme: 'no-such-theme',
    });
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics[0]).toMatchObject({
      code: 'E_THEME_NOT_FOUND',
      context: { themes: expect.arrayContaining(['consulting']) },
    });
  });

  it('refuses an unknown blueprint, an unknown variant and a format without blueprints, naming what exists', async () => {
    const unknown = await call('jto_scaffold', { blueprint: 'memo' });
    expect(unknown.ok).toBe(false);
    expect(unknown.diagnostics[0]).toMatchObject({
      code: 'E_BLUEPRINT_NOT_FOUND',
      context: { format: 'docx', blueprints: ['client-report'] },
    });
    const variant = await call('jto_scaffold', {
      blueprint: 'client-report',
      variant: 'memo',
    });
    expect(variant.diagnostics[0]).toMatchObject({
      code: 'E_BLUEPRINT_NOT_FOUND',
      context: { variants: ['data-heavy', 'narrative'] },
    });
    const pptx = await call('jto_scaffold', {
      format: 'pptx',
      blueprint: 'client-report',
    });
    expect(pptx.diagnostics[0]).toMatchObject({
      code: 'E_BLUEPRINT_NOT_FOUND',
      context: { format: 'pptx', blueprints: [] },
    });
  });
});

describe('the brief and the outline', () => {
  it('writes a brief fact to the metadata field and the chrome slot of that name, never a body block', async () => {
    const out = await scaffold({
      variant: 'narrative',
      brief: {
        title: 'Delivery got reliable',
        client: 'Acme Holdings',
        date: 'September 2026',
        confidentiality: 'Confidential',
        author: 'JTO',
        audience: 'The board',
      },
    });
    expect(out.ok).toBe(true);
    expect(out.workspace.title).toBe('Delivery got reliable');
    expect(out.filled).toBeGreaterThanOrEqual(7);
    const doc = (
      await call('jto_workspace_inspect', {
        handle: out.workspace.handle,
        paths: ['/props/metadata', '/children/0/children/0/props/slots'],
      })
    ).projection as Record<string, Record<string, unknown>>;
    expect(doc['/props/metadata']).toMatchObject({
      title: 'Delivery got reliable',
      author: 'JTO',
      company: 'Acme Holdings',
      date: 'September 2026',
    });
    expect(doc['/children/0/children/0/props/slots']).toMatchObject({
      title: 'Delivery got reliable',
      client: 'Acme Holdings',
      date: 'September 2026',
      confidentiality: 'Confidential',
    });
    // A section opener has a `title` slot too; the brief's title is not it.
    const openers = out.fillMap.filter(
      (entry) => entry.block === 'section-opener' && entry.slot === 'title'
    );
    expect(openers.length).toBe(4);
    expect(
      out.fillMap.some(
        (entry) => entry.slot === 'title' && entry.block === 'cover'
      )
    ).toBe(false);
    expect(out.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'W_BRIEF_UNUSED',
          severity: 'warning',
          context: { key: 'audience' },
        }),
      ])
    );
  });

  it('maps an outline’s headings to the openers in order and its paragraphs to the body text, reporting the rest', async () => {
    const outline = [
      '# Growth improved as delivery became more reliable',
      '',
      '## Year in brief',
      'Revenue rose while churn fell.',
      '',
      'Two lines',
      'make one paragraph.',
      '',
      '## Regional picture',
      'North led.',
      '',
      '## Twelve months on',
      '## What to do next',
      '',
      '## An appendix the variant has no room for',
    ].join('\n');
    const out = await scaffold({ variant: 'narrative', outline });
    expect(out.ok).toBe(true);
    expect(out.workspace.title).toBe(
      'Growth improved as delivery became more reliable'
    );
    const projected = (
      await call('jto_workspace_inspect', {
        handle: out.workspace.handle,
        paths: [
          '/props/metadata/title',
          '/children/0/children/0/props/slots/title',
          '/children/1/children/1/props/slots/title',
          '/children/2/children/0/props/slots/title',
          '/children/3/children/0/props/slots/title',
          '/children/4/children/0/props/slots/title',
          '/children/1/children/3/props/text',
          '/children/1/children/4/props/text',
          '/children/2/children/1/props/text',
        ],
      })
    ).projection as Record<string, unknown>;
    expect(projected['/props/metadata/title']).toBe(
      'Growth improved as delivery became more reliable'
    );
    expect(projected['/children/0/children/0/props/slots/title']).toBe(
      'Growth improved as delivery became more reliable'
    );
    expect(projected['/children/1/children/1/props/slots/title']).toBe(
      'Year in brief'
    );
    expect(projected['/children/2/children/0/props/slots/title']).toBe(
      'Regional picture'
    );
    expect(projected['/children/3/children/0/props/slots/title']).toBe(
      'Twelve months on'
    );
    expect(projected['/children/4/children/0/props/slots/title']).toBe(
      'What to do next'
    );
    expect(projected['/children/1/children/3/props/text']).toBe(
      'Revenue rose while churn fell.'
    );
    expect(projected['/children/1/children/4/props/text']).toBe(
      'Two lines make one paragraph.'
    );
    expect(projected['/children/2/children/1/props/text']).toBe('North led.');
    // What was written is gone from the map; what was not is still there.
    expect(
      out.fillMap.filter(
        (entry) => entry.slot === 'title' && entry.block === 'section-opener'
      )
    ).toEqual([]);
    expect(out.fillMap.some((entry) => entry.kind === 'text')).toBe(true);
    expect(out.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'W_OUTLINE_UNMAPPED',
          context: { headings: ['An appendix the variant has no room for'] },
        }),
      ])
    );
  });

  it('lets a brief title beat the outline’s, and reports paragraphs a section cannot hold', () => {
    const fillMap: BlueprintFillEntry[] = [
      {
        path: '/props/metadata/title',
        marker: '{{T}}',
        guidance: 'T',
        kind: 'metadata',
      },
      {
        path: '/children/1/children/0/props/slots/title',
        marker: '{{H}}',
        guidance: 'H',
        kind: 'slot',
        block: 'section-opener',
        slot: 'title',
      },
      {
        path: '/children/1/children/1/props/text',
        marker: '{{B}}',
        guidance: 'B',
        kind: 'text',
      },
    ];
    const document = {
      props: { metadata: { title: '{{T}}' } },
      children: [
        {},
        {
          children: [
            { props: { slots: { title: '{{H}}' } } },
            { props: { text: '{{B}}' } },
          ],
        },
      ],
    };
    const fill = applyFacts(
      document,
      fillMap,
      { title: 'From the brief' },
      parseOutline('# From the outline\n## One\nFirst.\n\nSecond.')
    );
    expect(document.props.metadata.title).toBe('From the brief');
    expect(fill.remaining).toEqual([]);
    expect(fill.filled).toBe(3);
    expect(fill.diagnostics).toEqual([
      expect.objectContaining({
        code: 'W_OUTLINE_UNMAPPED',
        path: '/children/1',
        context: { paragraphs: 1 },
      }),
    ]);
  });

  it('reports what the outline mapping has no place for: text before the first section, deeper headings, a second title', () => {
    const outline = parseOutline(
      [
        '# Title',
        'A preamble nobody asked for.',
        '# Another title',
        '## One',
        'Body.',
        '### Method',
        'Still in One.',
      ].join('\n')
    );
    expect(outline).toEqual({
      title: 'Title',
      orphans: ['A preamble nobody asked for.'],
      skippedHeadings: ['Another title', 'Method'],
      sections: [{ heading: 'One', paragraphs: ['Body.', 'Still in One.'] }],
    });
    const document = { props: { metadata: {} }, children: [] };
    const fill = applyFacts(document, [], {}, outline);
    expect(fill.filled).toBe(0);
    expect(fill.diagnostics.map((d) => [d.code, d.context])).toEqual([
      ['W_OUTLINE_UNMAPPED', { headings: ['Title'] }],
      ['W_OUTLINE_UNMAPPED', { headings: ['One'] }],
      ['W_OUTLINE_UNMAPPED', { headings: ['Another title', 'Method'] }],
      ['W_OUTLINE_UNMAPPED', { paragraphs: 1 }],
    ]);
  });
});

describe('draft to generation-ready', () => {
  it('is a valid draft, refused by generation at every marker, and ready once each pointer is patched', async () => {
    const out = await scaffold({ variant: 'narrative' });
    const { handle } = out.workspace;

    const draft = await call('jto_validate', { format: 'docx', handle });
    expect(draft.ok).toBe(true);
    expect(draft.valid).toBe(true);
    expect(draft.generationReady).toBe(false);
    expect(draft.scaffoldMarkers).toBe(out.fillMap.length);
    expect(draft.profileId).toBe('client-report');
    expect(new Set(codes(draft))).toEqual(
      new Set(['W_QUALITY_SCAFFOLD_MARKER'])
    );

    const refused = await call('jto_generate', { format: 'docx', handle });
    expect(refused.ok).toBe(false);
    expect(new Set(codes(refused))).toEqual(new Set(['E_SCAFFOLD_MARKER']));
    // Identical markers collapse into one diagnostic under the budget, but
    // every place one sits stays addressable: the first under `path`, the
    // rest under `context.paths`.
    const addressed = refused.diagnostics.flatMap((d) => [
      d.path,
      ...((d.context?.paths as string[] | undefined) ?? []).slice(1),
    ]);
    expect(new Set(addressed)).toEqual(
      new Set(out.fillMap.map((entry) => entry.path))
    );

    const patched = await call('jto_workspace_patch', {
      handle,
      baseRevision: 1,
      operations: out.fillMap.map((entry) => ({
        op: 'replace',
        path: entry.path,
        value: contentFor(entry),
      })),
    });
    expect(patched.ok).toBe(true);
    expect((patched.workspace as { revision: number }).revision).toBe(2);

    const ready = await call('jto_validate', { format: 'docx', handle });
    expect(ready.ok).toBe(true);
    expect(ready.generationReady).toBe(true);
    expect(ready.scaffoldMarkers).toBe(0);
    expect(ready.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);

    const generated = await call('jto_generate', { format: 'docx', handle });
    expect(generated.ok).toBe(true);
    expect(generated.artifact).toMatchObject({ bytes: expect.any(Number) });
  }, 60_000);
});

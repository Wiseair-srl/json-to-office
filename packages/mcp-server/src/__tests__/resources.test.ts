/**
 * The `jto://` resources. What matters here is that the URIs are the ones a
 * client can pin, that every body is JSON it can parse, and that the schema
 * resources really are the generated artifacts rather than a summary of them.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps, type ToolDeps } from '../lib/deps.js';
import { RESOURCE_URIS } from '../resources/index.js';

let client: Client;
let deps: ToolDeps;

async function readJson(uri: string): Promise<any> {
  const result = await client.readResource({ uri });
  expect(result.contents).toHaveLength(1);
  const [content] = result.contents as Array<{
    uri: string;
    mimeType?: string;
    text?: string;
  }>;
  expect(content?.uri).toBe(uri);
  expect(content?.mimeType).toBe('application/json');
  return JSON.parse(content?.text ?? 'null');
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

describe('discovery resources', () => {
  it('publishes the documented URIs, all as JSON', async () => {
    const { resources } = await client.listResources();
    const byUri = new Map(resources.map((entry) => [entry.uri, entry]));

    for (const uri of [
      RESOURCE_URIS.blocks,
      RESOURCE_URIS.blueprints,
      RESOURCE_URIS.catalog,
      RESOURCE_URIS.renderers,
      RESOURCE_URIS.themes,
      RESOURCE_URIS.themeValues,
      RESOURCE_URIS.templates,
      RESOURCE_URIS.documentSchema('docx'),
      RESOURCE_URIS.documentSchema('pptx'),
      RESOURCE_URIS.themeSchema('docx'),
      RESOURCE_URIS.themeSchema('pptx'),
      RESOURCE_URIS.designGuide('docx'),
      RESOURCE_URIS.designGuide('pptx'),
    ]) {
      const entry = byUri.get(uri);
      expect(entry, `missing resource ${uri}`).toBeDefined();
      expect(entry?.mimeType).toBe('application/json');
      expect(entry?.description ?? '').not.toBe('');
    }
  });

  it('serves the catalogue', async () => {
    const catalog = await readJson(RESOURCE_URIS.catalog);
    expect(catalog.formats.map((format: any) => format.name)).toEqual([
      'docx',
      'pptx',
    ]);
    const docx = catalog.formats[0];
    expect(docx.components.map((entry: any) => entry.name)).toContain(
      'paragraph'
    );
    expect(docx.renderers.map((entry: any) => entry.id)).toContain('docxjs');
  });

  it('derives block references from templates without registering runtime names', async () => {
    const { galleryDocument } = await import('../templates/gallery.js');
    const { validateDocument } = await import('@json-to-office/shared-docx');
    const catalog = await readJson(RESOURCE_URIS.blocks);
    expect(catalog.purpose).toBe('authoring-reference');
    const cover = catalog.blocks.find((entry: any) => entry.name === 'cover');
    expect(cover.definition).toEqual(
      (galleryDocument(cover.template) as any).props.blocks.cover
    );
    expect(cover.definitionPointer).toBe('/props/blocks/cover');
    expect(cover.slotsSchema.required).toContain('title');
    const document: any = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'block',
              props: { ref: 'cover', slots: { title: 'Copied definition' } },
            },
          ],
        },
      ],
    };
    expect(validateDocument(document).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'block_unknown_reference' }),
      ])
    );
    document.props.blocks = { cover: structuredClone(cover.definition) };
    expect(validateDocument(document).valid).toBe(true);
  });

  it('serves the generated document schemas, not a digest of them', async () => {
    const schema = await readJson(RESOURCE_URIS.documentSchema('docx'));
    // Draft-07's own `$id` is the http:// spelling, and it is what validators
    // key their bundled meta-schema under — an https:// dialect name reads as
    // an unknown dialect a stock Ajv then refuses to resolve.
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe('document.schema.json');
    expect(Object.keys(schema.definitions)).toContain(
      'ComponentDefinition_docxjs'
    );

    const presentation = await readJson(RESOURCE_URIS.documentSchema('pptx'));
    expect(presentation.$id).toBe('presentation.schema.json');
    // One component definition per renderer, dispatched on `renderer` at
    // the root, plus the block-body authoring schemas derived from each.
    expect(Object.keys(presentation.definitions)).toEqual(
      expect.arrayContaining([
        'PptxComponentDefinition_pptxgenjs',
        'PptxComponentDefinition_office-open',
        'BlockTemplate_PptxComponentDefinition_pptxgenjs_Body',
      ])
    );
    expect(Array.isArray(presentation.allOf)).toBe(true);
  });

  it('serves the theme schemas', async () => {
    for (const format of ['docx', 'pptx'] as const) {
      const theme = await readJson(RESOURCE_URIS.themeSchema(format));
      expect(theme.$id).toBe('theme.schema.json');
      expect(theme.type).toBe('object');
    }
  });

  it('serves renderer profiles and theme names', async () => {
    const renderers = await readJson(RESOURCE_URIS.renderers);
    const docx = renderers.formats.find(
      (entry: any) => entry.format === 'docx'
    );
    expect(docx.defaultRenderer).toBe('docxjs');
    expect(docx.renderers.map((entry: any) => entry.id)).toEqual([
      'docxjs',
      'office-open',
    ]);

    const themes = await readJson(RESOURCE_URIS.themes);
    for (const entry of themes.formats) {
      expect(entry.themes.length).toBeGreaterThan(0);
    }
  });

  it('describes every theme: its voice, when to use it, and the extended values it carries', async () => {
    const themes = await readJson(RESOURCE_URIS.themes);
    for (const entry of themes.formats) {
      expect(entry.themes.length).toBeGreaterThan(0);
      for (const theme of entry.themes) {
        expect(theme.name).toBeTypeOf('string');
        expect(theme.description.length, `${theme.name} voice`).toBeGreaterThan(
          10
        );
        expect(theme.whenToUse.length, `${theme.name} use`).toBeGreaterThan(10);
        expect(theme.extended).toBeTypeOf('boolean');
        expect(theme.fonts.heading).toBeTypeOf('string');
        expect(theme.fonts.body).toBeTypeOf('string');
      }
      // The house theme is a complete visual system, and the resource says
      // so in values an agent can read without the raw style table.
      const house = entry.themes.find(
        (theme: any) => theme.name === 'consulting'
      );
      expect(house.extended).toBe(true);
      expect(house.typography.roles.display).toBeTypeOf('number');
      expect(house.typography.roles.source).toBeTypeOf('number');
      expect(house.chrome).toContain('runningHead');
      expect(house.motif).toBe('rule');
      expect(house.palette.accent).toMatch(/^#[0-9A-F]{6}$/i);
      // A plain theme says it is one rather than inventing values.
      const plain = entry.themes.find((theme: any) => theme.name === 'minimal');
      expect(plain.extended).toBe(false);
      expect(plain.typography).toBeUndefined();
    }
  });

  it('serves a design guide per format, generated from the registries it describes', async () => {
    for (const format of ['docx', 'pptx'] as const) {
      const guide = await readJson(RESOURCE_URIS.designGuide(format));
      expect(guide.format).toBe(format);
      expect(guide.markdown).toBeTypeOf('string');
      expect(guide.themes.length).toBeGreaterThan(0);
      expect(guide.profiles.length).toBeGreaterThan(1);
      expect(guide.rules.length).toBeGreaterThan(10);
      expect(guide.blocks.length).toBeGreaterThan(0);
      for (const theme of guide.themes) {
        expect(guide.markdown).toContain(`\`${theme.name}\``);
        expect(guide.markdown).toContain(theme.whenToUse);
      }
      for (const profile of guide.profiles) {
        expect(guide.markdown).toContain(`\`${profile.id}\``);
      }
      for (const rule of guide.rules) {
        expect(guide.markdown).toContain(`\`${rule.code}\``);
        expect(rule.description.length, rule.id).toBeGreaterThan(10);
        expect(rule.defaultEnabled).toBeTypeOf('boolean');
      }
      for (const block of guide.blocks) {
        expect(guide.markdown).toContain(`\`${block.name}\``);
      }
      // The boundary the guide exists to teach: themes paint, profiles require.
      expect(guide.markdown).toMatch(/theme[^.]*paints?/i);
      expect(guide.markdown).toMatch(/profile[^.]*requires?/i);
    }
    const docx = await readJson(RESOURCE_URIS.designGuide('docx'));
    expect(docx.blueprints.map((b: any) => b.id)).toContain('client-report');
    expect(docx.markdown).toContain('`client-report`');
    // The two extension mechanisms and the three document-shaped things a
    // reader could confuse: block, blueprint, template.
    expect(docx.markdown).toMatch(/code plugins/i);
    expect(docx.templates.length).toBeGreaterThan(0);
    for (const template of docx.templates)
      expect(docx.markdown).toContain(`\`${template.name}\``);
  });

  it('serves non-empty built-in theme values in ESM', async () => {
    const values = await readJson(RESOURCE_URIS.themeValues);
    for (const entry of values.formats) {
      expect(Object.keys(entry.themes).length).toBeGreaterThan(0);
      const [theme] = Object.values(entry.themes) as any[];
      expect(theme.colors).toBeDefined();
      expect(theme.fonts).toBeDefined();
    }
  });

  it('falls back to theme names when detailed values fail per format', async () => {
    const adapter = deps.getAdapter('docx');
    const detailed = vi
      .spyOn(adapter, 'getBuiltinThemeValues')
      .mockRejectedValue(new Error('dynamic import failed'));
    const fallback = vi
      .spyOn(adapter, 'getBuiltinThemes')
      .mockReturnValue({ fallback: { name: 'fallback' } });

    try {
      const values = await readJson(RESOURCE_URIS.themeValues);
      expect(
        values.formats.find((entry: any) => entry.format === 'docx').themes
      ).toEqual({ fallback: { name: 'fallback' } });
      expect(fallback).toHaveBeenCalledOnce();
    } finally {
      detailed.mockRestore();
      fallback.mockRestore();
    }
  });

  it('preserves extended visual values without changing theme-name discovery', async () => {
    const extended = {
      name: 'extended',
      palette: { chart: ['#123456'] },
      typography: { roles: { display: { size: 32 } } },
      spacing: { basePt: 4 },
      chrome: { sourceLine: { type: 'source' } },
      motif: { kind: 'rule' },
    };
    const detailed = vi
      .spyOn(deps.getAdapter('docx'), 'getBuiltinThemeValues')
      .mockResolvedValue({ extended });
    try {
      const values = await readJson(RESOURCE_URIS.themeValues);
      expect(
        values.formats.find((entry: any) => entry.format === 'docx').themes
          .extended
      ).toEqual(extended);
    } finally {
      detailed.mockRestore();
    }
  });

  it('serves starter documents that validate', async () => {
    const { starters } = await readJson(RESOURCE_URIS.templates);
    expect(starters.length).toBeGreaterThanOrEqual(4);
    for (const starter of starters) {
      const outcome = deps
        .getAdapter(starter.format)
        .validateDocument(starter.document);
      expect(
        outcome.valid,
        `starter ${starter.id}: ${JSON.stringify(outcome.errors)}`
      ).toBe(true);
    }
  });

  it('refuses a URI it does not publish', async () => {
    await expect(
      client.readResource({ uri: 'jto://schema/xlsx/document' })
    ).rejects.toThrow();
  });
});

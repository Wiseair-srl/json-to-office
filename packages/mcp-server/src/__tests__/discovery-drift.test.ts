/**
 * Drift guard for the discovery surface (#204 acceptance).
 *
 * Three things have to agree, and only these three are independent of each
 * other:
 *
 *   1. `fixtures/published-surface.ts` — the component names, renderer
 *      profiles and container rules recorded by hand, the only party here that
 *      no code derives
 *   2. the renderer ids the cores register, which the schema knows nothing about
 *   3. what `jto_discover`, `jto_describe_component` and the `jto://` resources
 *      actually tell an agent, and whether the starters they ship still
 *      validate against all of it
 *
 * The registries in `shared-docx` / `shared-pptx` and the generated JSON Schema
 * are deliberately *not* on that list as two entries: the schema is generated
 * from the registry, so removing a component from one removes it from the other
 * in the same edit and comparing them can only ever pass. That is why the
 * recorded surface exists — a registry change that alters what agents may write
 * has to be acknowledged in a file a human edits.
 *
 * A component that quietly leaves the public surface, a renderer registered in
 * a core with no schema profile, a container whose accepted children change, a
 * resource that falls behind the tool, a starter this server hands out that its
 * own schema then rejects — each is a promise this server would make and not
 * keep. They all fail here, naming the entries that moved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import Ajv from 'ajv';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps, type ToolDeps } from '../lib/deps.js';
import { FORMAT_NAMES } from '../lib/schema.js';
import type { FormatName } from '../lib/adapters.js';
import {
  childNamesOf,
  formatSchemas,
  registryEntries,
} from '../tools/discover.js';
import { RESOURCE_URIS } from '../resources/index.js';
import { designNote, designNoteNames } from '../lib/design-notes.js';
import { PUBLISHED_SURFACE } from './fixtures/published-surface.js';

let client: Client;
let deps: ToolDeps;
const publishedSchemaValidator = new Ajv({
  strict: false,
  allErrors: true,
  validateFormats: false,
});

interface Component {
  name: string;
  designNote?: string;
  hasChildren: boolean;
  root: boolean;
  renderers: string[];
  allowedChildren?: string[];
  allowedParents: string[];
}
interface Format {
  name: FormatName;
  rootComponent: string;
  defaultRenderer: string;
  renderers: Array<{ id: string; default: boolean; components: string[] }>;
  components: Component[];
  themes: string[];
  starters: Array<{ id: string; format: FormatName; document: unknown }>;
}

/**
 * Compare two name lists and, when they differ, say exactly which names moved
 * and which side they moved on. A drift report that only says "not equal" is
 * a second investigation; this one is the answer.
 */
function expectSameNames(
  subject: string,
  leftLabel: string,
  left: readonly string[],
  rightLabel: string,
  right: readonly string[]
): void {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const onlyLeft = [...leftSet].filter((name) => !rightSet.has(name)).sort();
  const onlyRight = [...rightSet].filter((name) => !leftSet.has(name)).sort();
  expect(
    { [leftLabel]: onlyLeft, [rightLabel]: onlyRight },
    `${subject} drifted. Only in ${leftLabel}: [${
      onlyLeft.join(', ') || 'none'
    }]. Only in ${rightLabel}: [${onlyRight.join(', ') || 'none'}].`
  ).toEqual({ [leftLabel]: [], [rightLabel]: [] });
}

async function discover(): Promise<Format[]> {
  const result = await client.callTool({
    name: 'jto_discover',
    arguments: {},
  });
  return (result.structuredContent as unknown as { formats: Format[] }).formats;
}

async function readJson(uri: string): Promise<any> {
  const result = await client.readResource({ uri });
  const [content] = result.contents as Array<{ text?: string }>;
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

describe('the drift detector itself', () => {
  it('fails, and names the entry, when one side gains a component', () => {
    expect(() =>
      expectSameNames(
        'components',
        'registry',
        ['heading', 'paragraph', 'sparkline'],
        'schema',
        ['heading', 'paragraph']
      )
    ).toThrow(/sparkline/);
  });

  it('passes only when the sets match, whatever the order', () => {
    expect(() =>
      expectSameNames('components', 'a', ['b', 'a'], 'b', ['a', 'b'])
    ).not.toThrow();
  });
});

/** Children a container accepts, unioned over the profiles that offer it. */
function acceptedChildren(format: FormatName, component: string): string[] {
  const schemas = formatSchemas(format);
  const accepted = new Set<string>();
  for (const profile of schemas.profiles) {
    const branch = profile.components.get(component);
    if (!branch) continue;
    // A renderer that cannot draw a child drops it from its own profile,
    // which is narrowing, not drift — so the union is what the format offers.
    for (const child of childNamesOf(branch, schemas.definitions) ?? []) {
      accepted.add(child);
    }
  }
  return [...accepted];
}

describe('the recorded surface still describes what is generated', () => {
  const ACKNOWLEDGE =
    'If the change was intended, record it in src/__tests__/fixtures/published-surface.ts and say why in the commit.';

  it.each([...FORMAT_NAMES])(
    '%s: the schema profiles are the recorded ones, in the recorded order',
    (format) => {
      // Order carries meaning: `jto_discover` reports the first profile as the
      // format's default renderer, so a reshuffle changes what agents get when
      // they name no renderer at all.
      expect(
        formatSchemas(format).profiles.map((profile) => profile.id),
        `${format} renderer profiles moved. ${ACKNOWLEDGE}`
      ).toEqual(Object.keys(PUBLISHED_SURFACE[format].renderers));
    }
  );

  it.each([...FORMAT_NAMES])(
    '%s: each profile accepts exactly the recorded components',
    (format) => {
      for (const profile of formatSchemas(format).profiles) {
        expectSameNames(
          `${format}/${profile.id} components (${ACKNOWLEDGE})`,
          'generated schema',
          [...profile.components.keys()],
          'recorded surface',
          PUBLISHED_SURFACE[format].renderers[profile.id] ?? []
        );
      }
    }
  );

  it.each([...FORMAT_NAMES])(
    '%s: the registry holds a metadata entry for every recorded component',
    (format) => {
      // The registry is what the schema is generated from, so this cannot
      // fail on its own — but it is what turns a recorded-surface failure
      // into a readable one, and it is the assertion that keeps holding if
      // generation ever stops reading the registry.
      const recorded = new Set(
        Object.values(PUBLISHED_SURFACE[format].renderers).flat()
      );
      expectSameNames(
        `${format} components (${ACKNOWLEDGE})`,
        'registry',
        registryEntries(format).map((entry) => entry.name),
        'recorded surface',
        [...recorded]
      );
    }
  );

  it.each([...FORMAT_NAMES])(
    '%s: containers accept exactly the recorded children',
    (format) => {
      const recorded = PUBLISHED_SURFACE[format].allowedChildren;
      const containers = new Set<string>(Object.keys(recorded));
      for (const name of new Set(
        Object.values(PUBLISHED_SURFACE[format].renderers).flat()
      )) {
        // A component that grew children without being recorded as a
        // container is drift too, so the generated side gets to add keys.
        if (acceptedChildren(format, name).length > 0) containers.add(name);
      }
      for (const container of containers) {
        expectSameNames(
          `${format} ${container}.allowedChildren (${ACKNOWLEDGE})`,
          'generated schema',
          acceptedChildren(format, container),
          'recorded surface',
          recorded[container] ?? []
        );
      }
    }
  );

  it.each([...FORMAT_NAMES])(
    '%s: the root component is the recorded one',
    (format) => {
      expect(
        formatSchemas(format).rootComponent,
        `${format} root component changed. ${ACKNOWLEDGE}`
      ).toBe(PUBLISHED_SURFACE[format].rootComponent);
    }
  );
});

describe('the cores and the schema agree', () => {
  it.each([...FORMAT_NAMES])(
    '%s: every renderer the core registers has a schema profile',
    async (format) => {
      // The one comparison here between two genuinely separate maintainers:
      // renderer ids live in the cores' own registries, which the schema
      // generator never reads.
      const registered = [...(await deps.getAdapter(format).rendererIds())];
      expectSameNames(
        `${format} renderers`,
        'core registry',
        registered,
        'schema profiles',
        formatSchemas(format).profiles.map((profile) => profile.id)
      );
    }
  );
});

describe('tools and resources describe the same surface', () => {
  it('jto_discover reports exactly the schema-profiled components', async () => {
    const formats = await discover();
    expectSameNames(
      'formats',
      'jto_discover',
      formats.map((format) => format.name),
      'FORMAT_NAMES',
      [...FORMAT_NAMES]
    );

    for (const format of formats) {
      const schemas = formatSchemas(format.name);
      expectSameNames(
        `${format.name} components`,
        'jto_discover',
        format.components.map((component) => component.name),
        'generated schema',
        [
          ...new Set(
            schemas.profiles.flatMap((profile) => [
              ...profile.components.keys(),
            ])
          ),
        ]
      );
      for (const renderer of format.renderers) {
        const profile = schemas.profiles.find(
          (entry) => entry.id === renderer.id
        );
        expect(
          profile,
          `no profile for ${format.name}/${renderer.id}`
        ).toBeDefined();
        expectSameNames(
          `${format.name}/${renderer.id} components`,
          'jto_discover',
          renderer.components,
          'generated schema',
          [...(profile?.components.keys() ?? [])]
        );
      }
    }
  });

  it('every component carries a design note, and no note names a ghost', async () => {
    // The notes table is the one place taste lives inside the product, and a
    // component that gains or loses a name without the table following it is
    // exactly the drift this epic exists to stop. Checked both ways: a
    // component with no note ships advice-free, and a note for a component
    // that no longer exists is stale prose nobody will notice.
    const formats = await discover();
    for (const format of formats) {
      expectSameNames(
        `${format.name} design notes`,
        'jto_discover',
        format.components.map((component) => component.name),
        'design-notes table',
        [...designNoteNames(format.name)]
      );
      for (const component of format.components) {
        expect(component.designNote, `${format.name}/${component.name}`).toBe(
          designNote(format.name, component.name)
        );
      }
    }
  });

  it('jto_describe_component serves the same note as jto_discover', async () => {
    const formats = await discover();
    for (const format of formats) {
      for (const component of format.components) {
        const result = await client.callTool({
          name: 'jto_describe_component',
          arguments: {
            format: format.name,
            name: component.name,
            // Some components live in only one renderer profile — docx
            // `chart` is office-open only — so ask the renderer that has it.
            ...(component.renderers[0] !== undefined && {
              renderer: component.renderers[0],
            }),
          },
        });
        const payload = result.structuredContent as unknown as {
          ok: boolean;
          component?: { designNote?: string };
        };
        expect(payload, `${format.name}/${component.name}`).toMatchObject({
          ok: true,
        });
        expect(
          payload.component?.designNote,
          `${format.name}/${component.name}`
        ).toBe(component.designNote);
      }
    }
  });

  it('the catalogue survives both transports identically', async () => {
    const [tool, resource] = await Promise.all([
      discover(),
      readJson(RESOURCE_URIS.catalog),
    ]);
    // Both sides call the same `buildCatalog`, so this is not a check that two
    // maintainers agree — it is a check that neither transport loses anything
    // on the way out. The tool answers through a declared output schema that
    // can drop unknown properties; the resource answers as raw JSON text. The
    // two paths exist so a client with only one still gets everything, which
    // holds only if what arrives is the same both ways.
    expect(resource.formats).toEqual(tool);
  });

  it('the renderer, theme and template resources match the catalogue', async () => {
    const formats = await discover();
    const [renderers, themes, templates] = await Promise.all([
      readJson(RESOURCE_URIS.renderers),
      readJson(RESOURCE_URIS.themes),
      readJson(RESOURCE_URIS.templates),
    ]);

    expect(
      renderers.formats.map((entry: any) => ({
        format: entry.format,
        defaultRenderer: entry.defaultRenderer,
        renderers: entry.renderers,
      }))
    ).toEqual(
      formats.map((format) => ({
        format: format.name,
        defaultRenderer: format.defaultRenderer,
        renderers: format.renderers,
      }))
    );

    for (const format of formats) {
      const published = themes.formats.find(
        (entry: any) => entry.format === format.name
      );
      expectSameNames(
        `${format.name} themes`,
        'jto_discover',
        format.themes,
        'jto://themes',
        published?.themes ?? []
      );
    }

    expectSameNames(
      'starters',
      'jto_discover',
      formats.flatMap((format) => format.starters.map((entry) => entry.id)),
      'jto://templates',
      templates.starters.map((entry: any) => entry.id)
    );
  });

  it('the blueprint resource carries the plans the catalogue summarises', async () => {
    const formats = await discover();
    const published = await readJson(RESOURCE_URIS.blueprints);
    for (const format of formats) {
      const entry = published.formats.find(
        (candidate: any) => candidate.format === format.name
      );
      expectSameNames(
        `${format.name} blueprints`,
        'jto_discover',
        ((format as any).blueprints ?? []).map((b: any) => b.id),
        'jto://blueprints',
        (entry?.blueprints ?? []).map((b: any) => b.id)
      );
      for (const plan of entry?.blueprints ?? []) {
        // The resource is the plan; the summary never carries children.
        for (const variant of Object.values(plan.variants) as any[])
          expect(Array.isArray(variant.children)).toBe(true);
      }
    }
  });

  it('jto_describe_component answers for every component the catalogue lists', async () => {
    const formats = await discover();
    const missing: string[] = [];
    const mismatched: string[] = [];

    for (const format of formats) {
      for (const component of format.components) {
        for (const renderer of component.renderers) {
          const result = await client.callTool({
            name: 'jto_describe_component',
            arguments: { format: format.name, name: component.name, renderer },
          });
          const described = result.structuredContent as unknown as {
            ok: boolean;
            schema?: { properties?: { name?: { const?: string } } };
            allowedChildren?: string[];
            component?: { hasChildren: boolean; root: boolean };
          };
          const where = `${format.name}/${renderer}/${component.name}`;
          if (!described.ok) {
            missing.push(where);
            continue;
          }
          if (described.schema?.properties?.name?.const !== component.name) {
            mismatched.push(
              `${where}: schema names "${described.schema?.properties?.name?.const}"`
            );
          }
          if (described.component?.root !== component.root) {
            mismatched.push(`${where}: disagrees on root`);
          }
          if (described.component?.hasChildren !== component.hasChildren) {
            mismatched.push(`${where}: disagrees on hasChildren`);
          }
        }
      }
    }

    expect(
      missing,
      `jto_discover lists components jto_describe_component cannot describe: ${missing.join(', ')}`
    ).toEqual([]);
    expect(mismatched, mismatched.join('; ')).toEqual([]);
  });

  it('every starter still validates against the current components', async () => {
    const formats = await discover();
    const broken: string[] = [];
    for (const format of formats) {
      for (const starter of format.starters) {
        const outcome = deps
          .getAdapter(format.name)
          .validateDocument(starter.document);
        if (!outcome.valid) {
          broken.push(`${starter.id}: ${JSON.stringify(outcome.errors)}`);
        }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('every starter also satisfies the JSON Schema this server publishes', async () => {
    // `validateDocument` above is the deep walk; the published schema is what
    // an agent gets from jto_describe_component and jto://schema/{f}/document.
    // Both are generated from the same registry, so neither is the stricter
    // one by design — which is exactly why a starter has to satisfy both: one
    // that passes here and fails there is a document we hand an agent that its
    // own tooling then calls invalid.
    const formats = await discover();
    const broken: string[] = [];
    for (const format of formats) {
      const validate = publishedSchemaValidator.compile(
        formatSchemas(format.name).document
      );
      for (const starter of format.starters) {
        if (!validate(starter.document)) {
          broken.push(
            `${starter.id}: ${(validate.errors ?? [])
              .map((e) => `${e.instancePath} ${e.message}`)
              .join('; ')}`
          );
        }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('publishes typed block bindings through the MCP document-schema resource', async () => {
    const resource = await client.readResource({
      uri: 'jto://schema/docx/document',
    });
    const text = resource.contents.find((content) => 'text' in content);
    expect(text && 'text' in text).toBe(true);
    const schema = JSON.parse((text as { text: string }).text);
    // Verify the resource payload before reusing the compiled graph by $id;
    // a stale resource with the same identifier must not pass unnoticed.
    expect(schema).toEqual(formatSchemas('docx').document);
    const validate =
      publishedSchemaValidator.getSchema(schema.$id) ??
      publishedSchemaValidator.compile(schema);
    const document = (props: unknown) => ({
      name: 'docx',
      props: {
        blocks: {
          example: {
            slots: { items: { type: 'array', items: { type: 'string' } } },
            body: [{ name: 'columns', props }],
          },
        },
      },
      children: [],
    });
    expect(validate(document({ columns: { $count: '/items' }, gap: 12 }))).toBe(
      true
    );
    expect(validate(document({ $count: '/items' }))).toBe(false);
    expect(validate(document({ $slot: '/settings', default: 42 }))).toBe(false);
    expect(validate(document({ $if: '/enabled', then: { columns: 2 } }))).toBe(
      true
    );
  });

  it('discovery reports no drift diagnostics of its own', async () => {
    const result = await client.callTool({
      name: 'jto_discover',
      arguments: {},
    });
    const { diagnostics } = result.structuredContent as unknown as {
      diagnostics: Array<{ severity: string; message: string }>;
    };
    // Info-level notes (a host with no themes installed) are fine; a warning
    // here is the catalogue telling us two of its sources disagreed.
    const warnings = diagnostics.filter((entry) => entry.severity !== 'info');
    expect(
      warnings.map((entry) => entry.message),
      warnings.map((e) => e.message).join('; ')
    ).toEqual([]);
  });
});

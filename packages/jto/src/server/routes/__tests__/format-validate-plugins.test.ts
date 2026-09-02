/**
 * `/api/docx/validate` and the plugin registry.
 *
 * The rest of the server treats a registered plugin as a component: the
 * schema route composes it into what Monaco completes and validates against,
 * and the generator expands it. This route knew the standard components
 * alone, so a document the playground had just autocompleted came back
 * `Unknown component "weather"` — clean in the editor, rejected by the server
 * that offered the name.
 *
 * Discovery resolves the workspace root from cwd, so the bundled `weather`
 * example under packages/core-docx is reachable from this package's test run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createFormatRouter } from '../format';
import { Container } from '../../container';
import { DocxFormatAdapter, PluginRegistry } from '@json-to-office/jto-cli';

// Hono's body-limit middleware reads Content-Length; tests must set it.
async function validate(app: Hono, jsonDefinition: unknown) {
  const body = JSON.stringify({ jsonDefinition });
  const response = await app.request('/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  });
  const payload = (await response.json()) as {
    data: {
      valid: boolean;
      errors?: Array<{ path?: string; message: string }>;
    };
  };
  return payload.data;
}

/** A plugin component where documents actually put one: inside a section. */
function docWith(node: unknown) {
  return {
    name: 'docx',
    props: { metadata: { title: 'plugin-validate' } },
    children: [{ name: 'section', children: [node] }],
  };
}

describe('/api/docx/validate with plugins registered', () => {
  let app: Hono;

  beforeAll(async () => {
    Container.initialize(new DocxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new DocxFormatAdapter()) as any);

    const registry = PluginRegistry.getInstance();
    registry.setFormat('docx');
    await registry.discoverAndLoad();
    expect(registry.hasPlugins()).toBe(true);
  });

  afterAll(() => {
    PluginRegistry.cleanup();
  });

  it('accepts a document that names a registered plugin component', async () => {
    const result = await validate(
      app,
      docWith({ name: 'weather', props: { city: 'Milan' } })
    );

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('checks the plugin props against the version they resolve to', async () => {
    // Accepting the name is half the job: `city` is a string in every version
    // of the example, and a route that only stopped saying "unknown" would
    // wave this through to a render that cannot use it.
    const result = await validate(
      app,
      docWith({ name: 'weather', props: { city: 123 } })
    );

    expect(result.valid).toBe(false);
    expect(result.errors?.some((error) => /city/.test(error.path ?? ''))).toBe(
      true
    );
  });

  it('still rejects a name no plugin claims', async () => {
    const result = await validate(
      app,
      docWith({ name: 'not-a-component', props: {} })
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors?.some((error) =>
        error.message.includes('Unknown component "not-a-component"')
      )
    ).toBe(true);
  });
});

describe('/api/docx/validate with an empty registry', () => {
  let app: Hono;

  beforeAll(() => {
    PluginRegistry.cleanup();
    Container.initialize(new DocxFormatAdapter());
    app = new Hono();
    app.route('/', createFormatRouter(new DocxFormatAdapter()) as any);
  });

  it('reports the plugin component as unknown', async () => {
    // Not a regression: a server that was never allowed to load plugins
    // (`PLUGIN_AUTOLOAD` off) cannot build this document either, and saying so
    // is the honest answer. What must not happen is the two disagreeing.
    const result = await validate(
      app,
      docWith({ name: 'weather', props: { city: 'Milan' } })
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors?.some((error) =>
        error.message.includes('Unknown component "weather"')
      )
    ).toBe(true);
  });
});

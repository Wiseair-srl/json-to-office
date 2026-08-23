/**
 * `/discovery/schemas/document` must be self-sufficient: the playground fires
 * the bootstrap `POST /load-plugins` and the first schema fetch in parallel,
 * and when the schema request won the race (or the POST failed) the registry
 * was empty — requested plugins were silently dropped and Monaco kept a
 * plugin-less schema until a toggle forced a refetch. Enabled components
 * neither completed nor validated.
 *
 * These tests hit the route with a cleared registry and no prior
 * load-plugins call, exactly the lost-race state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { discoveryRouter } from '../discovery';
import { Container } from '../../container';
import { DocxFormatAdapter, PluginRegistry } from '@json-to-office/jto-cli';
import { unionBranches } from '@json-to-office/shared';
import {
  DEFAULT_DOCX_RENDERER_ID,
  docxComponentDefinitionName,
} from '@json-to-office/shared-docx';

// Discovery resolves the workspace root from cwd, so the example plugins
// under packages/core-docx are reachable from this package's test run.

function componentNames(schema: any): string[] {
  // One component definition per renderer; a plugin is offered by both, so
  // read the default renderer's.
  return unionBranches(
    schema.definitions[docxComponentDefinitionName(DEFAULT_DOCX_RENDERER_ID)]
  )
    .map((b: any) => b?.properties?.name?.const)
    .filter(Boolean);
}

describe('/api/discovery/schemas/document', () => {
  let app: Hono;

  beforeAll(() => {
    Container.initialize(new DocxFormatAdapter());
    PluginRegistry.cleanup();
    app = new Hono();
    app.route('/discovery', discoveryRouter as any);
  });

  afterAll(() => {
    PluginRegistry.cleanup();
  });

  it('includes requested plugins with an empty registry (no prior load-plugins)', async () => {
    expect(PluginRegistry.getInstance().hasPlugins()).toBe(false);

    const res = await app.request(
      '/discovery/schemas/document?plugins=columnsLayout,weather'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const names = componentNames(body.data);

    expect(names).toContain('weather');
    expect(names).toContain('columnsLayout');
    expect(names).toContain('heading');
    // only the requested plugins, not everything discovered
    expect(names).not.toContain('eldermoor-census');
  });

  it('keeps an explicit empty selection plugin-free', async () => {
    // registry is populated from the previous request; selection still wins
    const res = await app.request('/discovery/schemas/document?plugins=');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const names = componentNames(body.data);

    expect(names).toContain('heading');
    expect(names).not.toContain('weather');
    expect(names).not.toContain('columnsLayout');
  });

  it('does not trigger plugin loading in production', async () => {
    // Plugin loading stays behind the authenticated POST /load-plugins in
    // production; an unauthenticated schema request must not reach discovery.
    PluginRegistry.cleanup();
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await app.request(
        '/discovery/schemas/document?plugins=weather'
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(componentNames(body.data)).not.toContain('weather');
      expect(PluginRegistry.getInstance().hasPlugins()).toBe(false);
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });
});

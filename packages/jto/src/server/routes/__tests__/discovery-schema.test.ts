/**
 * `/discovery/schemas/document` must be self-sufficient: the playground used
 * to fire a bootstrap `POST /load-plugins` and the first schema fetch in
 * parallel, and when the schema request won the race (or the POST failed) the
 * registry was empty — requested plugins were silently dropped and Monaco kept
 * a plugin-less schema until a toggle forced a refetch. Enabled components
 * neither completed nor validated.
 *
 * These tests hit the route with a cleared registry and no prior
 * load-plugins call, exactly the lost-race state. The production cases below
 * pin the other half: there the route may not go to disk at all, whatever the
 * caller asks for, because a deployment loads its plugins at boot instead.
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

    // `weather` is the only example plugin on disk; a name that matches
    // nothing stands in for "requested but not discovered".
    const res = await app.request(
      '/discovery/schemas/document?plugins=weather,not-a-plugin'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const names = componentNames(body.data);

    expect(names).toContain('weather');
    expect(names).toContain('heading');
    expect(names).not.toContain('not-a-plugin');
  });

  it('keeps an explicit empty selection plugin-free', async () => {
    // registry is populated from the previous request; selection still wins
    const res = await app.request('/discovery/schemas/document?plugins=');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const names = componentNames(body.data);

    expect(names).toContain('heading');
    expect(names).not.toContain('weather');
  });

  it('does not trigger plugin loading in production', async () => {
    // Reading plugins off disk in production is the boot preload's job; an
    // unauthenticated schema request must not reach discovery.
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

  it('opting in does not let a request reach the disk either', async () => {
    // What the hosted playgrounds set. `PLUGIN_AUTOLOAD` is the operator
    // authorizing the boot preload, not the caller: it must not turn an
    // anonymous schema fetch into a filesystem scan.
    PluginRegistry.cleanup();
    const previousEnv = process.env.NODE_ENV;
    const previousAutoload = process.env.PLUGIN_AUTOLOAD;
    process.env.NODE_ENV = 'production';
    process.env.PLUGIN_AUTOLOAD = 'true';
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
      if (previousAutoload === undefined) delete process.env.PLUGIN_AUTOLOAD;
      else process.env.PLUGIN_AUTOLOAD = previousAutoload;
    }
  });

  it('serves what the boot preload registered', async () => {
    // The bug this fixes: `weather` completed and validated locally and came
    // back "Unknown component" on the deployment. The preload runs the load
    // below before the first request, and from there the schema carries it
    // without the route ever going to disk itself.
    PluginRegistry.cleanup();
    const registry = PluginRegistry.getInstance();
    registry.setFormat('docx');
    await registry.discoverAndLoad();

    const previousEnv = process.env.NODE_ENV;
    const previousAutoload = process.env.PLUGIN_AUTOLOAD;
    process.env.NODE_ENV = 'production';
    process.env.PLUGIN_AUTOLOAD = 'true';
    try {
      const res = await app.request(
        '/discovery/schemas/document?plugins=weather'
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(componentNames(body.data)).toContain('weather');
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousAutoload === undefined) delete process.env.PLUGIN_AUTOLOAD;
      else process.env.PLUGIN_AUTOLOAD = previousAutoload;
    }
  });

  it('keeps the load route shut to anonymous callers in production', async () => {
    // The gate is about who may make the server read its own disk. Opting a
    // deployment into disk plugins does not open it: that discovery has
    // already run at boot, so the POST would only let a caller start it
    // again. Locally the keyless bootstrap still works.
    const previousEnv = process.env.NODE_ENV;
    const previousAutoload = process.env.PLUGIN_AUTOLOAD;
    process.env.NODE_ENV = 'production';
    try {
      delete process.env.PLUGIN_AUTOLOAD;
      const refused = await app.request('/discovery/load-plugins', {
        method: 'POST',
      });
      expect(refused.status).toBe(401);

      process.env.PLUGIN_AUTOLOAD = 'true';
      const stillRefused = await app.request('/discovery/load-plugins', {
        method: 'POST',
      });
      expect(stillRefused.status).toBe(401);

      process.env.NODE_ENV = 'development';
      const allowed = await app.request('/discovery/load-plugins', {
        method: 'POST',
      });
      expect(allowed.status).toBe(200);
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousAutoload === undefined) delete process.env.PLUGIN_AUTOLOAD;
      else process.env.PLUGIN_AUTOLOAD = previousAutoload;
    }
  });

  it('tells the client which of the two it is', async () => {
    // The rail reads this to decide whether a disk plugin gets a live switch
    // or a line saying the server will not load it.
    const previousEnv = process.env.NODE_ENV;
    const previousAutoload = process.env.PLUGIN_AUTOLOAD;
    process.env.NODE_ENV = 'production';
    delete process.env.PLUGIN_AUTOLOAD;
    try {
      const off = (await (await app.request('/discovery/all')).json()) as any;
      expect(off.data.pluginAutoload).toBe(false);

      process.env.PLUGIN_AUTOLOAD = 'true';
      const on = (await (await app.request('/discovery/all')).json()) as any;
      expect(on.data.pluginAutoload).toBe(true);
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousAutoload === undefined) delete process.env.PLUGIN_AUTOLOAD;
      else process.env.PLUGIN_AUTOLOAD = previousAutoload;
    }
  });
});

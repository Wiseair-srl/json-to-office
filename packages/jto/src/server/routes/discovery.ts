import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { Type } from '@sinclair/typebox';
import { readFile, stat } from 'node:fs/promises';
import {
  PluginDiscoveryService,
  PluginRegistry,
} from '@json-to-office/jto-cli';
import { latestVersion } from '@json-to-office/shared';
import { logger } from '../utils/logger.js';
import { AppEnv } from '../types/hono.js';
import { Container } from '../container/index.js';
import { tbValidator, getValidated } from '../lib/typebox-validator.js';
import { rateLimiter } from '../middleware/hono/rate-limit.js';
import {
  config,
  pluginAutoloadEnabled,
  requestTriggeredPluginLoadAllowed,
} from '../config/index.js';
import {
  BrowserPluginSchemaError,
  prepareBrowserPlugins,
} from '../lib/browser-plugin-schema.js';

export const discoveryRouter = new Hono<AppEnv>();

/**
 * Refuse a browser on another site. These routes hand back files from the
 * developer's own project, and the local default is wildcard CORS with no
 * key, so a page open in another tab could otherwise read them. A request
 * that carries no `Sec-Fetch-Site` (curl, older clients) is let through: the
 * header is what a browser adds, and it is browsers this guards against.
 */
function sameSiteOnly(c: {
  req: { header: (name: string) => string | undefined };
}): boolean {
  const site = c.req.header('sec-fetch-site');
  return site === undefined || site === 'same-origin' || site === 'none';
}

// ---------------------------------------------------------------------------
// Browser plugins: components compiled in the playground.
//
// Their code never reaches the server. What the client sends is metadata —
// the component name and each version's props schema as plain JSON — so the
// document schema Monaco validates against can carry them next to the disk
// plugins. Composition is pure schema work; the bounds below keep a hostile
// body from turning it into a large allocation.
// ---------------------------------------------------------------------------

const BrowserPluginVersionSchema = Type.Object(
  {
    version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
    propsSchema: Type.Object({}, { additionalProperties: true }),
    hasChildren: Type.Optional(Type.Boolean()),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false }
);

const BrowserPluginSchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$',
    }),
    versions: Type.Array(BrowserPluginVersionSchema, {
      minItems: 1,
      maxItems: 10,
    }),
  },
  { additionalProperties: false }
);

const DocumentSchemaRequestSchema = Type.Object(
  {
    plugins: Type.Optional(
      Type.Array(Type.String({ maxLength: 128 }), { maxItems: 100 })
    ),
    customComponents: Type.Optional(
      Type.Array(BrowserPluginSchema, { maxItems: 20 })
    ),
  },
  { additionalProperties: false }
);

interface BrowserPluginInfo {
  name: string;
  versions: Array<{
    version: string;
    propsSchema: Record<string, unknown>;
    hasChildren?: boolean;
    description?: string;
  }>;
}

const MAX_PLUGIN_SOURCE_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// Schema generation helpers (mirrors client-side json-schema-generator.ts)
// ---------------------------------------------------------------------------

function cleanupTypeBoxIds(schema: any): void {
  if (typeof schema !== 'object' || schema === null) return;
  if (schema.$id && /^T\d+$/.test(schema.$id)) delete schema.$id;
  if (schema.$ref && /^T\d+$/.test(schema.$ref))
    schema.$ref = '#/definitions/ComponentDefinition';
  if (Array.isArray(schema)) {
    schema.forEach(cleanupTypeBoxIds);
    return;
  }
  Object.keys(schema).forEach((key) => {
    if (typeof schema[key] === 'object' && schema[key] !== null)
      cleanupTypeBoxIds(schema[key]);
  });
}

/**
 * Schema generation must not depend on anything having POSTed
 * `/load-plugins` first. The playground used to fire that bootstrap POST and
 * the first schema fetch in parallel on page load; when the schema request
 * won the race (or the POST failed), the registry was empty, the requested
 * plugins were silently dropped, and Monaco kept a plugin-less schema —
 * enabled components neither completed nor validated until a toggle forced a
 * refetch. Requests that need plugins now load them on demand; the registry
 * coalesces concurrent loads and its load fingerprint makes repeats a no-op.
 *
 * Local affordance only (see `requestTriggeredPluginLoadAllowed`), because
 * this is a request making the server read its own disk. A hardened
 * deployment loads its plugins at boot instead — see
 * `UnifiedServer.preloadPlugins` — so it needs nothing from here and falls
 * back to what is already registered, which after that preload is everything
 * the image ships.
 */
async function ensurePluginsRegistered(
  format: 'docx' | 'pptx',
  pluginNames?: string[]
): Promise<void> {
  if (!requestTriggeredPluginLoadAllowed()) return;

  const registry = PluginRegistry.getInstance();
  const satisfied = pluginNames
    ? pluginNames.every((name) => registry.getPlugin(name))
    : registry.hasPlugins();
  if (satisfied) return;

  registry.setFormat(format);
  try {
    await registry.discoverAndLoad();
  } catch (error: any) {
    // Schema generation falls back to standard components only.
    logger.warn('On-demand plugin load for schema generation failed', {
      error: error?.message,
    });
  }
}

function getSelectedPlugins(pluginNames?: string[]) {
  const registry = PluginRegistry.getInstance();
  if (!registry.hasPlugins()) return [];

  // An explicit array is an exact selection — [] means "no plugins", so a
  // playground with every plugin toggled off gets the plugin-free schema.
  // Only an absent selection falls back to every registered plugin.
  const plugins = pluginNames
    ? pluginNames.map((n) => registry.getPlugin(n)).filter(Boolean)
    : registry.getPlugins();

  return plugins.map((plugin) => {
    const versions = (plugin as any).versions || {};
    const versionKeys = Object.keys(versions);
    const latest =
      versionKeys.length > 0 ? latestVersion(versionKeys) : undefined;
    const latestEntry = latest ? versions[latest] : undefined;

    return { name: plugin!.name, versions, versionKeys, latest, latestEntry };
  });
}

async function generateDocumentSchema(
  format: string,
  pluginNames?: string[],
  browserPlugins: BrowserPluginInfo[] = []
): Promise<any> {
  await ensurePluginsRegistered(format as 'docx' | 'pptx', pluginNames);
  // A browser plugin shadows a disk plugin of the same name: the client only
  // sends ones it will expand itself, and two branches for one `name` would
  // validate a document against whichever the JSON service tried first.
  const browserNames = new Set(browserPlugins.map((p) => p.name));
  const selected = getSelectedPlugins(pluginNames).filter(
    (p) => !browserNames.has(p.name)
  );

  if (format === 'docx') {
    const shared = await import('@json-to-office/shared-docx');
    const customComponents = selected
      .filter((p) => p.latestEntry?.propsSchema)
      .map((p) => {
        const info: any = {
          name: p.name,
          propsSchema: p.latestEntry!.propsSchema,
          hasChildren: p.latestEntry?.hasChildren,
          description: p.latestEntry?.description,
        };
        if (p.versionKeys.length > 1) {
          info.versionedProps = p.versionKeys.map((v) => ({
            version: v,
            propsSchema: p.versions[v].propsSchema,
            description: p.versions[v].description,
            hasChildren: p.versions[v].hasChildren,
          }));
        }
        return info;
      });
    for (const plugin of browserPlugins) {
      const latest = latestVersion(plugin.versions.map((v) => v.version));
      const latestEntry = plugin.versions.find((v) => v.version === latest)!;
      const info: any = {
        name: plugin.name,
        propsSchema: latestEntry.propsSchema,
        hasChildren: latestEntry.hasChildren,
        description: latestEntry.description,
      };
      if (plugin.versions.length > 1) {
        info.versionedProps = plugin.versions.map((v) => ({
          version: v.version,
          propsSchema: v.propsSchema,
          description: v.description,
          hasChildren: v.hasChildren,
        }));
      }
      customComponents.push(info);
    }
    const unified = shared.generateUnifiedDocumentSchema({ customComponents });
    return shared.convertToJsonSchema(unified, {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'https://json-to-office.dev/schema/document/v1.0.0',
      title: 'JSON to DOCX Document Definition',
      description: 'Schema for JSON to DOCX JSON document definitions',
    });
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    const customComponents: any[] = selected.map((p) => ({
      name: p.name,
      versions: p.versionKeys.map((v) => ({
        version: v,
        propsSchema: p.versions[v].propsSchema,
        hasChildren: p.versions[v].hasChildren,
        description: p.versions[v].description,
      })),
    }));
    for (const plugin of browserPlugins) {
      customComponents.push({
        name: plugin.name,
        versions: plugin.versions.map((v) => ({
          version: v.version,
          propsSchema: v.propsSchema,
          hasChildren: v.hasChildren,
          description: v.description,
        })),
      });
    }
    const unified = shared.generateUnifiedDocumentSchema({ customComponents });
    return shared.convertToJsonSchema(unified, {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'https://json-to-office.dev/schema/presentation/v1.0.0',
      title: 'JSON to PPTX Presentation Definition',
      description: 'Schema for JSON to PPTX JSON presentation definitions',
    });
  }
}

async function generateThemeSchema(format: string): Promise<any> {
  let source: any;
  let label: string;
  if (format === 'docx') {
    const shared = await import('@json-to-office/shared-docx');
    source = shared.ThemeConfigSchema;
    label = 'DOCX';
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    source = shared.ThemeConfigSchema;
    label = 'PPTX';
  }
  const schema = JSON.parse(JSON.stringify(source));
  cleanupTypeBoxIds(schema);
  return {
    ...schema,
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://json-to-office.dev/schemas/theme/v1.0.0',
    title: `JSON to ${label} Theme`,
    description: `Theme definition for JSON to ${label} ${format === 'docx' ? 'documents' : 'presentations'}`,
  };
}

discoveryRouter.get('/all', async (c) => {
  try {
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const [plugins, documents, themes] = await Promise.all([
      discovery.discoverPlugins(format),
      discovery.discoverDocuments(format),
      discovery.discoverThemes(format),
    ]);
    // `pluginAutoload` travels with the plugin list because it decides what
    // the list means: with it off, a disk plugin can be read about but never
    // switched on, and the rail says so rather than offering a dead switch.
    const results = {
      plugins,
      documents,
      themes,
      pluginAutoload: pluginAutoloadEnabled(),
    };
    return c.json({
      success: true,
      data: results,
      counts: {
        plugins: results.plugins.length,
        documents: results.documents.length,
        themes: results.themes.length,
      },
    });
  } catch (error: any) {
    logger.error('Discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/plugins', async (c) => {
  try {
    const includeSchemas = c.req.query('schemas') === 'true';
    const includeExamples = c.req.query('examples') === 'true';
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const plugins = await discovery.discoverPlugins(format);
    const processed = plugins.map((plugin) => {
      const result: any = { ...plugin };
      if (!includeSchemas && result.schema) {
        delete result.schema.raw;
        delete result.schema.jsonSchema;
      }
      if (!includeExamples) delete result.examples;
      return result;
    });
    return c.json({
      success: true,
      data: processed,
      count: plugins.length,
      // Whether switching one of these on will actually reach a schema or a
      // build here. The rail shows them either way — the details are worth
      // reading — but a switch it cannot honour is a lie.
      autoload: pluginAutoloadEnabled(),
    });
  } catch (error: any) {
    logger.error('Plugin discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/documents', async (c) => {
  try {
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const documents = await discovery.discoverDocuments(format);
    return c.json({ success: true, data: documents, count: documents.length });
  } catch (error: any) {
    logger.error('Document discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/themes', async (c) => {
  try {
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const themes = await discovery.discoverThemes(format);
    return c.json({ success: true, data: themes, count: themes.length });
  } catch (error: any) {
    logger.error('Theme discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

// The built-in themes of the running format, by value. The playground hands a
// browser plugin the resolved theme at render time, exactly as the cores hand
// it to a disk plugin, and a document naming `minimal` or `default` resolves
// to a theme the page does not otherwise hold.
discoveryRouter.get('/themes/builtin', async (c) => {
  try {
    const adapter = Container.getAdapter();
    const themes = adapter.getBuiltinThemeValues
      ? await adapter.getBuiltinThemeValues()
      : adapter.getBuiltinThemes();
    return c.json({ success: true, data: themes });
  } catch (error: any) {
    logger.error('Built-in theme lookup failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Source of a discovered plugin file, so the playground can start a browser
// plugin from a disk one. Only names are accepted: the path is the one
// discovery itself found, never one the client supplied.
discoveryRouter.get('/plugins/:name/source', async (c) => {
  if (!sameSiteOnly(c)) {
    return c.json(
      {
        success: false,
        error: 'Plugin source is only served to the playground',
      },
      403
    );
  }
  try {
    const pluginName = c.req.param('name');
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const plugins = await discovery.discoverPlugins(format);
    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin) {
      return c.json(
        { success: false, error: `Plugin '${pluginName}' not found` },
        404
      );
    }
    const info = await stat(plugin.filePath);
    if (info.size > MAX_PLUGIN_SOURCE_BYTES) {
      return c.json(
        { success: false, error: `Plugin '${pluginName}' source is too large` },
        413
      );
    }
    return c.text(await readFile(plugin.filePath, 'utf-8'));
  } catch (error: any) {
    logger.error('Plugin source read failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/plugin/:name', async (c) => {
  try {
    const pluginName = c.req.param('name');
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const plugins = await discovery.discoverPlugins(format);
    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin)
      return c.json(
        { success: false, error: `Plugin '${pluginName}' not found` },
        404
      );
    return c.json({ success: true, data: plugin });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.post('/load-plugins', async (c) => {
  // A key is required regardless of the global auth setting, except on a
  // developer's own machine, where a keyless caller may still ask, as it
  // always could. `PLUGIN_AUTOLOAD` does not open this route: it authorizes
  // the boot preload, not the caller, and a deployment that opted in already
  // has these plugins registered before the first request arrives.
  const apiKey = c.req.header('X-API-Key') || c.req.header('Authorization');
  if (!apiKey && !requestTriggeredPluginLoadAllowed()) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  try {
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const registry = PluginRegistry.getInstance();
    registry.setFormat(format);
    const result = await registry.discoverAndLoad();
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/documents/:name/content', async (c) => {
  try {
    const name = c.req.param('name');
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const content = await discovery.getDocumentContent(name, format);
    return c.text(content);
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    return c.json({ success: false, error: error.message }, status);
  }
});

discoveryRouter.get('/themes/:name/content', async (c) => {
  try {
    const name = c.req.param('name');
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const content = await discovery.getThemeContent(name, format);
    return c.text(content);
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    return c.json({ success: false, error: error.message }, status);
  }
});

discoveryRouter.get('/schemas/document', async (c) => {
  try {
    const adapter = Container.getAdapter();
    const pluginsParam = c.req.query('plugins');
    // `?plugins=` (empty) is an explicit "no plugins"; only a missing param
    // means "all registered plugins".
    const pluginNames =
      pluginsParam !== undefined
        ? pluginsParam.split(',').filter(Boolean)
        : undefined;
    const schema = await generateDocumentSchema(adapter.name, pluginNames);
    return c.json({ success: true, data: schema });
  } catch (error: any) {
    logger.error('Document schema generation failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Same schema as the GET, plus the browser plugins the client compiled. The
// selection semantics match: an explicit `plugins` array is exact, an absent
// one means every registered disk plugin.
discoveryRouter.post(
  '/schemas/document',
  bodyLimit({
    // The aggregate cap in prepareBrowserPlugins is the real bound; this only
    // keeps a hostile body from being parsed at all.
    maxSize: 512 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: 'Request body too large' });
    },
  }),
  rateLimiter({
    limit: process.env.NODE_ENV === 'production' ? 60 : 1000,
    window: 60 * 1000,
    namespace: 'schemas-document',
    trustProxy: config.rateLimit.trustProxy,
  }),
  tbValidator(DocumentSchemaRequestSchema),
  async (c) => {
    try {
      const adapter = Container.getAdapter();
      const { plugins, customComponents } = getValidated<{
        plugins?: string[];
        customComponents?: BrowserPluginInfo[];
      }>(c, 'json');
      let prepared: BrowserPluginInfo[] = [];
      try {
        prepared = prepareBrowserPlugins(customComponents ?? []);
      } catch (error) {
        if (error instanceof BrowserPluginSchemaError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
      const schema = await generateDocumentSchema(
        adapter.name,
        plugins,
        prepared
      );
      return c.json({ success: true, data: schema });
    } catch (error: any) {
      if (error instanceof HTTPException) throw error;
      logger.error('Document schema generation failed', {
        error: error.message,
      });
      return c.json({ success: false, error: error.message }, 500);
    }
  }
);

discoveryRouter.get('/schemas/theme', async (c) => {
  try {
    const adapter = Container.getAdapter();
    const schema = await generateThemeSchema(adapter.name);
    return c.json({ success: true, data: schema });
  } catch (error: any) {
    logger.error('Theme schema generation failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

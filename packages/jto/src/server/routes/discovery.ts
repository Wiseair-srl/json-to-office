import { Hono } from 'hono';
import {
  PluginDiscoveryService,
  PluginRegistry,
} from '@json-to-office/jto-cli';
import { latestVersion } from '@json-to-office/shared';
import { logger } from '../utils/logger.js';
import { AppEnv } from '../types/hono.js';
import { Container } from '../container/index.js';

export const discoveryRouter = new Hono<AppEnv>();

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
 * Schema generation must not depend on the client having POSTed
 * `/load-plugins` first. The playground fires that bootstrap POST and the
 * first schema fetch in parallel on page load; when the schema request won
 * the race (or the POST failed), the registry was empty, the requested
 * plugins were silently dropped, and Monaco kept a plugin-less schema —
 * enabled components neither completed nor validated until a toggle forced a
 * refetch. Requests that need plugins now load them on demand; the
 * registry's load fingerprint makes a repeat discover-and-load a no-op.
 */
let pluginLoadInFlight: Promise<void> | null = null;

async function ensurePluginsRegistered(
  format: 'docx' | 'pptx',
  pluginNames?: string[]
): Promise<void> {
  const registry = PluginRegistry.getInstance();
  const satisfied = pluginNames
    ? pluginNames.every((name) => registry.getPlugin(name))
    : registry.hasPlugins();
  if (satisfied) return;

  if (!pluginLoadInFlight) {
    registry.setFormat(format);
    pluginLoadInFlight = registry
      .discoverAndLoad()
      .then(() => undefined)
      .catch((error: any) => {
        // Schema generation falls back to standard components only.
        logger.warn('On-demand plugin load for schema generation failed', {
          error: error?.message,
        });
      })
      .finally(() => {
        pluginLoadInFlight = null;
      });
  }
  await pluginLoadInFlight;
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
  pluginNames?: string[]
): Promise<any> {
  await ensurePluginsRegistered(format as 'docx' | 'pptx', pluginNames);
  const selected = getSelectedPlugins(pluginNames);

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
    const unified = shared.generateUnifiedDocumentSchema({ customComponents });
    return shared.convertToJsonSchema(unified, {
      $schema: 'https://json-schema.org/draft-07/schema#',
      $id: 'https://json-to-office.dev/schema/document/v1.0.0',
      title: 'JSON to DOCX Document Definition',
      description: 'Schema for JSON to DOCX JSON document definitions',
    });
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    const customComponents = selected.map((p) => ({
      name: p.name,
      versions: p.versionKeys.map((v) => ({
        version: v,
        propsSchema: p.versions[v].propsSchema,
        hasChildren: p.versions[v].hasChildren,
        description: p.versions[v].description,
      })),
    }));
    const unified = shared.generateUnifiedDocumentSchema({ customComponents });
    return shared.convertToJsonSchema(unified, {
      $schema: 'https://json-schema.org/draft-07/schema#',
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
    $schema: 'https://json-schema.org/draft-07/schema#',
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
    const results = { plugins, documents, themes };
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
    return c.json({ success: true, data: processed, count: plugins.length });
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
  // Require API key for plugin loading regardless of global auth setting
  const apiKey = c.req.header('X-API-Key') || c.req.header('Authorization');
  if (!apiKey && process.env.NODE_ENV === 'production') {
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
